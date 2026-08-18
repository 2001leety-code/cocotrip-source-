// /charter 결제 요약(Step6 CharterWizard summaryRows · CharterNewPage PaymentPanel) 목적지 라벨 i18n (2026-08-19).
//
// 버그(2026-08-11 실측): Step3(destinationDisplayLabels.ts)는 ja/zh 4언어 사전으로 이미 고쳐졌는데,
//   결제 직전 요약 화면 2곳은 그 사전을 안 불러 ①ja/zh에서 영어 원문이 새고(pricing_spec.json에
//   name_ja/name_zh가 없어서) ②사전 도메인(매트릭스/공항픽업/당일투어) 밖 키는 raw 코드
//   ("seoul-central", "GYEONGJU"...)를 손님에게 그대로(모든 언어에서) 보여줬다.
//     - src/pages/CharterNewPage.tsx PaymentPanel.resolveLocationLabel (destinationLabel)
//     - src/components/charter/CharterWizard.tsx summaryRows (도착 row)
//
// fix: 두 곳 모두 destinationDisplayLabels.ts 의 신규 resolveDestinationKeyLabel 을 먼저 거친다
//   (그 사전도 모르는 키만 기존 동작으로 폴백). 가격/거리/결제 바디는 전혀 건드리지 않는다.
//
// 이 파일이 깨지면: 결제 화면에서 다시 영어/raw 코드가 새고 있는 것이다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveDestinationKeyLabel } from '../../src/components/charter/destinationDisplayLabels';
import {
  AIRPORT_TRANSFER_PRICES,
  DAILY_TOUR_PRICES,
  DISTANCE_MATRIX,
} from '../../src/data/charterPricing';

type Language = 'ko' | 'en' | 'ja' | 'zh';
const LANGS: Language[] = ['ko', 'en', 'ja', 'zh'];

function src(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

// pricing_spec.json 의 목적지 키 전수 — Step3(Step3Destination.tsx)가 실제로 렌더하는 것과
// 동일한 3개 도메인(매트릭스 21 · 공항픽업 12 · 당일투어 7 = 40개, 2026-08-19 실측).
const MATRIX_DEST_KEYS = Array.from(
  new Set(
    Object.keys(DISTANCE_MATRIX)
      .filter((k) => k.includes('→'))
      .map((k) => k.split('→')[1]),
  ),
);
const AIRPORT_DEST_KEYS = Object.keys(AIRPORT_TRANSFER_PRICES);
const DAY_TOUR_DEST_KEYS = Object.keys(DAILY_TOUR_PRICES);
const ALL_DEST_KEYS = [...MATRIX_DEST_KEYS, ...AIRPORT_DEST_KEYS, ...DAY_TOUR_DEST_KEYS];

describe('resolveDestinationKeyLabel — pricing_spec 목적지 키 전수', () => {
  it('세 도메인 키가 서로 겹치지 않는다 (service 분기 없이 순서 조회가 안전한 전제)', () => {
    expect(new Set(ALL_DEST_KEYS).size).toBe(ALL_DEST_KEYS.length);
    expect(ALL_DEST_KEYS.length).toBe(40);
  });

  it.each(LANGS)('%s: 매트릭스 21개 목적지가 raw 코드로 노출되지 않는다', (lang) => {
    for (const key of MATRIX_DEST_KEYS) {
      expect(resolveDestinationKeyLabel(key, lang), key).not.toBe(key);
    }
  });

  it.each(LANGS)('%s: 공항픽업 12개 목적지가 raw 코드로 노출되지 않는다', (lang) => {
    for (const key of AIRPORT_DEST_KEYS) {
      expect(resolveDestinationKeyLabel(key, lang), key).not.toBe(key);
    }
  });

  it.each(LANGS)('%s: 당일투어 7개 목적지가 raw 코드로 노출되지 않는다', (lang) => {
    for (const key of DAY_TOUR_DEST_KEYS) {
      expect(resolveDestinationKeyLabel(key, lang), key).not.toBe(key);
    }
  });

  it.each(['ja', 'zh'] as const)('%s: 공항픽업 12개 목적지가 영어 원문(name_en)으로 새지 않는다', (lang) => {
    for (const [key, entry] of Object.entries(AIRPORT_TRANSFER_PRICES)) {
      const label = resolveDestinationKeyLabel(key, lang);
      expect(label, `${key} → "${label}" 가 영어 원문이다`).not.toBe(entry.en);
    }
  });

  it.each(['ja', 'zh'] as const)('%s: 당일투어 7개 목적지가 영어 원문(name_en)으로 새지 않는다', (lang) => {
    for (const [key, entry] of Object.entries(DAILY_TOUR_PRICES)) {
      const label = resolveDestinationKeyLabel(key, lang);
      expect(label, `${key} → "${label}" 가 영어 원문이다`).not.toBe(entry.en);
    }
  });

  // 매트릭스는 destinationDisplayLabels 사전이 ko/en/ja/zh 를 전부 소유해서 "영어로 샌다"는
  // 개념이 없다 — 대신 언어별로 서로 다른 문자열인지 재확인(정적 사전 누락 조기 발견용).
  it.each(MATRIX_DEST_KEYS)('매트릭스 %s: 4언어가 서로 다른 문자열이다', (key) => {
    const labels = LANGS.map((lang) => resolveDestinationKeyLabel(key, lang));
    expect(new Set(labels).size).toBeGreaterThan(1);
  });

  it('사전 3곳 어디에도 없는 키 — 명시적 fallback 이 있으면 그걸 쓰고, 없으면 raw key(최후수단)', () => {
    expect(resolveDestinationKeyLabel('not-a-real-key', 'ja', 'Some Fallback')).toBe('Some Fallback');
    // fallback 을 안 준 경우에만 raw key 로 떨어진다 — 사전 3곳 다 모르는 키는 이게 유일한 선택지.
    expect(resolveDestinationKeyLabel('not-a-real-key', 'zh')).toBe('not-a-real-key');
  });

  it('key 가 없으면(null/undefined) fallback, fallback 도 없으면 "-"', () => {
    expect(resolveDestinationKeyLabel(undefined, 'en')).toBe('-');
    expect(resolveDestinationKeyLabel(null, 'en', 'Custom')).toBe('Custom');
  });
});

describe('결제 요약 2곳 — destinationKey 를 raw 로 보여주지 않고 사전을 먼저 거친다 (배선 잠금)', () => {
  it('CharterNewPage.tsx PaymentPanel.destinationLabel 이 resolveDestinationKeyLabel 을 먼저 거친다', () => {
    const code = src('src/pages/CharterNewPage.tsx');
    expect(code).toMatch(/from ['"]@\/components\/charter\/destinationDisplayLabels['"]/);
    expect(code).toMatch(
      /resolveDestinationKeyLabel\(state\.destinationKey, language, resolveLocationLabel\(state\.destinationKey\)\)/,
    );
  });

  it('CharterWizard.tsx summaryRows 도착 row 가 resolveDestinationKeyLabel 을 먼저 거친다', () => {
    const code = src('src/components/charter/CharterWizard.tsx');
    expect(code).toMatch(/from ['"]\.\/destinationDisplayLabels['"]/);
    expect(code).toMatch(/resolveDestinationKeyLabel\(state\.destinationKey, language\)/);
  });
});
