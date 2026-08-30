// 전용 전세 차량 인라인 예약·문의 카드.
// 실제 표시 가격은 src/data/pricing_spec.json 어댑터에서만 읽고,
// 문의 가격은 서버가 api/_pricing_spec.json과 플랜 원본으로 다시 계산한다.
import { useState } from 'react';
import { Car, MessageCircle } from 'lucide-react';
import { InlineBookingCard, type InlineBookingOption } from './InlineBookingCard';
import { CharterInquireModal } from './CharterInquireModal';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { charterTourKeysForRegion, DAILY_TOUR_PRICES, detectCharterRecommendation } from '@/data/charterPricing';
import { charterUsdFromKrw } from '@/lib/charterUsd';
import type { PlanDay, PlanDocument } from '../../types';

type CharterLang = 'ko' | 'en' | 'ja' | 'zh';

interface CharterInlineAdProps {
  /** plan.input.region 또는 destination — 사용자 main city 식별 */
  region?: string;
  defaultDate?: string;
  defaultPax?: number;
  planId?: string;
  /** 서버 재계산 문의에 필요한 플랜 원본. */
  plan?: PlanDocument;
}

interface CharterCatalogEntry {
  key: string;
  productType: string;
  ko: string;
  en: string;
  ja: string;
  zh: string;
  cities: string[];
}

interface ResolvedCharterEntry extends CharterCatalogEntry {
  priceKRW: number;
  hours: number;
  expectedUSD: number;
}

// productType 키는 api/_shared/resolve-line-item.js CHARTER_MAP과 동기.
// 가격·시간은 아래 카탈로그에 두지 않고 DAILY_TOUR_PRICES 정본에서 결합한다.
const ALL_CHARTERS: CharterCatalogEntry[] = [
  { key: 'seoul-city', productType: 'charter_seoul_city', cities: ['seoul'], ko: '서울 시내 투어', en: 'Seoul City Tour', ja: 'ソウル市内ツアー', zh: '首尔市区一日游' },
  { key: 'seoul-suburb', productType: 'charter_seoul_suburb', cities: ['seoul'], ko: '서울 근교 (남이섬·가평·수원)', en: 'Seoul Suburb (Nami Island, Gapyeong, Suwon)', ja: 'ソウル近郊 (南怡島·加平·水原)', zh: '首尔近郊 (南怡岛·加平·水原)' },
  { key: 'dmz', productType: 'charter_dmz', cities: ['seoul'], ko: 'DMZ 투어', en: 'DMZ Tour', ja: 'DMZツアー', zh: 'DMZ 一日游' },
  { key: 'gangwon', productType: 'charter_gangwon', cities: ['seoul', 'gangneung'], ko: '강원 (춘천·강릉·속초)', en: 'Gangwon (Chuncheon, Gangneung, Sokcho)', ja: '江原 (春川·江陵·束草)', zh: '江原 (春川·江陵·束草)' },
  { key: 'ski-resort', productType: 'charter_ski', cities: ['seoul'], ko: '스키 리조트 (용평·알펜시아)', en: 'Ski Resort (Yongpyong, Alpensia)', ja: 'スキーリゾート', zh: '滑雪度假村' },
  { key: 'gyeongju-jeonju', productType: 'charter_gyeongju', cities: ['gyeongju', 'jeonju'], ko: '경주·전주 투어', en: 'Gyeongju / Jeonju Tour', ja: '慶州·全州ツアー', zh: '庆州·全州游' },
  { key: 'busan-day', productType: 'charter_busan', cities: ['busan'], ko: '부산 데이 투어', en: 'Busan Day Tour', ja: '釜山デーツアー', zh: '釜山一日游' },
];

// 정본 키가 빠지거나 값이 잘못되면 해당 옵션만 숨긴다. 임의 가격으로 후퇴하지 않는다.
const RESOLVED_CHARTERS: ResolvedCharterEntry[] = ALL_CHARTERS
  .map((entry): ResolvedCharterEntry | null => {
    const pricing = DAILY_TOUR_PRICES[entry.key];
    const priceKRW = Number(pricing && pricing.priceKRW);
    const hours = Number(pricing && pricing.hours);
    const expectedUSD = charterUsdFromKrw(priceKRW);
    if (!Number.isSafeInteger(priceKRW) || priceKRW <= 0 || !Number.isFinite(hours) || hours <= 0 || expectedUSD <= 0) {
      return null;
    }
    return { ...entry, priceKRW, hours, expectedUSD };
  })
  .filter((entry): entry is ResolvedCharterEntry => entry !== null);

