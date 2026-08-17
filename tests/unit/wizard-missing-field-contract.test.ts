/**
 * 위저드 미작성 안내 — 되돌아가기 방지 잠금 (2026-08-18).
 *
 * 동작 자체는 `wizard-missing-field-guidance.component.test.tsx` 가 진짜 DOM 으로 본다.
 * 이 파일은 **다시 옛날로 돌아가는 세 가지 길**을 막는다.
 *
 *   ① 필수 게이트가 있는 스텝인데 `revealFirstMissing` 을 안 부르는 것
 *      → 문구만 켜지고 화면이 안 움직이던 그 상태로 복귀한다.
 *   ② 예약 상황 스텝 CTA 를 다시 `disabled` 로 잠그는 것
 *      → 회색 버튼은 이유를 말해주지 않는다.
 *   ③ 항목별 문구 자리에 뭉뚱그린 `wizardFillRequired` 를 되돌려 놓는 것
 *      → 도시·날짜·공항이 전부 "여기 작성해주세요" 로 보이던 상태로 복귀한다.
 *
 * 4언어 키 존재도 여기서 본다 — 한 언어만 넣고 끝내는 실수가 반복돼 왔다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const DESTINATION = read('src/components/WizardForm/WizardStep0Destination.tsx');
const RESERVATION = read('src/components/WizardForm/WizardStep0Reservation.tsx');
const DETAILS = read('src/components/WizardForm/WizardStep2Details.tsx');

/** 필수 게이트가 있는 세 스텝. 새 스텝이 게이트를 갖게 되면 여기 추가할 것. */
const GATED_STEPS: [string, string][] = [
  ['WizardStep0Reservation', RESERVATION],
  ['WizardStep0Destination', DESTINATION],
  ['WizardStep2Details', DETAILS],
];

describe('못 넘어갈 때 첫 빈 칸으로 데려간다', () => {
  for (const [name, src] of GATED_STEPS) {
    it(`${name} — handleNext 가 revealFirstMissing 을 부른다`, () => {
      const guard = src.slice(src.indexOf('function handleNext'));
      const body = guard.slice(0, guard.indexOf('onNext();'));
      expect(body, `${name}: 문구만 켜고 화면을 안 움직이면 버튼이 죽은 것처럼 보인다`)
        .toContain('revealFirstMissing');
    });

    it(`${name} — 포커스 대상에 tabIndex={-1} 이 있다`, () => {
      // tabIndex 가 없으면 focus() 가 조용히 무시되고 스크롤만 남는다.
      expect(src).toContain('tabIndex={-1}');
    });
  }
});

describe('예약 상황 스텝 — CTA 를 다시 잠그지 않는다', () => {
  it('disabled 로 막지 않는다', () => {
    expect(RESERVATION, 'CTA 를 회색으로 잠그면 왜 못 누르는지 알려줄 자리가 사라진다')
      .not.toMatch(/<button[^>]*disabled=\{!canContinue\}/);
  });

  it('canContinue 는 남아 있다 (판정 자체를 지운 게 아니라 표현만 바꿨다)', () => {
    expect(RESERVATION).toContain('const canContinue =');
    expect(RESERVATION).toMatch(/if \(!canContinue\)/);
  });
});

describe('안내 문구는 항목별로', () => {
  const CASES: [string, string, string][] = [
    ['WizardStep0Destination', DESTINATION, 'wizardMissingCity'],
    ['WizardStep0Destination', DESTINATION, 'wizardMissingActivity'],
    ['WizardStep2Details', DETAILS, 'wizardMissingDates'],
    ['WizardStep2Details', DETAILS, 'wizardMissingPax'],
    ['WizardStep2Details', DETAILS, 'wizardMissingAirport'],
    ['WizardStep0Reservation', RESERVATION, 'wizardMissingStatus'],
    ['WizardStep0Reservation', RESERVATION, 'wizardMissingArrivalTime'],
  ];

  for (const [name, src, key] of CASES) {
    it(`${name} 이 ${key} 를 쓴다`, () => {
      expect(src).toContain(key);
    });
  }

  it('뭉뚱그린 wizardFillRequired 가 세 스텝에서 사라졌다', () => {
    for (const [name, src] of GATED_STEPS) {
      expect(src, `${name}: 도시·날짜·공항이 전부 같은 문구로 보이던 원인`)
        .not.toContain('wizardFillRequired');
    }
  });
});

describe('4언어', () => {
  const LOCALES = ['en', 'ko', 'ja', 'zh'] as const;
  const KEYS = [
    'wizardMissingTitle',
    'wizardMissingCity',
    'wizardMissingActivity',
    'wizardMissingDates',
    'wizardMissingPax',
    'wizardMissingAirport',
    'wizardMissingStatus',
    'wizardMissingArrivalTime',
  ];

  for (const locale of LOCALES) {
    it(`${locale}.json 에 8개 키가 다 있고 비어 있지 않다`, () => {
      const planner = JSON.parse(read(`src/i18n/locales/${locale}.json`)).planner as Record<string, string>;
      for (const key of KEYS) {
        expect(planner[key], `${locale}: ${key} 누락`).toBeTruthy();
      }
    });
  }

  it('언어마다 문구가 실제로 다르다 (영문을 복사해 둔 게 아니다)', () => {
    const en = JSON.parse(read('src/i18n/locales/en.json')).planner as Record<string, string>;
    const ko = JSON.parse(read('src/i18n/locales/ko.json')).planner as Record<string, string>;
    for (const key of KEYS) {
      expect(ko[key], `ko: ${key} 가 영문 그대로다`).not.toBe(en[key]);
    }
  });
});

describe('motion 헬퍼는 공용 자리에 있다', () => {
  it('컴포넌트가 페이지 디렉터리로 거슬러 올라가지 않는다', () => {
    for (const [name, src] of GATED_STEPS) {
      expect(src, `${name}`).not.toContain('pages/PlannerPage/lib/motion');
    }
    expect(read('src/components/WizardForm/missingFields.ts')).toContain("from '@/lib/motion'");
  });
});
