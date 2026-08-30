import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — ESM .js in api/, no type declarations
import { mergeOpsV1IntoBriefing, normalizeOpsV1Input } from '../../api/_shared/opsBriefingBridge.js';
// @ts-expect-error — ESM .js in api/, no type declarations
import { buildMessage } from '../../api/_crons/morning-briefing.js';

const contractExample = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/contracts/ops-v1.snapshot.example.json'), 'utf8'));
const generatedAt = contractExample.generated_at;
const evidence = [{ kind: 'test', ref: 'tests/fixtures/ops-v1', observed_at: generatedAt, read_only: true }];

type SnapshotOverrides = {
  job?: Record<string, unknown>;
  run?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  [key: string]: unknown;
};

function finding(overrides: Record<string, unknown> = {}) {
  return {
    key: 'finding',
    dedupe_key: 'finding-key',
    severity: 'warning',
    status: 'observed',
    fact: '운영 확인 필요',
    current: '관찰됨',
    previous: null,
    proposed_action: null,
    approval_required: false,
    owner: 'operations',
    first_seen_at: generatedAt,
    last_seen_at: generatedAt,
    next_check_at: null,
    estimated_cost_usd: null,
    risk_flags: { privacy: false, payment: false, security: false, external_write: false },
    evidence,
    ...overrides,
  };
}

function opsSnapshot(overrides: SnapshotOverrides = {}) {
  const base = {
    ...contractExample,
    job: { ...contractExample.job, title: '콘텐츠 상태 점검' },
    run: {
      ...contractExample.run,
      status: 'succeeded',
      terminal: true,
      finished_at: generatedAt,
      changed: false,
      error: null,
    },
    summary: {
      ...contractExample.summary,
      status: 'ok',
      changed: false,
      source_count: contractExample.sources.length,
      finding_count: 0,
    },
    findings: [],
  };

  return {
    ...base,
    ...overrides,
    job: { ...base.job, ...(overrides.job || {}) },
    run: { ...base.run, ...(overrides.run || {}) },
    summary: { ...base.summary, ...(overrides.summary || {}) },
  };
}

const legacyAggregate = {
  window: {
    yStartMs: Date.parse('2026-06-08T15:00:00Z'),
    todayStartMs: Date.parse('2026-06-09T15:00:00Z'),
    weekStartMs: Date.parse('2026-06-07T15:00:00Z'),
    monthStartMs: Date.parse('2026-05-31T15:00:00Z'),
  },
  revenue: { usd: 0, count: 0 },
  trends: { week: { usd: 0, count: 0 }, month: { usd: 0, count: 0 } },
  byProduct: {
    픽업: { usd: 0, count: 0 },
    셔틀: { usd: 0, count: 0 },
    투어: { usd: 0, count: 0 },
    전세: { usd: 0, count: 0 },
    AI플래너: { usd: 0, count: 0 },
  },
  aiPlanner: { paidCount: 0, feeUsd: 0 },
  newUsers: 0,
  errors: {
    total: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    top: [],
  },
  customer: { newTickets: 0, reviewsSent: 0 },
  meta: { excludedBypass: 0, excludedCanceled: 0 },
};
const legacyDecisions = { total: 0, byType: {}, top: [] };
const legacyMessage = [
  '☀️ <b>코코트립 모닝 브리핑</b>',
  '📅 2026-06-09 (화) · 어제 회사 (KST)',
  '',
  '━━━ 💰 재무 ━━━',
  '어제 매출 <b>$0.00</b> · 0건 (₩0)',
  '이번주 누적 <b>$0.00</b>(0건) · 이번달 <b>$0.00</b>(0건)',
  'AI 플래너 유료 <b>0건</b> · 수수료 $0.00',
  '신규 가입 <b>0명</b>',
  '',
  '━━━ 🛠️ 운영 ━━━',
  '어제 오류 <b>0건</b> ✅',
  '',
  '━━━ 📣 마케팅 ━━━',
  '<i>데이터 수집 중 (PostHog 미설정)</i>',
  '',
  '━━━ 💬 고객 ━━━',
  '신규 문의 <b>0건</b> · 리뷰요청 발송 <b>0건</b>',
  '',
  '━━━ 📥 결정 대기 ━━━',
  '대기 중인 결정 없음 ✅',
  '',
  '━━━ 💸 AI 사용 (이번달) ━━━',
  '<i>기록 없음(트래커 신규 — 다음 플랜부터 집계)</i>',
  '',
  '<i>환율 ₩1,450/$ · 제외 0건(테스트·취소)</i>',
  '🌐 cocotripkr.com/admin',
].join('\n');

