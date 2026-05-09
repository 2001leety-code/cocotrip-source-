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

const HEADER: Record<string, { title: string; subtitle: string; pickupNote: string }> = {
  ko: {
    title: '전용 전세 차량 예약',
    subtitle: '하루 8시간 · 영어 가능 기사 + 차량 + 연료 포함',
    pickupNote: '🏨 호텔 픽업 → 투어 → 호텔 복귀 (전 일정 프라이빗)',
  },
  en: {
    title: 'Private Charter Car',
    subtitle: '8 hrs/day · English driver + car + fuel included',
    pickupNote: '🏨 Hotel pickup → tour → hotel drop-off (fully private)',
  },
  ja: {
    title: '専用チャーター車予約',
    subtitle: '1日8時間·英語対応ドライバー＋車両＋燃料込み',
    pickupNote: '🏨 ホテルピックアップ → ツアー → ホテルへ送迎 (完全プライベート)',
  },
  zh: {
    title: '专用包车预订',
    subtitle: '每天8小时·英文司机+车辆+燃油全含',
    pickupNote: '🏨 酒店接送 → 游览 → 返回酒店 (全程专属)',
  },
};

// 각 차터 옵션의 대략적인 투어 계획 (사용자 요구사항: 5/7).
// 세부 일정은 "호텔에서 픽업갑니다" 부터 시작 — InlineBookingCard 의 detail 필드에 노출.
const TOUR_DETAILS: Record<string, Record<string, string>> = {
  'charter_seoul_city': {
    ko: '경복궁 → 인사동 → 명동 → N서울타워 (예시 코스, 변경 가능)',
    en: 'Gyeongbokgung → Insadong → Myeongdong → N Seoul Tower (sample, customizable)',
    ja: '景福宮 → 仁寺洞 → 明洞 → Nソウルタワー (サンプル·変更可)',
    zh: '景福宫 → 仁寺洞 → 明洞 → N首尔塔 (示例·可调整)',
  },
  'charter_seoul_suburb': {
    ko: '남이섬 → 가평 (쁘띠프랑스 / 이탈리아마을) → 수원 화성 (예시 코스)',
    en: 'Nami Island → Gapyeong (Petite France / Italian Village) → Suwon Hwaseong',
    ja: '南怡島 → 加平 (プチフランス / イタリア村) → 水原華城',
    zh: '南怡岛 → 加平 (小法国村 / 意大利村) → 水原华城',
  },
  'charter_dmz': {
    ko: '제3땅굴 → 도라전망대 → 임진각 → 통일촌 (DMZ 공식 코스)',
    en: '3rd Tunnel → Dora Observatory → Imjingak → Tongil Village',
    ja: '第3トンネル → 都羅展望台 → 臨津閣 → 統一村',
    zh: '第三隧道 → 都罗山展望台 → 临津阁 → 统一村',
  },
  'charter_gangwon': {
    ko: '춘천 닭갈비 → 강릉 안목해변 → 속초 중앙시장 (선택 1-2)',
    en: 'Chuncheon dakgalbi → Gangneung Anmok Beach → Sokcho Central Market',
    ja: '春川タッカルビ → 江陵アンモック海岸 → 束草中央市場',
    zh: '春川鸡排 → 江陵安木海边 → 束草中央市场',
  },
  'charter_ski': {
    ko: '용평 또는 알펜시아 리조트 (장비 대여 별도)',
    en: 'Yongpyong or Alpensia Resort (gear rental separate)',
    ja: '龍平またはアルペンシアリゾート (装備レンタル別)',
    zh: '龙平或阿尔卑西亚度假村 (装备租赁另计)',
  },
  'charter_gyeongju': {
    ko: '경주 불국사 → 석굴암 → 첨성대 / 전주 한옥마을 (선택)',
    en: 'Gyeongju Bulguksa → Seokguram → Cheomseongdae / Jeonju Hanok Village',
    ja: '慶州佛国寺 → 石窟庵 → 瞻星台 / 全州韓屋村',
    zh: '庆州佛国寺 → 石窟庵 → 瞻星台 / 全州韩屋村',
  },
  'charter_busan': {
    ko: '해운대 → 광안대교 → 감천문화마을 → 자갈치시장 (예시)',
    en: 'Haeundae → Gwangan Bridge → Gamcheon Village → Jagalchi Market',
    ja: '海雲台 → 広安大橋 → 甘川文化村 → チャガルチ市場',
    zh: '海云台 → 广安大桥 → 甘川文化村 → 札嘎其市场',
  },
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
    detail: TOUR_DETAILS[c.productType]?.[lang],
  }));

  const h = HEADER[lang];

  return (
    <InlineBookingCard
      title={h.title}
      subtitle={`${h.subtitle}\n${h.pickupNote}`}
      icon={<Car className="w-6 h-6 text-[#B9A4FF]" />}
      accent="violet"
      options={options}
      defaultDate={defaultDate}
      defaultPax={defaultPax}
      userEmail={user?.email || ''}
      planId={planId}
      // batch 9 (B9-12): 차터 — 픽업 위치 + 기사 언어 추가 입력.
      extraFields="charter"
    />
  );
}
