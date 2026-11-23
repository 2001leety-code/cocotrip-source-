// @vitest-environment jsdom
//
// 2026-11-23: 재생성 결과 플랜이 "무료 재생성 2회" 를 새로 받아 끝없이 이어 쓰던 구멍.
//   paymentGate 가 원본 횟수를 1 줄이는데, 저장 3곳이 새 플랜에 2 를 그대로 넣었다.
//   고침 = 저장 3곳이 initialRevisionCredits(body) 하나만 쓰고(재생성 결과 = 0), 완성 문서에 revisionOf 기록.
//   처음부터 끝까지(원본 2→1→0, 결과 플랜 0, 결과에서 다시 = 403) 는 ai-coupon-persistence-handler.test.ts,
//   Inngest 뼈대는 p231-skeleton-in-worker.test.ts P231-G3.
import React from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createFakeFirestore } from '../helpers/fake-firestore.js';
import { initialRevisionCredits } from '../../api/_shared/revision-credits.js';
import { savePlanSkeleton } from '../../api/_ai_core/planPersister.js';
import { RevisionCard } from '../../src/pages/PlanDetailPage/components/RevisionCard';

void React;

const lang = vi.hoisted(() => ({ value: 'en' }));
vi.mock('@/hooks/useLanguage', () => ({ useLanguage: () => ({ language: lang.value, t: (k: string) => k }) }));
vi.mock('@/lib/authFetch', () => ({ authFetch: vi.fn(async () => ({ ok: true })) }));

describe('initialRevisionCredits', () => {
  it('paid/coupon plan = 2, revision result = 0', () => {
    expect(initialRevisionCredits({})).toBe(2);
    expect(initialRevisionCredits(undefined)).toBe(2);
    expect(initialRevisionCredits({ revisionOf: '' })).toBe(2);
    expect(initialRevisionCredits({ revisionOf: 'orig-plan' })).toBe(0);
  });
});

describe('lock — no write site hardcodes a revisionCredits number', () => {
  it('api/ has no `revisionCredits: <digit>` literal (use initialRevisionCredits)', () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue; }
        if (!/\.(m?js|ts)$/.test(name)) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          // object key only — `d.revisionCredits : 0` (ternary read) is not a write site.
          if (/(?<![.\w])revisionCredits\s*:\s*\d/.test(line)) hits.push(`${p}:${i + 1}`);
        });
      }
    };
    walk(resolve(process.cwd(), 'api'));
    expect(hits).toEqual([]);
  });
});

describe('savePlanSkeleton', () => {
  const base = { uid: 'u1', email: null, area: 'seoul', startDate: '2026-12-01', guestName: 'G', pax: 2, language: 'en', vehicle: null, priceKRW: 0, priceUSD: 0 };
  it('normal plan skeleton = 2 credits', async () => {
    const db = createFakeFirestore();
    const { planId } = await savePlanSkeleton(db, { ...base, body: {} });
    expect(db.__get(`plans/${planId}`)).toMatchObject({ revisionCredits: 2, revisionCount: 0 });
  });
  it('revision result skeleton = 0 credits', async () => {
    const db = createFakeFirestore();
    const { planId } = await savePlanSkeleton(db, { ...base, body: { revisionOf: 'orig-plan' } });
    expect(db.__get(`plans/${planId}`)).toMatchObject({ revisionCredits: 0, revisionCount: 0 });
  });
});

describe('RevisionCard', () => {
  const RESULT = { ko: '원래 플랜 열기', en: 'Open original plan', ja: '元のプランを開く', zh: '打开原行程' } as const;

  it.each(Object.entries(RESULT))('revision result with 0 credits → points to original plan (%s)', (code, open) => {
    lang.value = code;
    render(<RevisionCard plan={{ revisionCredits: 0, revisionOf: 'orig/../x' }} planId="child" token={null} />);
    const link = screen.getByText(open).closest('a');
    expect(link?.getAttribute('href')).toBe(`/my-plans/${encodeURIComponent('orig/../x')}`);
    expect(screen.queryByText(/WhatsApp/)).toBeNull();
  });

  it('normal plan with 0 credits → unchanged exhausted card', () => {
    lang.value = 'en';
    render(<RevisionCard plan={{ revisionCredits: 0 }} planId="p" token={null} />);
    expect(screen.getByText('Free Revisions Used Up')).toBeTruthy();
    expect(screen.queryByText(RESULT.en)).toBeNull();
  });

  it('plan with credits → unchanged regenerate button', () => {
    lang.value = 'en';
    render(<RevisionCard plan={{ revisionCredits: 1 }} planId="p" token={null} />);
    expect(screen.getByText('1 Free Revision remaining')).toBeTruthy();
    expect(screen.queryByText(RESULT.en)).toBeNull();
  });
});
