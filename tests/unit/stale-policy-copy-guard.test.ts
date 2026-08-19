/**
 * Stale/contradictory customer-facing copy guard (2026-08-19).
 *
 * 사고: 몇몇 화면·이메일 문구가 실제 정책과 어긋난 채 남아있었다 —
 *  - CharterWizard 사이드바에 리터럴 "12h" (실제 전세차량 마감 = 1h, CHARTER_VEHICLE_CUTOFF_HOURS).
 *    같은 파일 헤더 칩은 이미 derived cutoffHours 를 쓰는데 사이드바만 리터럴로 남아있었다
 *    (한쪽만 고침 8번째 사례 — 형제 리터럴 잔존).
 *  - 환불 처리 소요일이 화면(3~5영업일)과 정책표(7~10영업일)에서 서로 달랐다. 7~10영업일로 통일.
 *  - 심야 할증 라벨이 "(00:00–06:00)" 이었으나 실제 SSOT(api/_shared/charter-extras.js
 *    deriveNightFromPickup, frontend h>=18||h<6)는 18:00~05:59.
 *  - 존재한 적 없는 정책("불만족 시 100% 환불")·실제와 다른 지원시간(24/7) 을 약속하는 죽은
 *    i18n 키들이 남아있었다 — 콜사이트 0건 확인 후 4개 로케일에서 전부 삭제.
 *
 * 잠금: 이 문구들이 다시 들어오지 않도록 소스/로케일 텍스트를 직접 검사한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOTES } from '../../src/components/tours/refundPolicyData';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const LOCALE_LANGS = ['ko', 'en', 'ja', 'zh'] as const;
const locale = (lang: string) => JSON.parse(read(`src/i18n/locales/${lang}.json`));

describe('Locale JSON — 죽은 약속 문구·삭제된 키가 없다', () => {
  const FORBIDDEN_TEXT = [
    '불만족 시 100% 환불',
    '100% refund if unsatisfied',
    '24/7 Support',
    '24/7 response',
    '24時間サポート',
    '24小时支持',
    '24時間対応',
    '(00:00–06:00)',
  ];
  const DELETED_KEYS = [
    'paypalSafeCheckout',
    'support24h',
    'charterCTANote',
    'csSectionTitle',
    'csPaymentPolicy',
    'csCancelPolicy',
    'csBotTitle',
    'csBotDesc',
    'csBotWelcome',
    'csEmergencyContact',
    'checkoutTip2',
  ];

  for (const lang of LOCALE_LANGS) {
    it(`${lang}.json 에 근거 없는 문구/삭제된 키가 없다`, () => {
      const raw = read(`src/i18n/locales/${lang}.json`);
      for (const text of FORBIDDEN_TEXT) {
        expect(raw).not.toContain(text);
      }
      for (const key of DELETED_KEYS) {
        expect(raw).not.toContain(`"${key}"`);
      }
    });
  }
});

describe('CharterWizard — 사이드바 예약 마감이 리터럴 12h 가 아니라 derived cutoffHours 를 쓴다', () => {
  const src = read('src/components/charter/CharterWizard.tsx');

  it('하드코딩된 >12h< 리터럴이 없다', () => {
    expect(src).not.toMatch(/>12h</);
  });

  it('사이드바가 헤더 칩과 같은 cutoffHours 변수를 렌더한다', () => {
    expect(src).toMatch(/\{cutoffHours\}h</);
  });
});

describe('환불 처리 소요일 — 정책표·모달·이메일이 같은 값(7~10영업일)을 말한다', () => {
  const SEVEN_TO_TEN = /7[~〜-]10/;

  it('refundPolicyData NOTES 4개 언어 모두 7~10 을 포함한다', () => {
    for (const lang of LOCALE_LANGS) {
      const combined = NOTES[lang].join(' ');
      expect(combined, `${lang} NOTES`).toMatch(SEVEN_TO_TEN);
    }
  });

  it('mbCancelConfirm (4개 로케일) 이 모두 7~10 을 포함한다 (3~5 잔존 금지)', () => {
    for (const lang of LOCALE_LANGS) {
      const text = locale(lang).charterWizard?.mbCancelConfirm || locale(lang).mbCancelConfirm;
      expect(text, `${lang} mbCancelConfirm`).toMatch(SEVEN_TO_TEN);
      expect(text).not.toMatch(/3[~〜-]5/);
    }
  });

  it('api/_booking-templates.js cancelEmailHtml 이 7~10 을 포함한다 (3~5 잔존 금지)', () => {
    const src = read('api/_booking-templates.js');
    expect(src).toMatch(SEVEN_TO_TEN);
    expect(src).not.toMatch(/3[~-]5/);
  });
});
