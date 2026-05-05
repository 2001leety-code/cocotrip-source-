// 전용 전세 차량 인라인 예약 카드.
// 2026-05-05 (운영자 요청): 외부 페이지 (cocotripkr.com/charter) 대신 wrap-up 안에서
// 사용자 main city 의 차터 옵션만 노출 + 인라인 결제. InlineBookingCard 재사용.
import { Car } from 'lucide-react';
import { InlineBookingCard, type InlineBookingOption } from './InlineBookingCard';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';

interface CharterInlineAdProps {
  /** plan.input.region 또는 destination — 사용자 main city 식별 */
  region?: string;
  defaultDate?: string;
  defaultPax?: number;
  planId?: string;
}

// api/_pricing_spec.json daily_tour_prices 와 동기. productType 키는
// api/_shared/pricing.js CHARTER_MAP 매핑 (charter_seoul_city → seoul-city).
const ALL_CHARTERS: { key: string; productType: string; priceKRW: number; ko: string; en: string; ja: string; zh: string; cities: string[] }[] = [
  { key: 'seoul-city',    productType: 'charter_seoul_city',   priceKRW: 330000, cities: ['seoul'],   ko: '서울 시내 투어',          en: 'Seoul City Tour',                          ja: 'ソウル市内ツアー',     zh: '首尔市区一日游' },
  { key: 'seoul-suburb',  productType: 'charter_seoul_suburb', priceKRW: 343200, cities: ['seoul'],   ko: '서울 근교 (남이섬·가평·수원)', en: 'Seoul Suburb (Nami Island, Gapyeong, Suwon)', ja: 'ソウル近郊 (南怡島·加平·水原)', zh: '首尔近郊 (南怡岛·加平·水原)' },
  { key: 'dmz',           productType: 'charter_dmz',          priceKRW: 343200, cities: ['seoul'],   ko: 'DMZ 투어',               en: 'DMZ Tour',                                 ja: 'DMZツアー',          zh: 'DMZ 一日游' },
  { key: 'gangwon',       productType: 'charter_gangwon',      priceKRW: 436800, cities: ['seoul', 'gangneung'], ko: '강원 (춘천·강릉·속초)', en: 'Gangwon (Chuncheon, Gangneung, Sokcho)',     ja: '江原 (春川·江陵·束草)', zh: '江原 (春川·江陵·束草)' },
  { key: 'ski-resort',    productType: 'charter_ski',          priceKRW: 416000, cities: ['seoul'],   ko: '스키 리조트 (용평·알펜시아)', en: 'Ski Resort (Yongpyong, Alpensia)',           ja: 'スキーリゾート',       zh: '滑雪度假村' },
  { key: 'gyeongju-jeonju', productType: 'charter_gyeongju',   priceKRW: 468000, cities: ['gyeongju', 'jeonju'], ko: '경주·전주 투어', en: 'Gyeongju / Jeonju Tour',                       ja: '慶州·全州ツアー',    zh: '庆州·全州游' },
  { key: 'busan',         productType: 'charter_busan',        priceKRW: 572000, cities: ['busan'],   ko: '부산 데이 투어',          en: 'Busan Day Tour',                           ja: '釜山デーツアー',     zh: '釜山一日游' },
];

const HEADER: Record<string, { title: string; subtitle: string }> = {
  ko: { title: '전용 전세 차량 예약', subtitle: '하루 8시간 · 영어 가능 기사 + 차량 + 연료 포함' },
  en: { title: 'Private Charter Car', subtitle: '8 hrs/day · English driver + car + fuel included' },
  ja: { title: '専用チャーター車予約', subtitle: '1日8時間·英語対応ドライバー＋車両＋燃料込み' },
  zh: { title: '专用包车预订', subtitle: '每天8小时·英文司机+车辆+燃油全含' },
};

function regionToCityKey(region: string | undefined): string {
  const r = String(region || '').toLowerCase().trim();
  if (r.includes('busan') || r.includes('부산') || r.includes('釜山')) return 'busan';
  if (r.includes('jeju') || r.includes('제주')) return 'jeju';
  if (r.includes('gyeongju') || r.includes('경주')) return 'gyeongju';
  if (r.includes('jeonju') || r.includes('전주')) return 'jeonju';
  if (r.includes('gangneung') || r.includes('강릉')) return 'gangneung';
  return 'seoul';
}

export function CharterInlineAd({ region, defaultDate, defaultPax, planId }: CharterInlineAdProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';

  const cityKey = regionToCityKey(region);

  // 사용자 main city 와 매칭되는 차터만 노출 (e.g. 서울 사용자 → seoul 시내·근교·DMZ·강원·스키)
  const filtered = ALL_CHARTERS.filter((c) => c.cities.includes(cityKey));
  if (filtered.length === 0) return null;

  const options: InlineBookingOption[] = filtered.map((c) => ({
    productType: c.productType,
    label: c[lang],
    priceKRW: c.priceKRW,
  }));

  const h = HEADER[lang];

  return (
    <InlineBookingCard
      title={h.title}
      subtitle={h.subtitle}
      icon={<Car className="w-6 h-6 text-[#B9A4FF]" />}
      accent="violet"
      options={options}
      defaultDate={defaultDate}
      defaultPax={defaultPax}
      userEmail={user?.email || ''}
      planId={planId}
    />
  );
}
