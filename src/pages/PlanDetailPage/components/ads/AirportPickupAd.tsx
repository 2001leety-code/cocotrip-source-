// 공항 픽업 인라인 예약 카드.
// 2026-05-05 (운영자 요청): 외부 링크 (WhatsApp) 대신 wrap-up 안에서 바로 결제까지.
// InlineBookingCard 재사용 — productType 키는 api/_shared/pricing.js 의 airport_*
// 매핑과 동일해야 한다 (`airport_seoul-central` → `seoul-central` 키 lookup).
import { Plane } from 'lucide-react';
import { InlineBookingCard, type InlineBookingOption } from './InlineBookingCard';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

interface AirportPickupAdProps {
  arrivalAirport: string;
  /** Plan 의 startDate (YYYY-MM-DD) — 기본값으로 미리 채움 */
  defaultDate?: string;
  defaultPax?: number;
  /** PlanDocument planId — booking memo 에 포함 (어드민 매칭용) */
  planId?: string;
}

// 공항별 노선 + 가격 — api/_pricing_spec.json 의 airport_transfer_prices 와 동기.
// productType: airport_<key> (key 는 dash 구분 → braintreeCheckout 가 underscore 변환).
//
// batch 9 (B9-23): 운영자 5/9 결정으로 GMP 가격 통합 변경:
//   서울 도심 ₩83,200 → ₩90,000 (운영자 명시)
//   강남·잠실   ₩93,600 → ₩100,000 (운영자 명시)
// batch 9 (B9-23): PUS 부산 시내 ₩600,000 — 다른 공항 대비 6배 이상함.
//   src/config/affiliateLinks.ts L235 PICKUP_PRICES.PUS 는 ₩83,200 으로 표기되어 있어
//   데이터 불일치. 운영자 검토 후 합리적 값(₩100,000) 으로 임시 조정 + PR 본문에 명시.
//   장거리 비용·기사 회송비 반영이 필요하면 운영자가 다시 상향 가능.
// 2026-05-09 (B9-38 PUS): 시장 평균 비교 — Klook US$49 (~₩68K), Welcome Pickups
//   ~₩70-95K. ₩100K → ₩70K 로 조정 (시장 평균 일치, 가격 경쟁력 확보).
const PICKUP_OPTIONS_BY_AIRPORT: Record<string, { ko: string; en: string; ja: string; zh: string; key: string; priceKRW: number }[]> = {
  ICN: [
    { key: 'seoul-central', priceKRW: 124800, ko: '서울 도심 (명동·홍대·종로)', en: 'Seoul City Center (Myeongdong, Hongdae, Jongno)', ja: 'ソウル都心 (明洞·弘大·鍾路)', zh: '首尔市中心 (明洞·弘大·钟路)' },
    { key: 'seoul-gangnam', priceKRW: 145600, ko: '강남·잠실·송파', en: 'Gangnam / Jamsil / Songpa', ja: '江南·蚕室·松坡', zh: '江南·蚕室·松坡' },
    { key: 'gapyeong-nami', priceKRW: 208000, ko: '가평·남이섬', en: 'Gapyeong / Nami Island', ja: '加平·南怡島', zh: '加平·南怡岛' },
    { key: 'suwon-yongin', priceKRW: 150000, ko: '수원·용인', en: 'Suwon / Yongin', ja: '水原·龍仁', zh: '水原·龙仁' },
    { key: 'chuncheon', priceKRW: 220000, ko: '춘천', en: 'Chuncheon', ja: '春川', zh: '春川' },
  ],
  GMP: [
    { key: 'seoul-central', priceKRW: 90000, ko: '서울 도심', en: 'Seoul City Center', ja: 'ソウル都心', zh: '首尔市中心' },
    { key: 'seoul-gangnam', priceKRW: 100000, ko: '강남·잠실', en: 'Gangnam / Jamsil', ja: '江南·蚕室', zh: '江南·蚕室' },
  ],
  PUS: [{ key: 'busan', priceKRW: 70000, ko: '부산 시내', en: 'Busan City', ja: '釜山市内', zh: '釜山市区' }],
  CJU: [{ key: 'jeju-city', priceKRW: 72800, ko: '제주 시내', en: 'Jeju City', ja: '済州市内', zh: '济州市区' }],
};

const HEADER: Record<string, { title: string; subtitle: string }> = {
  ko: { title: '공항 픽업 서비스', subtitle: '영어 가능 기사가 도착장에서 대기' },
  en: { title: 'Airport Pickup Service', subtitle: 'English-speaking driver at arrivals' },
  ja: { title: '空港ピックアップ', subtitle: '英語対応のドライバーが到着ロビーでお待ちします' },
  zh: { title: '机场接送服务', subtitle: '英文司机在到达大厅等候' },
};

export function AirportPickupAd({ arrivalAirport, defaultDate, defaultPax, planId }: AirportPickupAdProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';

  const airportCode = (arrivalAirport || 'ICN').replace(/_T[12]$/, '');
  const rows = PICKUP_OPTIONS_BY_AIRPORT[airportCode] || PICKUP_OPTIONS_BY_AIRPORT['ICN'];
  if (!rows || !rows.length) return null;

  const options: InlineBookingOption[] = rows.map((r) => ({
    productType: `airport_${r.key.replace(/-/g, '_')}`,
    label: r[lang],
    priceKRW: r.priceKRW,
  }));

  const h = HEADER[lang];

  return (
    <InlineBookingCard
      title={h.title}
      subtitle={h.subtitle}
      icon={<Plane className="w-6 h-6 text-amber-400" />}
      accent="amber"
      badge={airportCode}
      options={options}
      defaultDate={defaultDate}
      defaultPax={defaultPax}
      userEmail={user?.email || ''}
      planId={planId}
      // batch 9 (B9-11): 공항 픽업 — 캐리어/편명/터미널 추가 입력.
      extraFields="airport"
      // batch 9 (B9-21): 공항별 터미널 분기 (ICN T1/T2, GMP 국내/국제, PUS·CJU 단일=미노출).
      airportCode={airportCode}
    />
  );
}
