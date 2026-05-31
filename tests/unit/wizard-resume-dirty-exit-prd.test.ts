// @vitest-environment jsdom
// (markWizardDirtyExit 가 localStorage 전역에 접근 → jsdom 채택. 레포 관례:
//  주석 첫 줄 `// @vitest-environment jsdom`. P316 테스트와 동일 패턴.)
//
// PR-D (2026-06-01): resume "이어서 작성" modal 과노출 fix — 진짜 중단 신호 기반.
//
// 운영자 신고: resume modal 이 "의미있는 입력" 만 보고 떠서, 잠깐 둘러보다 정상적으로
// 나간 경우에도 무분별하게 뜸. "정상 이탈 vs 사고 이탈" 을 구분 못 함.
//
// 3 fix (전부 VITE_FEATURE_RESUME_DIRTY_EXIT='true' 플래그 뒤):
//  1. dirtyExit: pagehide 가 "사고 이탈" 마커 동기 기록 → 마커 있을 때만 modal.
//  2. 임계값 ≥2: 명시적 사용자 시그널 2개 이상 (식이/알레르기는 단독 허용 — SAFETY).
//  3. discard 양쪽 키: 'planner' + 'planner_paused' 모두 정리.
//
// 이 테스트는 1·2·3 의 순수함수 / localStorage 헬퍼 단위를 박제한다. 컴포넌트의
// 플래그 분기 자체는 e2e(Playwright) 영역이라 여기선 "OFF 경로가 쓰는 기존 게이트"
// 의 불변성(byte-identical 보장의 근거)도 함께 확인한다.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasMeaningfulWizardContent,
  hasMeaningfulWizardContentStrict,
  countMeaningfulWizardSignals,
  PAX_INPUT_DEFAULT,
} from '../../src/components/WizardForm/snapshotContent';
import {
  markWizardDirtyExit,
  clearPlannerWizardSnapshot,
  loadFreshestWizardSnapshot,
  loadWizardSnapshot,
  type WizardSnapshot,
} from '../../src/hooks/useWizardPersistence';

const PREFIX = 'cocotrip:wizard:';

function writeSnap(ns: string, values: Record<string, unknown>, step: number, ts: number) {
  const snap: WizardSnapshot<Record<string, unknown>> = { values, step, ts };
  localStorage.setItem(PREFIX + ns, JSON.stringify(snap));
}
function readSnap(ns: string): WizardSnapshot<Record<string, unknown>> | null {
  const raw = localStorage.getItem(PREFIX + ns);
  return raw ? (JSON.parse(raw) as WizardSnapshot<Record<string, unknown>>) : null;
}

beforeEach(() => {
  localStorage.clear();
});