const HEADER: Record<CharterLang, { title: string; subtitle: string; pickupNote: string }> = {
  ko: {
    title: '전용 전세 차량 예약',
    subtitle: '영어 가능 기사 + 차량 + 연료 포함',
    pickupNote: '🏨 호텔 픽업 → 투어 → 호텔 복귀 (전 일정 프라이빗)',
  },
  en: {
    title: 'Private Charter Car',
    subtitle: 'English driver + car + fuel included',
    pickupNote: '🏨 Hotel pickup → tour → hotel drop-off (fully private)',
  },
  ja: {
    title: '専用チャーター車予約',
    subtitle: '英語対応ドライバー＋車両＋燃料込み',
    pickupNote: '🏨 ホテルピックアップ → ツアー → ホテルへ送迎 (完全プライベート)',
  },
  zh: {
    title: '专用包车预订',
    subtitle: '英文司机+车辆+燃油全含',
    pickupNote: '🏨 酒店接送 → 游览 → 返回酒店 (全程专属)',
  },
};

const INQUIRY_COPY: Record<CharterLang, { title: string; body: string; button: string; estimate: string; duration: (hours: number) => string }> = {
  ko: {
    title: '결제 전에 먼저 확인하고 싶으신가요?',
    body: '차량과 픽업 조건을 상담받을 수 있어요. 현재 가격표와 이 플랜을 다시 확인해 참고 견적으로 접수합니다.',
    button: '이 일정으로 견적 문의',
    estimate: '서버 계산 참고 예상가',
    duration: (hours) => `${hours}시간`,
  },
  en: {
    title: 'Want to check the details before paying?',
    body: 'Ask about the vehicle and pickup. We recheck this plan against the current price list before accepting a reference quote request.',
    button: 'Request a quote for this plan',
    estimate: 'Server-calculated reference estimate',
    duration: (hours) => `${hours} hrs`,
  },
  ja: {
    title: '決済前に内容を確認しますか？',
    body: '車両や送迎条件を相談できます。現在の料金表とこのプランを再確認し、参考見積もりとして受け付けます。',
    button: 'この日程で見積もりを依頼',
    estimate: 'サーバー計算の参考価格',
    duration: (hours) => `${hours}時間`,
  },
  zh: {
    title: '付款前想先确认详情吗？',
    body: '可咨询车辆和接送条件。我们会根据当前价目表重新核对该行程，再受理参考报价申请。',
    button: '按此行程申请报价',
    estimate: '服务器计算的参考价',
    duration: (hours) => `${hours}小时`,
  },
};

// 각 차터 옵션의 대략적인 투어 계획.
const TOUR_DETAILS: Record<string, Record<CharterLang, string>> = {
  charter_seoul_city: {
    ko: '경복궁 → 인사동 → 명동 → N서울타워 (예시 코스, 변경 가능)',
    en: 'Gyeongbokgung → Insadong → Myeongdong → N Seoul Tower (sample, customizable)',
    ja: '景福宮 → 仁寺洞 → 明洞 → Nソウルタワー (サンプル·変更可)',
    zh: '景福宫 → 仁寺洞 → 明洞 → N首尔塔 (示例·可调整)',
  },
  charter_seoul_suburb: {
    ko: '남이섬 → 가평 (쁘띠프랑스 / 이탈리아마을) → 수원 화성 (예시 코스)',
    en: 'Nami Island → Gapyeong (Petite France / Italian Village) → Suwon Hwaseong',
    ja: '南怡島 → 加平 (プチフランス / イタリア村) → 水原華城',
    zh: '南怡岛 → 加平 (小法国村 / 意大利村) → 水原华城',
  },
  charter_dmz: {
    ko: '제3땅굴 → 도라전망대 → 임진각 → 통일촌 (DMZ 공식 코스)',
    en: '3rd Tunnel → Dora Observatory → Imjingak → Tongil Village',
    ja: '第3トンネル → 都羅展望台 → 臨津閣 → 統一村',
    zh: '第三隧道 → 都罗山展望台 → 临津阁 → 统一村',
  },
  charter_gangwon: {
    ko: '춘천 닭갈비 → 강릉 안목해변 → 속초 중앙시장 (선택 1~2곳)',
    en: 'Chuncheon dakgalbi → Gangneung Anmok Beach → Sokcho Central Market',
    ja: '春川タッカルビ → 江陵アンモック海岸 → 束草中央市場',
    zh: '春川鸡排 → 江陵安木海边 → 束草中央市场',
  },
  charter_ski: {
    ko: '용평 또는 알펜시아 리조트 (장비 대여 별도)',
    en: 'Yongpyong or Alpensia Resort (gear rental separate)',
    ja: '龍平またはアルペンシアリゾート (装備レンタル別)',
    zh: '龙平或阿尔卑西亚度假村 (装备租赁另计)',
  },
  charter_gyeongju: {
    ko: '경주 불국사 → 석굴암 → 첨성대 / 전주 한옥마을 (선택)',
    en: 'Gyeongju Bulguksa → Seokguram → Cheomseongdae / Jeonju Hanok Village',
    ja: '慶州佛国寺 → 石窟庵 → 瞻星台 / 全州韓屋村',
    zh: '庆州佛国寺 → 石窟庵 → 瞻星台 / 全州韩屋村',
  },
  charter_busan: {
    ko: '해운대 → 광안대교 → 감천문화마을 → 자갈치시장 (예시)',
    en: 'Haeundae → Gwangan Bridge → Gamcheon Village → Jagalchi Market',
    ja: '海雲台 → 広安大橋 → 甘川文化村 → チャガルチ市場',
    zh: '海云台 → 广安大桥 → 甘川文化村 → 札嘎其市场',
  },
};