describe('ops.v1 모닝 브리핑 브리지', () => {
  it('입력이 없으면 기존 구조 참조와 직렬화 결과를 바이트 수준으로 유지한다', () => {
    const briefing = { agg: legacyAggregate, decisions: legacyDecisions };
    const before = JSON.stringify(briefing);
    const merged = mergeOpsV1IntoBriefing(briefing, undefined);

    expect(merged).toBe(briefing);
    expect(JSON.stringify(merged)).toBe(before);
    expect(buildMessage(legacyAggregate, 1450, { skipped: true, reason: '미설정' }, legacyDecisions, { totalUsd: 0, byModel: {} }, [])).toBe(legacyMessage);
    expect(buildMessage(legacyAggregate, 1450, { skipped: true, reason: '미설정' }, legacyDecisions, { totalUsd: 0, byModel: {} }, [], undefined)).toBe(legacyMessage);
  });

  it('성공·무변경·승인 불필요 결과는 기존 브리핑을 그대로 둔다', () => {
    const briefing = { agg: legacyAggregate, decisions: legacyDecisions };
    expect(mergeOpsV1IntoBriefing(briefing, opsSnapshot())).toBe(briefing);
    expect(mergeOpsV1IntoBriefing(briefing, JSON.stringify(opsSnapshot()))).toBe(briefing);
  });

  it('객체와 JSON 문자열을 같은 ops.v1 계약으로 읽는다', () => {
    const changed = opsSnapshot({ run: { changed: true }, summary: { changed: true } });
    expect(normalizeOpsV1Input(JSON.stringify(changed))).toEqual(normalizeOpsV1Input(changed));
  });

  it('변경과 실패/경보만 기존 운영 구역에 합치고 HTML을 이스케이프한다', () => {
    const input = opsSnapshot({
      job: { title: '<콘텐츠> 상태 점검' },
      run: {
        changed: true,
        status: 'failed',
        error: { code: 'fetch_fail', message: '<토큰> 없이 조회 실패', retryable: true },
      },
      summary: { status: 'critical', changed: true },
    });
    const merged = mergeOpsV1IntoBriefing({ agg: legacyAggregate, decisions: legacyDecisions }, input);
    const message = buildMessage(merged.agg, 1450, { skipped: true, reason: '미설정' }, merged.decisions, { totalUsd: 0, byModel: {} }, [], merged.ops);

    expect(merged.ops.changes).toHaveLength(1);
    expect(merged.ops.failures).toHaveLength(1);
    expect(message).toContain('운영원장 변경 감지 <b>1건</b>');
    expect(message).toContain('&lt;콘텐츠&gt; 상태 점검');
    expect(message).toContain('fetch_fail: &lt;토큰&gt; 없이 조회 실패');
    expect(message).not.toContain('<토큰>');
  });

  it('observed/proposed 승인 필요 finding만 읽고 기존 decision_queue와 dedupeKey로 중복 제거한다', () => {
    const existingDecisionDocs = [
      { status: 'pending', type: 'ops', title: '이미 등록됨', dedupeKey: 'same-key', createdAtMs: generatedAt * 1000 - 5000 },
    ];
    const input = opsSnapshot({
      run: { status: 'awaiting_approval', terminal: false, finished_at: null },
      summary: { status: 'warning', finding_count: 4 },
      findings: [
        finding({ key: 'same', dedupe_key: 'same-key', status: 'proposed', fact: '중복 항목', current: '대기', proposed_action: '확인', approval_required: true }),
        finding({ key: 'new', dedupe_key: 'new-key', severity: 'critical', fact: '새 승인 필요', current: '차단', proposed_action: '운영자 확인', approval_required: true }),
        finding({ key: 'done', dedupe_key: 'done-key', severity: 'info', status: 'approved', fact: '이미 승인됨', current: '완료', approval_required: true }),
        finding({ key: 'no-approval', dedupe_key: 'no-key', status: 'proposed', fact: '승인 불필요', current: '관찰' }),
      ],
    });
    const base = { agg: legacyAggregate, decisions: { total: 1, byType: { ops: 1 }, top: [{ title: '이미 등록됨', type: 'ops' }] } };
    const merged = mergeOpsV1IntoBriefing(base, input, { existingDecisionDocs });

    expect(merged.ops.approvals.map((item: { dedupeKey: string }) => item.dedupeKey)).toEqual(['new-key']);
    expect(merged.decisions.total).toBe(2);
    expect(merged.decisions.queueTotal).toBe(1);
    expect(merged.decisions.opsTotal).toBe(1);
    expect(merged.decisions.top[0]).toEqual({ title: '새 승인 필요', type: 'ops' });

    const message = buildMessage(merged.agg, 1450, { skipped: true, reason: '미설정' }, merged.decisions, { totalUsd: 0, byModel: {} }, [], merged.ops);
    expect(message).toContain('확인/승인 대기 <b>2건</b> (운영원장 1건)');
    expect(message.match(/새 승인 필요/g)).toHaveLength(1);
    expect(message).toContain('(승인 대기)');
    expect(message).not.toContain('awaiting_approval');
    expect(message).toContain('Brain 운영 원장에서 확인');
    expect(message).toContain('cocotripkr.com/admin/decisions');
  });

  it('운영원장 승인만 있으면 없는 어드민 카드 링크를 만들지 않는다', () => {
    const input = opsSnapshot({
      run: { status: 'awaiting_approval', terminal: false, finished_at: null },
      summary: { status: 'ok', finding_count: 1 },
      findings: [
        finding({ key: 'approve', dedupe_key: 'approve-key', status: 'proposed', fact: '배포 승인 필요', current: '초안', proposed_action: '검토 후 승인', approval_required: true }),
      ],
    });
    const merged = mergeOpsV1IntoBriefing({ agg: legacyAggregate, decisions: legacyDecisions }, input);
    const message = buildMessage(merged.agg, 1450, { skipped: true, reason: '미설정' }, merged.decisions, { totalUsd: 0, byModel: {} }, [], merged.ops);

    expect(merged.decisions.total).toBe(1);
    expect(message).toContain('배포 승인 필요 <i>(운영원장)</i>');
    expect(message).toContain('Brain 운영 원장에서 확인');
    expect(message).not.toContain('cocotripkr.com/admin/decisions');
  });

  it('잘못된 버전/JSON은 예외나 부분 병합 없이 무시한다', () => {
    const briefing = { agg: legacyAggregate, decisions: legacyDecisions };
    expect(mergeOpsV1IntoBriefing(briefing, '{bad-json')).toBe(briefing);
    expect(mergeOpsV1IntoBriefing(briefing, { ...opsSnapshot(), schema_version: 'ops.v2' })).toBe(briefing);
  });
});
