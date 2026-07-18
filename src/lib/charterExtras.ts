// charterExtras.ts — 차터 옵션(면허가이드·픽켓·카시트)·야간할증 프론트 계산.
//
// 🔴 청구 정본 = api/_shared/charter-extras.js (createPaypalOrder / resolve-line-item 가산).
//   이 모듈은 그 미러 — resolveProductType(결제 표시가)·useQuoteCalculator(견적 표시)가 소비해
//   표시가==청구가(P311)를 유지한다. 변경 시 두 곳 동기 필수 —
//   tests/unit/charter-extras-parity.test.ts 가 가드.
//
// 규칙 (서버와 동일):
//   - sprinter: 면허 가이드 법적 필수 → 자동 가산, licensedGuide 옵션 무시(중복 방지).
//   - staria/staria_9: licensedGuide 선택 시 englishGuidePerDay 가산.
//   - airportPicket / childSeat: 정액 가산.
//   - night: (코어 + 옵션합) × nightSurchargePercent% 반올림.
import { EXTRA_CHARGES, VEHICLE_TYPES } from '@/data/charterPricing';
import type { WizardState, QuoteAddon } from '@/components/charter/types';

export interface CharterExtras {
  addons: QuoteAddon[];
  addonsKRW: number;
  surchargeKRW: number;
  surchargePercent: number;
  totalKRW: number;
}

const EMPTY: CharterExtras = { addons: [], addonsKRW: 0, surchargeKRW: 0, surchargePercent: 0, totalKRW: 0 };

/** 픽업시각(HH:mm) → 야간 여부 (18:00~05:59). 서버 api/_shared/charter-extras.js deriveNightFromPickup 미러.
 *  유효 시각 아니면 null. */
export function deriveNightFromPickup(pickupTime: string | null | undefined): boolean | null {
  const m = String(pickupTime || '').match(/^([01]\d|2[0-3]):[0-5]\d/);
  if (!m) return null;
  const h = Number(m[1]);
  return h >= 18 || h < 6;
}

/** night 를 pickupTime 에서 재파생한 options — 서버(createPaypalOrder)가 청구 시 동일 override 를
 *  하므로 표시측도 이 함수를 거쳐야 표시가==청구가. (2026-07-18 재점검: 결제패널 시간 edit 등
 *  options.night 갱신을 놓치는 writer 가 생겨도 여기서 구조적으로 봉합.) */
export function withDerivedNight(
  options: WizardState['options'] | null | undefined,
  pickupTime: string | null | undefined,
): WizardState['options'] {
  const base = options || {};
  const derived = deriveNightFromPickup(pickupTime);
  if (derived === null) return base;
  return { ...base, night: derived };
}

/** 옵션·야간할증 KRW — coreKrw(코어 상품가) 기준. 서버 charterExtrasKrw 미러. */
export function charterExtrasKrw(
  coreKrw: number | null | undefined,
  vehicle: string | null | undefined,
  options: WizardState['options'] | null | undefined,
): CharterExtras {
  const core = Number(coreKrw);
  if (!Number.isFinite(core) || core <= 0) return EMPTY;
  const opt = options || {};

  const addons: QuoteAddon[] = [];
  if (vehicle === 'sprinter') {
    const v = VEHICLE_TYPES.sprinter as unknown as { guideFeeDailyKRW?: number };
    const fee = v.guideFeeDailyKRW || EXTRA_CHARGES.licensedGuidePerDay || 300_000;
    addons.push({ key: 'guide_required', label: `면허 가이드 동행 (${vehicle}, 법적 필수)`, amountKRW: fee });
  } else if (opt.licensedGuide === true) {
    addons.push({ key: 'licensed_guide', label: '면허 가이드 (영/일/중)', amountKRW: EXTRA_CHARGES.englishGuidePerDay || 300_000 });
  }
  if (opt.airportPicket === true) addons.push({ key: 'airport_picket', label: '공항 픽켓 서비스', amountKRW: EXTRA_CHARGES.airportPicketService || 20_000 });
  if (opt.childSeat === true) addons.push({ key: 'child_seat', label: '카시트', amountKRW: EXTRA_CHARGES.childSeatPerTrip || 20_000 });

  const addonsKRW = addons.reduce((s, a) => s + a.amountKRW, 0);
  const nightPct = EXTRA_CHARGES.nightSurchargePercent || 20;
  const isNight = opt.night === true;
  const surchargeKRW = isNight ? Math.round((core + addonsKRW) * (nightPct / 100)) : 0;

  return {
    addons,
    addonsKRW,
    surchargeKRW,
    surchargePercent: isNight ? nightPct : 0,
    totalKRW: addonsKRW + surchargeKRW,
  };
}

/** 옵션 행 4언어 라벨 — Step6 전용 영수증(MultiDay/Transfer/Tour)·요약 표시용. */
const ADDON_LABELS: Record<string, Record<'ko' | 'en' | 'ja' | 'zh', string>> = {
  licensed_guide: { ko: '면허 가이드 (영/일/중)', en: 'Licensed guide (EN/JA/ZH)', ja: '有資格ガイド（英/日/中）', zh: '持证导游（英/日/中）' },
  guide_required: { ko: '면허 가이드 동행 (법적 필수)', en: 'Licensed guide (legally required)', ja: '有資格ガイド同行（法定必須）', zh: '持证导游随行（法定必须）' },
  airport_picket: { ko: '공항 픽켓 서비스', en: 'Airport pickup sign', ja: '空港ピケットサービス', zh: '机场举牌服务' },
  child_seat: { ko: '카시트', en: 'Child seat', ja: 'チャイルドシート', zh: '儿童安全座椅' },
  night: { ko: '야간 할증', en: 'Night surcharge', ja: '夜間割増', zh: '夜间附加费' },
};

export function charterAddonLabel(key: string, language: string | null | undefined): string {
  const lang = (language === 'ko' || language === 'ja' || language === 'zh') ? language : 'en';
  const entry = ADDON_LABELS[key];
  return entry ? entry[lang] : key;
}

/** createPaypalOrder body.options 페이로드 — boolean true 만 전달 (서버 sanitize 와 동형). */
export function charterOptionsBody(options: WizardState['options'] | null | undefined): {
  licensedGuide: boolean; airportPicket: boolean; childSeat: boolean; night: boolean;
} {
  const o = options || {};
  return {
    licensedGuide: o.licensedGuide === true,
    airportPicket: o.airportPicket === true,
    childSeat: o.childSeat === true,
    night: o.night === true,
  };
}