function hoursSummary(options: ResolvedCharterEntry[], lang: CharterLang): string {
  const values = [...new Set(options.map((option) => option.hours))].sort((a, b) => a - b);
  const range = values.length === 1 ? String(values[0]) : `${values[0]}–${values[values.length - 1]}`;
  if (lang === 'ko') return `${range}시간/일`;
  if (lang === 'ja') return `1日${range}時間`;
  if (lang === 'zh') return `每天${range}小时`;
  return `${range} hrs/day`;
}

function optionDetail(entry: ResolvedCharterEntry, lang: CharterLang): string {
  const duration = lang === 'ko' ? `${entry.hours}시간`
    : lang === 'ja' ? `${entry.hours}時間`
      : lang === 'zh' ? `${entry.hours}小时`
        : `${entry.hours} hrs`;
  const route = TOUR_DETAILS[entry.productType] && TOUR_DETAILS[entry.productType][lang];
  return route ? `${duration} · ${route}` : duration;
}

export function CharterInlineAd({ region, defaultDate, defaultPax, planId, plan }: CharterInlineAdProps) {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [inquireOpen, setInquireOpen] = useState(false);
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as CharterLang;

  const planInput = plan?.input || {};
  const planRegions = Array.isArray(planInput.regions) ? planInput.regions : [];
  const planPrimaryRegion = String(
    planRegions[0] || planInput.destination || planInput.area || planInput.region || '',
  );
  const allowedTourKeys = charterTourKeysForRegion(plan ? planPrimaryRegion : region || 'Seoul');
  const optionTourKeys = allowedTourKeys || charterTourKeysForRegion(region || 'Seoul');
  const filtered = RESOLVED_CHARTERS.filter((entry) => (
    optionTourKeys ? optionTourKeys.includes(entry.key) : entry.cities.includes('seoul')
  ));
  if (filtered.length === 0) return null;

  const options: InlineBookingOption[] = filtered.map((entry) => ({
    productType: entry.productType,
    label: entry[lang],
    priceKRW: entry.priceKRW,
    expectedUSD: entry.expectedUSD,
    detail: optionDetail(entry, lang),
  }));

  const days = ((plan && plan.itinerary && plan.itinerary.days) || []) as PlanDay[];
  const allStops = days.flatMap((day) => (day.stops || []).map((stop) => ({
    name: [stop.name, stop.display_name, stop['name_ko']]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' '),
    nameEn: String(stop['name_en'] || ''),
  })));
  const detection = detectCharterRecommendation(allStops, allowedTourKeys === null
    ? { preferHighestPrice: true }
    : { allowedTourKeys, preferHighestPrice: true });
  const detectedCatalog = detection.tourType
    ? RESOLVED_CHARTERS.find((entry) => entry.key === detection.tourType)
    : undefined;
  const inquiryQuote = detection.recommended && detection.pricing && detection.tourType && detectedCatalog
    ? {
        tourKey: detection.tourType,
        label: (detectedCatalog && detectedCatalog[lang]) || detection.pricing.en || detection.pricing.ko || detection.tourType,
        priceKRW: detection.pricing.priceKRW,
        hours: detection.pricing.hours,
      }
    : null;

  const h = HEADER[lang];
  const q = INQUIRY_COPY[lang];

  return (
    <>
      <InlineBookingCard
        title={h.title}
        subtitle={`${hoursSummary(filtered, lang)} · ${h.subtitle}\n${h.pickupNote}`}
        icon={<Car className="w-6 h-6 text-[#B9A4FF]" />}
        accent="violet"
        options={options}
        defaultDate={defaultDate}
        defaultPax={defaultPax}
        userEmail={user?.email || ''}
        planId={planId}
        extraFields="charter"
      />

      {inquiryQuote && (
        <section
          aria-label={q.title}
          className="-mt-3 mb-6 rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-400/10">
              <MessageCircle aria-hidden="true" className="h-5 w-5 text-violet-200" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-white">{q.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-white/60">{q.body}</p>
              <p className="mt-2 text-[13px] font-semibold text-violet-200">
                {q.estimate} · {inquiryQuote.label} · ₩{inquiryQuote.priceKRW.toLocaleString('ko-KR')} / {q.duration(inquiryQuote.hours)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setInquireOpen(true)}
            className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-violet-500 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          >
            {q.button}
          </button>
        </section>
      )}

      {inquireOpen && inquiryQuote && (
        <CharterInquireModal
          open={inquireOpen}
          onClose={() => setInquireOpen(false)}
          plan={plan}
          days={days}
          recommendedTour={inquiryQuote.label}
          quotedKRW={inquiryQuote.priceKRW}
          hours={inquiryQuote.hours}
          tourKey={inquiryQuote.tourKey}
          planId={planId || ''}
        />
      )}
    </>
  );
}