// ─── Fix #2: 임계값 ≥2 신호 (strict 게이트) ───────────────────────────────
describe('hasMeaningfulWizardContentStrict — 의미있는 시그널 ≥2 (PR-D)', () => {
  it('빈/null/undefined → false', () => {
    expect(hasMeaningfulWizardContentStrict({})).toBe(false);
    expect(hasMeaningfulWizardContentStrict(null)).toBe(false);
    expect(hasMeaningfulWizardContentStrict(undefined)).toBe(false);
  });

  it('단일 시그널 → false (과노출 완화 핵심)', () => {
    // 기존 hasMeaningfulWizardContent 는 아래 모두 true 였지만, strict 는 1개만으론 미달.
    expect(hasMeaningfulWizardContentStrict({ mainCity: 'Seoul' })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ dateRangeTo: '2026-06-05' })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ selectedActivities: ['Food'] })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ freeText: 'HYBE' })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ hotelAddress: '명동 호텔' })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ reservationStatus: 'booked' })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ paxInput: '3' })).toBe(false);
  });

  it('시그널 2개 이상 → true', () => {
    expect(hasMeaningfulWizardContentStrict({ mainCity: 'Seoul', dateRangeTo: '2026-06-05' })).toBe(true);
    expect(hasMeaningfulWizardContentStrict({ mainCity: 'Busan', selectedActivities: ['Food'] })).toBe(true);
    expect(hasMeaningfulWizardContentStrict({ reservationStatus: 'booked', paxInput: '4' })).toBe(true);
    expect(hasMeaningfulWizardContentStrict({ freeText: 'HYBE', hotelAddress: '명동 호텔' })).toBe(true);
  });

  it('SAFETY: 식이제한 단독 → true (건강 데이터 — 잃으면 안 됨)', () => {
    expect(hasMeaningfulWizardContentStrict({ dietPrefs: ['halal'] })).toBe(true);
    expect(hasMeaningfulWizardContentStrict({ dietPrefs: ['vegan'] })).toBe(true);
  });

  it('SAFETY: 알레르기 단독 → true', () => {
    expect(hasMeaningfulWizardContentStrict({ allergies: ['peanuts'] })).toBe(true);
  });

  it('빈 식이/알레르기 배열은 시그널 아님 (단독 false)', () => {
    expect(hasMeaningfulWizardContentStrict({ dietPrefs: [] })).toBe(false);
    expect(hasMeaningfulWizardContentStrict({ allergies: [] })).toBe(false);
  });

  it('기본 paxInput="2" 는 시그널로 세지 않음', () => {
    // mainCity(1) + 기본 pax(0) = 1 → 미달.
    expect(hasMeaningfulWizardContentStrict({ mainCity: 'Seoul', paxInput: PAX_INPUT_DEFAULT })).toBe(false);
    // mainCity(1) + 변경 pax '3'(1) = 2 → 통과.
    expect(hasMeaningfulWizardContentStrict({ mainCity: 'Seoul', paxInput: '3' })).toBe(true);
  });

  it('dirtyExit 마커는 시그널 카운트에 포함되지 않음 (라이프사이클 신호)', () => {
    // dirtyExit 만으론 콘텐츠 0 → modal 트리거 안 됨 (콘텐츠 가드가 별도로 작동).
    expect(countMeaningfulWizardSignals({ dirtyExit: true } as Record<string, never>)).toBe(0);
    expect(hasMeaningfulWizardContentStrict({ dirtyExit: true } as Record<string, never>)).toBe(false);
    // 콘텐츠 2개 + dirtyExit 여도 카운트는 콘텐츠만 = 2.
    expect(countMeaningfulWizardSignals({ mainCity: 'Seoul', dateRangeTo: '2026-06-05', dirtyExit: true })).toBe(2);
  });

  it('countMeaningfulWizardSignals 카운트 정확도', () => {
    expect(countMeaningfulWizardSignals({})).toBe(0);
    expect(countMeaningfulWizardSignals(null)).toBe(0);
    expect(countMeaningfulWizardSignals({ mainCity: 'Seoul' })).toBe(1);
    expect(countMeaningfulWizardSignals({
      mainCity: 'Seoul', dateRangeTo: '2026-06-05', selectedActivities: ['Food'], paxInput: '3',
    })).toBe(4);
  });
});

// ─── Fix #1: dirtyExit 마커 (pagehide 동기 기록) ──────────────────────────
describe('markWizardDirtyExit — 사고 이탈 마커 (PR-D)', () => {
  it('저장된 snapshot 의 values.dirtyExit 를 true 로 설정', () => {
    writeSnap('planner', { mainCity: 'Seoul', dateRangeTo: '2026-06-05' }, 2, Date.now());
    markWizardDirtyExit('planner', true);
    const snap = readSnap('planner');
    expect(snap?.values.dirtyExit).toBe(true);
  });

  it('snapshot 이 없으면 noop — 새로 만들지 않음 (빈 noise 방지)', () => {
    markWizardDirtyExit('planner', true);
    expect(localStorage.getItem(PREFIX + 'planner')).toBeNull();
  });

  it('dirty=false 로 마커 해제 가능 — snapshot 자체는 보존 (P316 retention)', () => {
    writeSnap('planner', { mainCity: 'Seoul', dateRangeTo: '2026-06-05', dirtyExit: true }, 2, Date.now());
    markWizardDirtyExit('planner', false);
    const snap = readSnap('planner');
    expect(snap).not.toBeNull();           // 보존됨
    expect(snap?.values.dirtyExit).toBe(false);
    expect(snap?.values.mainCity).toBe('Seoul'); // 다른 값 유지
  });

  it('다른 values 와 step / ts 를 건드리지 않음', () => {
    const ts = Date.now() - 1234;
    writeSnap('planner', { mainCity: 'Busan', freeText: 'keep me' }, 3, ts);
    markWizardDirtyExit('planner', true);
    const snap = readSnap('planner');
    expect(snap?.values.mainCity).toBe('Busan');
    expect(snap?.values.freeText).toBe('keep me');
    expect(snap?.step).toBe(3);
    expect(snap?.ts).toBe(ts); // ts 불변 → stale 판정/최신 선택 로직 영향 0
  });

  it('손상된(JSON 깨진) snapshot 에서도 throw 하지 않음 (silent)', () => {
    localStorage.setItem(PREFIX + 'planner', '{not json');
    expect(() => markWizardDirtyExit('planner', true)).not.toThrow();
  });
});

