// Airport → Lodging guide for users WITHOUT a CocoTrip charter booking.
// 2026-05-08: 사용자 신고 "차터 미예약 사용자한테 코코트립 차량 탑승 강제 가정 X.
// 외국인은 공항에서 어디로 가야 할지 4 옵션 (공항철도/공항버스/택시/차터 업셀) 명시 필요."
//
// Display rules:
//   - Charter booked → 미노출 (PreTripSlide 가 다른 카드 노출)
//   - 한국인 (ko) → 단순화된 1줄 안내만 (한국인은 공항 교통 잘 앎)
//   - 그 외 (en/ja/zh) → 4 옵션 + 자동 추천 (캐리어 합 3+ 또는 5인+ → 차터 강조)
//   - airport / lodging 미정 → 미노출 (보여 줄 정보 부족)
//
// 가격/시간은 매핑 테이블 (한국 공식 공항철도·공항버스 노선 기반).
// 카카오 택시 등 브랜드명 X — 일반 명칭 "택시" 사용.
import { Train, Bus, Car, Sparkles, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDocument } from '../types';
import { BRAND } from '@/lib/design-tokens';
import { trackAdClick } from '@/lib/analytics';
import { calcVehicleCount } from '@/lib/luggageVehicle';

type Lang = 'ko' | 'en' | 'ja' | 'zh';

interface Props {
  plan: PlanDocument;
}

interface TransportOption {
  key: 'arex_express' | 'limousine_bus' | 'taxi' | 'cocotrip';
  icon: typeof Train;
  iconColor: string;
  durationMin: number;
  priceKRW: number;
  /** 캐리어/인원 추천 강조 여부 (자동 결정). */
  emphasis?: 'recommended' | 'avoid';
  /** 옵션 본문 (가격/시간 외 추가 안내). */
  noteKey: keyof typeof TRANSPORT_NOTES.en;
  ctaTo?: string;
}

// Per-option metadata. ko 사용자는 별도 단순화 패스 — 영어 노트는 외국인 대상.
const TRANSPORT_NOTES = {
  ko: {
    arex_express_note: '캐리어 적을 때 가성비 최고. 서울역까지 직통 43분.',
    limousine_bus_note: '공항버스 6015번 등 — 명동·강남까지 환승 없이 이동. 75분.',
    taxi_note: '캐리어 24인치 2개까지 가능 (기사 차량 LPG 트렁크 제약). 그 이상이면 코코트립 차량 추천.',
    cocotrip_note: '도어투도어, 영어 가능 기사, 모든 짐 적재. 캐리어 3개 이상이면 권장.',
  },
  en: {
    arex_express_note: 'Best value for light luggage. Direct to Seoul Station in 43 min.',
    limousine_bus_note: 'Airport bus 6015 etc — no transfer needed to Myeongdong/Gangnam. 75 min.',
    taxi_note: 'Up to 2 × 24-inch suitcases (LPG trunk limit). 3+ bags → CocoTrip charter.',
    cocotrip_note: 'Door-to-door, English-speaking driver, loads all luggage. Recommended for 3+ suitcases.',
  },
  ja: {
    arex_express_note: 'スーツケースが少ない方に最適。ソウル駅まで直通43分。',
    limousine_bus_note: '空港バス6015番など — 明洞・江南へ乗換なし。75分。',
    taxi_note: '24インチスーツケース2個まで（LPGトランク制限）。3個以上はCocoTripチャーター推奨。',
    cocotrip_note: 'ドアツードア、英語対応ドライバー、全荷物積載。3個以上のスーツケースなら推奨。',
  },
  zh: {
    arex_express_note: '行李少时性价比最高。直达首尔站43分钟。',
    limousine_bus_note: '机场巴士6015号等 — 直达明洞·江南无需换乘。75分钟。',
    taxi_note: '最多2件24英寸行李箱（LPG后备箱限制）。3件以上推荐CocoTrip包车。',
    cocotrip_note: '门到门服务、英文司机、可装载全部行李。3件以上行李推荐。',
  },
} as const;

// Headline copy in 4 langs.
const HEADLINE = {
  ko: { title: '공항 → 숙소 이동 안내', subtitle: '4가지 방법 중 짐과 인원에 맞는 옵션을 추천드려요.' },
  en: { title: 'Airport → Lodging Guide', subtitle: '4 options — we recommend the best fit for your luggage + group.' },
  ja: { title: '空港 → 宿泊先 ガイド', subtitle: '4つの選択肢から、荷物と人数に合った最適なものをご提案します。' },
  zh: { title: '机场 → 住宿 指引', subtitle: '4种方式 — 根据行李和人数为您推荐最合适的。' },
} as const;

