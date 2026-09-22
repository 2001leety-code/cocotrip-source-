import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { kstDayIndex } from '../../api/_shared/contentDraftSelector.js';

const state = vi.hoisted(() => ({ db: null as ReturnType<typeof createFakeFirestore> | null, notify: { ok: true } as { ok: boolean; error?: string }, generateContent: vi.fn(async () => ({ response: { text: () => '{"variants":[{"hook":"h","ko":"k","en":"e"}],"hashtags":[]}' } })) }));
vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => state.db }));
vi.mock('../../api/_shared/operator-alerts.js', () => ({ notifyOperatorLong: vi.fn(async () => state.notify) }));
vi.mock('../../api/_shared/decisionQueue.js', () => ({ enqueueDecision: vi.fn(async () => ({ ok: true })) }));
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class { getGenerativeModel() { return { generateContent: state.generateContent }; } } }));

describe('content draft durable dedupe', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    state.notify = { ok: true };
    state.generateContent.mockReset();
    state.generateContent.mockResolvedValue({ response: { text: () => '{"variants":[{"hook":"h","ko":"k","en":"e"}],"hashtags":[]}' } });
  });

  function enableWorker() {
    vi.stubEnv('CONTENT_WORKER_ENABLED', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test');
  }

  it('claim transaction 실패 뒤에도 fallback add로 초안을 보관한다', async () => {
    const fake = createFakeFirestore();
    const add = vi.fn(async (data) => fake.collection('content_drafts').doc('fallback').set(data));
    state.db = {
      ...fake,
      collection: (name: string) => ({ ...fake.collection(name), add }),
      runTransaction: vi.fn()
        .mockRejectedValueOnce(new Error('claim unavailable'))
        .mockImplementation(fake.runTransaction.bind(fake)),
    };
    state.generateContent.mockClear();
    enableWorker();
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    await expect(contentDraftTask()).resolves.toMatchObject({ statusCode: 200 });
    expect(state.generateContent).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('generates once and reuses the saved draft on the same day', async () => {
    state.db = createFakeFirestore();
    state.generateContent.mockClear();
    vi.stubEnv('CONTENT_WORKER_ENABLED', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test');
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    await contentDraftTask();
    await contentDraftTask();

    expect(state.generateContent).toHaveBeenCalledTimes(1);
    expect(Object.keys(state.db!.__dump()).filter((key) => key.startsWith('content_drafts/'))).toHaveLength(1);
  });

  it('does not generate twice for concurrent runs', async () => {
    state.db = createFakeFirestore();
    state.generateContent.mockClear();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    state.generateContent.mockImplementationOnce(async () => {
      await waiting;
      return { response: { text: () => '{"variants":[{"hook":"h","ko":"k","en":"e"}],"hashtags":[]}' } };
    });
    vi.stubEnv('CONTENT_WORKER_ENABLED', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test');
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');
    const first = contentDraftTask();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await contentDraftTask();
    release();
    await first;
    expect(second.body).toBe('already-running');
    expect(state.generateContent).toHaveBeenCalledTimes(1);
  });

  it('Gemini 오류 초안은 failed로 남기고 다음 실행에서 다시 생성한다', async () => {
    state.db = createFakeFirestore();
    state.generateContent.mockRejectedValueOnce(new Error('temporary Gemini error'));
    enableWorker();
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    await contentDraftTask();
    await contentDraftTask();

    expect(state.generateContent).toHaveBeenCalledTimes(2);
    expect(Object.values(state.db.__dump()).find((value) => value.status === 'ready')).toBeTruthy();
  });

  it('invalid Gemini 초안도 다음 실행에서 다시 생성한다', async () => {
    state.db = createFakeFirestore();
    state.generateContent.mockResolvedValueOnce({ response: { text: () => 'not json' } });
    enableWorker();
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    await contentDraftTask();
    await contentDraftTask();

    expect(state.generateContent).toHaveBeenCalledTimes(2);
    expect(Object.values(state.db.__dump()).find((value) => value.status === 'ready')).toBeTruthy();
  });

  it('DB가 없으면 생성과 알림을 계속한다', async () => {
    state.db = null;
    enableWorker();
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    await expect(contentDraftTask()).resolves.toMatchObject({ statusCode: 200 });
    expect(state.generateContent).toHaveBeenCalledTimes(1);
  });

  it('만료된 lease는 새 생성으로 복구한다', async () => {
    const dayIndex = kstDayIndex(new Date());
    state.db = createFakeFirestore({
      [`content_drafts/kst-${dayIndex}`]: {
        status: 'generating', generationLeaseUntilMs: Date.now() - 1, generationLeaseToken: 'expired',
      },
    });
    enableWorker();
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    await expect(contentDraftTask()).resolves.toMatchObject({ statusCode: 200 });
    expect(state.generateContent).toHaveBeenCalledTimes(1);
    expect(state.db.__get(`content_drafts/kst-${dayIndex}`).status).toBe('ready');
  });

  it('만료된 이전 worker는 새 worker의 draft를 덮어쓰지 않는다', async () => {
    const dayIndex = kstDayIndex(new Date());
    state.db = createFakeFirestore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    state.generateContent
      .mockImplementationOnce(async () => {
        await waiting;
        return { response: { text: () => '{"variants":[{"hook":"old","ko":"k","en":"e"}],"hashtags":[]}' } };
      })
      .mockResolvedValueOnce({ response: { text: () => '{"variants":[{"hook":"new","ko":"k","en":"e"}],"hashtags":[]}' } });
    enableWorker();
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');

    const first = contentDraftTask();
    await new Promise((resolve) => setTimeout(resolve, 0));
    state.db.__patch(`content_drafts/kst-${dayIndex}`, { generationLeaseUntilMs: 0 });
    await contentDraftTask();
    release();
    await first;

    expect(state.db.__get(`content_drafts/kst-${dayIndex}`).draft.variants[0].hook).toBe('new');
  });

  it('retries notification without regenerating after a send failure', async () => {
    state.db = createFakeFirestore();
    state.generateContent.mockClear();
    state.notify = { ok: false, error: 'temporary' };
    vi.stubEnv('CONTENT_WORKER_ENABLED', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test');
    const { contentDraftTask } = await import('../../api/_crons/content-draft.js');
    await expect(contentDraftTask()).resolves.toMatchObject({ statusCode: 500 });
    state.notify = { ok: true };
    await expect(contentDraftTask()).resolves.toMatchObject({ statusCode: 200 });
    expect(state.generateContent).toHaveBeenCalledTimes(1);
  });
});