// ─── 통합: dirtyExit + strict 게이트가 함께 작동하는 트리거 의미 ───────────
describe('좁힌 트리거 의미 (flag ON 시 hasContent && dirtyExit)', () => {
  // 컴포넌트 트리거는 (RESUME_DIRTY_EXIT_ON ? strict : base) && (ON ? dirtyExit : true).
  // 여기선 그 AND 게이트의 진리표를 순수 단위로 박제.
  function wouldOpenWhenOn(v: Record<string, unknown>): boolean {
    return hasMeaningfulWizardContentStrict(v) && !!v.dirtyExit;
  }

  it('콘텐츠 ≥2 + dirtyExit 있음 → 노출', () => {
    expect(wouldOpenWhenOn({ mainCity: 'Seoul', dateRangeTo: '2026-06-05', dirtyExit: true })).toBe(true);
  });

  it('콘텐츠 ≥2 + dirtyExit 없음 → 미노출 (정상 이탈로 간주)', () => {
    expect(wouldOpenWhenOn({ mainCity: 'Seoul', dateRangeTo: '2026-06-05' })).toBe(false);
  });

  it('콘텐츠 1개 + dirtyExit 있음 → 미노출 (콘텐츠 가드 미달)', () => {
    expect(wouldOpenWhenOn({ mainCity: 'Seoul', dirtyExit: true })).toBe(false);
  });

  it('SAFETY 식이 단독 + dirtyExit 있음 → 노출 (건강 데이터 보존)', () => {
    expect(wouldOpenWhenOn({ dietPrefs: ['halal'], dirtyExit: true })).toBe(true);
  });
});

// ─── Fix #3: discard 양쪽 키 (flag ON 경로) ───────────────────────────────
describe('discard 양쪽 키 정리 (PR-D, flag ON 경로)', () => {
  it('clearPlannerWizardSnapshot 가 planner + planner_paused 모두 제거', () => {
    writeSnap('planner', { mainCity: 'Seoul', dirtyExit: true }, 2, Date.now());
    writeSnap('planner_paused', { mainCity: 'Busan', dirtyExit: true }, 3, Date.now());
    clearPlannerWizardSnapshot();
    expect(loadWizardSnapshot('planner')).toBeNull();
    expect(loadWizardSnapshot('planner_paused')).toBeNull();
    // 다음 마운트에서 freshest 도 null → 재노출 회귀 없음 (기존 'planner_paused' 잔존 버그 해소).
    expect(loadFreshestWizardSnapshot('planner', 'planner_paused')).toBeNull();
  });
});

// ─── 플래그 OFF 불변성 근거: 기존 게이트는 그대로 (byte-identical 보장) ────
describe('flag OFF 경로 불변성 — 기존 hasMeaningfulWizardContent 유지', () => {
  it('OFF 게이트는 여전히 단일 시그널로 true (기존 prod 동작)', () => {
    // OFF 경로가 쓰는 함수가 강화되지 않았음을 박제 → 플래그 OFF 동작 byte-identical 근거.
    expect(hasMeaningfulWizardContent({ mainCity: 'Seoul', selectedActivities: ['Food'] })).toBe(true);
    expect(hasMeaningfulWizardContent({ dateRangeTo: '2026-06-05' })).toBe(true);
    expect(hasMeaningfulWizardContent({ reservationStatus: 'booked' })).toBe(true);
  });

  it('OFF 게이트도 P126/P151 false-positive 는 여전히 차단', () => {
    expect(hasMeaningfulWizardContent({ mainCity: 'Seoul' })).toBe(false); // P151 단독 도시
    expect(hasMeaningfulWizardContent({ paxInput: PAX_INPUT_DEFAULT, dateRangeTo: null })).toBe(false); // P126
  });
});