const OPTION_LABELS = {
  ko: { arex_express: '공항철도 (직통)', limousine_bus: '공항버스 6015 등', taxi: '일반 택시', cocotrip: '코코트립 차터 예약' },
  en: { arex_express: 'AREX Express Train', limousine_bus: 'Airport Limousine Bus', taxi: 'Regular Taxi', cocotrip: 'Book CocoTrip Charter' },
  ja: { arex_express: 'AREX 直通空港鉄道', limousine_bus: '空港リムジンバス', taxi: 'タクシー', cocotrip: 'CocoTripチャーターを予約' },
  zh: { arex_express: 'AREX机场快线', limousine_bus: '机场大巴', taxi: '出租车', cocotrip: '预订CocoTrip包车' },
} as const;

const REC_BADGE = { ko: '추천', en: 'Recommended', ja: 'おすすめ', zh: '推荐' };

const SIMPLIFIED_KO = '한국 거주자라면 공항철도·공항버스·택시 모두 익숙하시죠? 캐리어가 많으시면 코코트립 차량을 이용하실 수도 있어요.';

// 인천 (ICN) 기본 — 다른 공항도 동일 fallback (가격 약간 다르지만 큰 차이 X).
// B-5/B-8 (2026-05-10 prod 검증): heavyLoad 기준을 calcVehicleCount(luggage) >= 2 로 통일.
//   1-7개 → 1대 (택시/공항철도 충분), 8+ → 2대 (코코트립 차터 권장).
function getOptions(lang: Lang, luggageCount: number, paxCount: number): TransportOption[] {
  const heavyLoad = calcVehicleCount(luggageCount) >= 2 || paxCount >= 5;
  const opts: TransportOption[] = [
    {
      key: 'arex_express',
      icon: Train,
      iconColor: '#7C5CFC',
      durationMin: 43,
      priceKRW: 11000,
      emphasis: heavyLoad ? 'avoid' : 'recommended',
      noteKey: 'arex_express_note',
    },
    {
      key: 'limousine_bus',
      icon: Bus,
      iconColor: '#34d399',
      durationMin: 75,
      priceKRW: 17000,
      noteKey: 'limousine_bus_note',
    },
    {
      key: 'taxi',
      icon: Car,
      iconColor: '#fb923c',
      durationMin: 60,
      // 2026-05-09 (B9-24 미세 조정): 사용자 받아적기 메모 "일반 택시 60분 ₩60,000~"
      // 일치하도록 ₩75K → ₩60K. 시장 평균 ICN→서울 일반 택시 ~₩60-80K 범위 내.
      priceKRW: 60000,
      noteKey: 'taxi_note',
      emphasis: heavyLoad ? 'avoid' : undefined,
    },
    {
      key: 'cocotrip',
      icon: Car,
      iconColor: '#EA537E',
      durationMin: 60,
      priceKRW: 124800,
      emphasis: heavyLoad ? 'recommended' : undefined,
      noteKey: 'cocotrip_note',
      ctaTo: '/charter',
    },
  ];
  // suppress unused-language warning (used via OPTION_LABELS lookup)
  void lang;
  return opts;
}

function fmtKRW(amount: number): string {
  return `₩${amount.toLocaleString('en-US')}`;
}

