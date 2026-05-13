// 투어 패키지 인라인 예약 카드 (콤보 패키지: 공항 픽업 + 차터 1일).
// 2026-05-05 (운영자 요청): wrap-up 안에서 인라인 결제.
// P1 #10 fix (2026-05-13): priceKRW hardcode 제거. SSOT pricing_spec.json combo_packages
// 단일 source. UI/backend 양쪽 computeComboPriceKRW() 호출 → drift 0.
//   이전: hardcoded priceKRW (예: combo_airport_busan=₩627,300) vs backend 계산 ₩517,320 → ₩110K 사용자/운영자 mismatch.
//   이후: 동일 공식 (airport+tour) × 0.9 로 UI 도 계산 → mismatch 0.
import { Sparkles } from 'lucide-react';
import { InlineBookingCard, type InlineBookingOption } from './InlineBookingCard';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { COMBO_PACKAGES, computeComboPriceKRW } from '@/data/charterPricing';

interface TourPackageInlineAdProps {
  region?: string;
  arrivalAirport?: string;
  defaultDate?: string;
  defaultPax?: number;
  planId?: string;
}

type ComboLabel = {
  ko: string; en: string; ja: string; zh: string;
  subKo: string; subEn: string; subJa: string; subZh: string;
};

// 라벨/설명만 hardcode (i18n 라벨은 pricing 와 분리 — SSOT 가 가격, 라벨은 UI 텍스트).
const COMBO_LABELS: Record<string, ComboLabel> = {
  combo_airport_seoul: {
    ko: '서울 콤보 패키지', en: 'Seoul Combo Package', ja: 'ソウルコンボパッケージ', zh: '首尔组合套餐',
    subKo: '공항 픽업 + 시내 1일 투어 (10% 할인)', subEn: 'Pickup + Seoul tour (10% off)', subJa: '空港送迎 + 市内ツアー (10%OFF)', subZh: '机场接送 + 市内游 (10%折扣)',
  },
  combo_airport_nami: {
    ko: '서울 + 남이섬 콤보', en: 'Seoul + Nami Combo', ja: 'ソウル + 南怡島コンボ', zh: '首尔 + 南怡岛组合',
    subKo: '공항 픽업 + 남이섬·가평 (10% 할인)', subEn: 'Pickup + Nami & Gapyeong (10% off)', subJa: '空港送迎 + 南怡島·加平 (10%OFF)', subZh: '机场接送 + 南怡岛·加平 (10%折扣)',
  },
  combo_airport_dmz: {
    ko: 'DMZ 콤보', en: 'DMZ Combo', ja: 'DMZコンボ', zh: 'DMZ 套餐',
    subKo: '공항 픽업 + DMZ 투어 (10% 할인)', subEn: 'Pickup + DMZ tour (10% off)', subJa: '空港送迎 + DMZ (10%OFF)', subZh: '机场接送 + DMZ (10%折扣)',
  },
  combo_airport_gangwon: {
    ko: '강원 콤보', en: 'Gangwon Combo', ja: '江原コンボ', zh: '江原套餐',
    subKo: '공항 픽업 + 강원 투어 (10% 할인)', subEn: 'Pickup + Gangwon tour (10% off)', subJa: '空港送迎 + 江原 (10%OFF)', subZh: '机场接送 + 江原 (10%折扣)',
  },
  combo_airport_busan: {
    ko: '부산 콤보', en: 'Busan Combo', ja: '釜山コンボ', zh: '釜山套餐',
    subKo: '공항 픽업 + 부산 1일 투어 (10% 할인)', subEn: 'Pickup + Busan tour (10% off)', subJa: '空港送迎 + 釜山 (10%OFF)', subZh: '机场接送 + 釜山 (10%折扣)',
  },
};

type ComboEntry = {
  productType: string;
  cities: string[];
  priceKRW: number;
  ko: string; en: string; ja: string; zh: string;
  subKo: string; subEn: string; subJa: string; subZh: string;
};

// 런타임 (모듈 로드 시점) 에 SSOT 에서 가격 동적 계산.
// pricing_spec.json combo_packages 변경 시 자동 반영.
const ALL_COMBOS: ComboEntry[] = Object.entries(COMBO_PACKAGES).flatMap(([productType, pkg]) => {
  const priceKRW = computeComboPriceKRW(productType);
  const labels = COMBO_LABELS[productType];
  if (priceKRW == null || !labels) return [];
  return [{
    productType,
    cities: pkg.advertise_cities,
    priceKRW,
    ko: labels.ko, en: labels.en, ja: labels.ja, zh: labels.zh,
    subKo: labels.subKo, subEn: labels.subEn, subJa: labels.subJa, subZh: labels.subZh,
  }];
});

const HEADER: Record<string, { title: string; subtitle: string }> = {
  ko: { title: '추천 투어 패키지', subtitle: '공항 픽업 + 당일 투어 콤보 (10% 할인)' },
  en: { title: 'Recommended Tour Package', subtitle: 'Airport pickup + day tour combo (10% off)' },
  ja: { title: 'おすすめツアーパッケージ', subtitle: '空港送迎 + デーツアー (10%OFF)' },
  zh: { title: '推荐旅游套餐', subtitle: '机场接送 + 一日游组合 (10%折扣)' },
};

function regionToCityKey(region: string | undefined): string {
  const r = String(region || '').toLowerCase().trim();
  if (r.includes('busan') || r.includes('부산') || r.includes('釜山')) return 'busan';
  if (r.includes('jeju') || r.includes('제주')) return 'jeju';
  return 'seoul';
}

export function TourPackageInlineAd({ region, defaultDate, defaultPax, planId }: TourPackageInlineAdProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';

  const cityKey = regionToCityKey(region);
  const filtered = ALL_COMBOS.filter((c) => c.cities.includes(cityKey));
  if (filtered.length === 0) return null;

  const options: InlineBookingOption[] = filtered.map((c) => ({
    productType: c.productType,
    label: c[lang],
    priceKRW: c.priceKRW,
    detail: c[`sub${lang.charAt(0).toUpperCase()}${lang.slice(1)}` as 'subKo' | 'subEn' | 'subJa' | 'subZh'],
  }));

  const h = HEADER[lang];

  return (
    <InlineBookingCard
      title={h.title}
      subtitle={h.subtitle}
      icon={<Sparkles className="w-6 h-6 text-emerald-300" />}
      accent="teal"
      options={options}
      defaultDate={defaultDate}
      defaultPax={defaultPax}
      userEmail={user?.email || ''}
      planId={planId}
      // batch 9 (B9-13): 콤보 (공항 픽업 + 투어) — 둘 다 추가 입력.
      extraFields="combo"
    />
  );
}