export function AirportToLodgingGuide({ plan }: Props) {
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as Lang;

  const input = plan?.input || {};
  const charterBooked = input.charter_booked === true || !!input.charter_inquiry_id;
  if (charterBooked) return null;

  const lodgingLabel = (input.hotel_address as string) || (input.recommended_zone as string) || '';
  const arrivalAirport = (input.arrival_airport as string) || '';
  // airport + lodging 둘 다 없으면 안내할 게 부족 → 미노출.
  if (!arrivalAirport || !lodgingLabel) return null;

  const luggage = input.luggage as { small?: number; medium?: number; large?: number } | undefined;
  const luggageCount = (luggage?.small || 0) + (luggage?.medium || 0) + (luggage?.large || 0);
  const paxCount = (input.pax as number) || (input.adults as number) || 2;
  // B-5/B-8 (2026-05-10 prod 검증): 캐리어 → 차량 수 동적 룰 통일.
  //   1-7=1대, 8+=2대, 14+=3대, +6/대. 차량 2대 이상 필요 시 = heavyLoad.
  const vehicleCount = calcVehicleCount(luggageCount);
  const heavyLoad = vehicleCount >= 2 || paxCount >= 5;

  // 한국어 사용자는 단순화 — 한국인은 공항 교통 잘 알고, 디테일 본문 길면 짜증 (사용자 피드백).
  if (lang === 'ko') {
    return (
      <div className="mb-6 rounded-2xl p-4 bg-white/[0.03] border border-white/[0.06]">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: BRAND.gradient.primary }}>
            <Train className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white mb-1">{HEADLINE.ko.title}</p>
            <p className="text-[13px] text-white/65 leading-relaxed">{SIMPLIFIED_KO}</p>
            {/* B-4 (2026-05-11 prod 검증): "코코트립 차량 알아보기" 버튼 제거.
                바로 아래 AirportPickupAd 카드와 중복 — 안내문은 유지, 버튼만 삭제. */}
          </div>
        </div>
      </div>
    );
  }

  // 외국인 — 4 옵션 풀 노출.
  const options = getOptions(lang, luggageCount, paxCount);
  const headline = HEADLINE[lang];
  const labels = OPTION_LABELS[lang];
  const notes = TRANSPORT_NOTES[lang];
  const recBadge = REC_BADGE[lang];

  return (
    <div className="mb-6 rounded-2xl overflow-hidden border border-white/[0.08]"
      style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(96,165,250,0.06))' }}>
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: BRAND.gradient.primary }}>
            <Train className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-white">{headline.title}</p>
            <p className="text-[11px] text-white/55 mt-0.5">
              <span className="font-semibold text-white/75">{arrivalAirport}</span>
              <ArrowRight className="inline w-3 h-3 mx-1" />
              <span>{lodgingLabel}</span>
            </p>
          </div>
        </div>
        <p className="text-[12px] text-white/65 leading-relaxed mt-2">{headline.subtitle}</p>
        {heavyLoad && (
          <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
            <p className="text-[11px] text-amber-200 leading-relaxed">
              {lang === 'en' && `🧳 ${luggageCount} suitcases / ${paxCount} pax — ${vehicleCount} vehicles recommended (Staria). Korean taxis fit only 1-2 large bags.`}
              {lang === 'ja' && `🧳 荷物${luggageCount}個 / ${paxCount}名 — 車両${vehicleCount}台推奨 (スターリア)。韓国のタクシーは大きな荷物1-2個まで。`}
              {lang === 'zh' && `🧳 ${luggageCount}件行李 / ${paxCount}人 — 建议${vehicleCount}辆车 (Staria)。韩国出租车仅能放1-2件大行李。`}
            </p>
          </div>
        )}
      </div>

      {/* 4 options grid */}
      <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {options.map((opt) => {
          const Icon = opt.icon;
          const isRec = opt.emphasis === 'recommended';
          const isAvoid = opt.emphasis === 'avoid';
          const card = (
            <div
              className={`relative rounded-xl p-3 border transition-all ${
                isRec
                  ? 'border-[#FBBC05]/50 bg-[#FBBC05]/[0.06]'
                  : isAvoid
                  ? 'border-white/[0.06] bg-white/[0.02] opacity-60'
                  : 'border-white/[0.08] bg-white/[0.04]'
              }`}
            >
              {isRec && (
                <span className="absolute -top-1.5 right-2 px-2 py-0.5 rounded text-[9px] font-bold text-black"
                  style={{ background: '#FBBC05' }}>
                  ★ {recBadge}
                </span>
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="w-4 h-4 shrink-0" style={{ color: opt.iconColor }} />
                <p className="text-[12px] font-bold text-white truncate">{labels[opt.key]}</p>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[14px] font-bold text-white">{fmtKRW(opt.priceKRW)}</span>
                <span className="text-[11px] text-white/55">· {opt.durationMin} min</span>
              </div>
              <p className="text-[11px] text-white/60 leading-snug">{notes[opt.noteKey]}</p>
              {opt.ctaTo && (
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold"
                  style={{ color: opt.iconColor }}>
                  {labels[opt.key]} <ArrowRight className="w-3 h-3" />
                </div>
              )}
            </div>
          );
          if (opt.ctaTo) {
            return (
              <Link key={opt.key} to={opt.ctaTo}
                onClick={() => trackAdClick('charter', `preTrip:airportToLodging:${opt.key}`, opt.ctaTo!)}>
                {card}
              </Link>
            );
          }
          return <div key={opt.key}>{card}</div>;
        })}
      </div>

      {/* Subtle CocoTrip charter upsell footer when not heavy. */}
      {!heavyLoad && (
        <div className="px-4 pb-4">
          <Link to="/charter"
            onClick={() => trackAdClick('charter', 'preTrip:airportToLodging:footer', '/charter')}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-[12px] font-semibold text-white/85"
            style={{ background: 'rgba(124,92,252,0.18)', border: '1px solid rgba(124,92,252,0.30)' }}>
            <Sparkles className="w-3.5 h-3.5" />
            {lang === 'en' && 'Skip the wait — book a private charter'}
            {lang === 'ja' && '待ち時間ゼロ — 専用車を予約'}
            {lang === 'zh' && '免去等候 — 预订专属包车'}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
