// Airport → Lodging guide for users WITHOUT a CocoTrip charter booking.
// 2026-05-08: 사용자 신고 "차터 미예약 사용자한테 코코트립 차량 탑승 강제 가정 X.
// 외국인은 공항에서 어디로 가야 할지 4 옵션 (공항철도/공항버스/택시/차터 업셀) 명시 필요."
//
// Display rules:
//   - Charter booked → 미노출 (PreTripSlide 가 다른 카드 노출)
//   - 한국인 (ko) → 단순화된 1줄 안내만 (한국인은 공항 교통 잘 앎)
//   - 그 외 (en/ja/zh) → 4 옵션 + 자동 추천 (2026-11-19: charterFirst.js — 4인+ / 짐 많음 / 새벽 → 차터 강조)
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
import { needsCharterForGroup, isDawnMin } from '@/lib/charterFirst.js';
import { strictHHMMToMin, IMMIGRATION_BUFFER_MIN } from '@/lib/arrivalRestRules.js';

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
    taxi_note: '4인승, 캐리어 24인치 2개까지 가능 (기사 차량 LPG 트렁크 제약). 4인 이상이거나 짐이 많으면 코코트립 차량 추천.',
    cocotrip_note: '도어투도어 7~9인승 스타리아, 영어 가능 기사, 모든 짐 적재. 4인 이상·캐리어 3개 이상·늦은 밤 도착이면 권장.',
    not_running_note: '입국 수속을 마칠 시간엔 운행이 끝나요.',
  },
  en: {
    arex_express_note: 'Best value for light luggage. Direct to Seoul Station in 43 min.',
    limousine_bus_note: 'Airport bus 6015 etc — no transfer needed to Myeongdong/Gangnam. 75 min.',
    taxi_note: 'Seats 4, up to 2 × 24-inch suitcases (LPG trunk limit). 4+ people or 3+ bags → CocoTrip charter.',
    cocotrip_note: 'Door-to-door 7–9 seat Staria, English-speaking driver, loads all luggage. Recommended for 4+ people, 3+ suitcases or late-night arrivals.',
    not_running_note: 'Not running by the time you clear immigration.',
  },
  ja: {
    arex_express_note: 'スーツケースが少ない方に最適。ソウル駅まで直通43分。',
    limousine_bus_note: '空港バス6015番など — 明洞・江南へ乗換なし。75分。',
    taxi_note: '4人乗り、24インチスーツケース2個まで（LPGトランク制限）。4名以上・荷物3個以上はCocoTripチャーター推奨。',
    cocotrip_note: 'ドアツードア、7〜9人乗りスタリア、英語対応ドライバー、全荷物積載。4名以上・スーツケース3個以上・深夜到着なら推奨。',
    not_running_note: '入国手続きを終える頃には運行が終了しています。',
  },
  zh: {
    arex_express_note: '行李少时性价比最高。直达首尔站43分钟。',
    limousine_bus_note: '机场巴士6015号等 — 直达明洞·江南无需换乘。75分钟。',
    taxi_note: '限乘4人，最多2件24英寸行李箱（LPG后备箱限制）。4人以上或3件以上行李推荐CocoTrip包车。',
    cocotrip_note: '门到门服务、7–9座Staria、英文司机、可装载全部行李。4人以上、3件以上行李或深夜到达时推荐。',
    not_running_note: '办完入境手续时已停运。',
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
const SIMPLIFIED_KO_DAWN = '늦은 밤 도착이라 입국 수속을 마칠 때쯤엔 공항철도·공항버스가 끊겨요. 기사가 기다리는 7~9인승 코코트립 차량을 추천해요.';
const SIMPLIFIED_KO_DAWN_TAXI = '늦은 밤 도착이라 입국 수속을 마칠 때쯤엔 공항철도·공항버스가 끊겨요. 택시를 이용하세요.';
// Airports with a CocoTrip pickup product (pricing_spec airport_transfer_prices) — same gate as RouteAgent.
const CHARTER_AIRPORT_RE = /^(ICN|GMP|PUS|CJU)/i;

// 2026-11-19: landing + immigration lands in 23:00–04:59 → AREX / airport bus not running, charter first.
const DAWN_BANNER = {
  en: '🌙 Late-night arrival — airport trains and buses have stopped by the time you clear immigration. A CocoTrip charter (7–9 seat Staria) waits for you; a taxi is the backup.',
  ja: '🌙 深夜到着 — 入国手続きを終える頃には空港鉄道・空港バスは運行終了です。CocoTripチャーター（7〜9人乗りスタリア）がお待ちします。タクシーは予備の手段です。',
  zh: '🌙 深夜到达 — 办完入境手续时机场铁路和机场大巴已停运。CocoTrip包车（7–9座Staria）会等候您；出租车作为备选。',
} as const;
const DAWN_BANNER_TAXI = {
  en: '🌙 Late-night arrival — airport trains and buses have stopped by the time you clear immigration. Take a taxi.',
  ja: '🌙 深夜到着 — 入国手続きを終える頃には空港鉄道・空港バスは運行終了です。タクシーをご利用ください。',
  zh: '🌙 深夜到达 — 办完入境手续时机场铁路和机场大巴已停运。请乘坐出租车。',
} as const;

// 인천 (ICN) 기본 — 다른 공항도 동일 fallback (가격 약간 다르지만 큰 차이 X).
// B-5/B-8 (2026-05-10 prod 검증): heavyLoad 기준을 calcVehicleCount(luggage) >= 2 로 통일.
//   1-7개 → 1대 (택시/공항철도 충분), 8+ → 2대 (코코트립 차터 권장).
function getOptions(lang: Lang, heavyLoad: boolean, dawn: boolean, dawnCharter: boolean): TransportOption[] {
  const charterFirst = heavyLoad || dawnCharter;
  const opts: TransportOption[] = [
    {
      key: 'arex_express',
      icon: Train,
      iconColor: '#7C5CFC',
      durationMin: 43,
      priceKRW: 11000,
      emphasis: charterFirst ? 'avoid' : 'recommended',
      noteKey: dawn ? 'not_running_note' : 'arex_express_note',
    },
    {
      key: 'limousine_bus',
      icon: Bus,
      iconColor: '#34d399',
      durationMin: 75,
      priceKRW: 17000,
      emphasis: dawn ? 'avoid' : undefined,
      noteKey: dawn ? 'not_running_note' : 'limousine_bus_note',
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
      emphasis: heavyLoad ? 'avoid' : (dawn && !dawnCharter ? 'recommended' : undefined),
    },
    {
      key: 'cocotrip',
      icon: Car,
      iconColor: '#EA537E',
      durationMin: 60,
      priceKRW: 124800,
      emphasis: charterFirst ? 'recommended' : undefined,
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
  // B-5/B-8 (2026-05-10 prod 검증): 캐리어 → 차량 수 동적 룰 (1-7=1대, 8+=2대, 14+=3대, +6/대).
  // 2026-11-19: heavy = the shared charter rule (4+ people, bags beyond a sedan trunk) — same as RouteAgent.
  const vehicleCount = calcVehicleCount(luggageCount);
  const heavyLoad = needsCharterForGroup({ pax: paxCount, luggage });
  const arrivalMin = strictHHMMToMin(input.arrival_time || input.arrivalTime);
  const dawn = arrivalMin !== null && isDawnMin(arrivalMin + IMMIGRATION_BUFFER_MIN);
  const dawnCharter = dawn && CHARTER_AIRPORT_RE.test(arrivalAirport.trim());

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
            <p className="text-[13px] text-white/75 leading-relaxed">{dawn ? (dawnCharter ? SIMPLIFIED_KO_DAWN : SIMPLIFIED_KO_DAWN_TAXI) : SIMPLIFIED_KO}</p>
            {/* B-4 (2026-05-11 prod 검증): "코코트립 차량 알아보기" 버튼 제거.
                바로 아래 AirportPickupAd 카드와 중복 — 안내문은 유지, 버튼만 삭제. */}
          </div>
        </div>
      </div>
    );
  }

  // 외국인 — 4 옵션 풀 노출.
  const options = getOptions(lang, heavyLoad, dawn, dawnCharter);
  const vehicles = Math.max(1, vehicleCount);
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
            <p className="text-[13px] text-white/65 mt-0.5">
              <span className="font-semibold text-white/80">{arrivalAirport}</span>
              <ArrowRight className="inline w-3 h-3 mx-1" />
              <span>{lodgingLabel}</span>
            </p>
          </div>
        </div>
        <p className="text-[14px] text-white/70 leading-relaxed mt-2">{headline.subtitle}</p>
        {heavyLoad && (
          <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
            <p className="text-[13px] text-amber-200 leading-relaxed">
              {lang === 'en' && `🧳 ${luggageCount} suitcases / ${paxCount} pax — ${vehicles} ${vehicles > 1 ? 'vehicles' : 'vehicle'} recommended (7–9 seat Staria). Korean taxis seat 4 and fit only 1-2 large bags.`}
              {lang === 'ja' && `🧳 荷物${luggageCount}個 / ${paxCount}名 — 車両${vehicles}台推奨 (7〜9人乗りスタリア)。韓国のタクシーは4人乗りで、大きな荷物は1-2個まで。`}
              {lang === 'zh' && `🧳 ${luggageCount}件行李 / ${paxCount}人 — 建议${vehicles}辆车 (7–9座Staria)。韩国出租车限乘4人，仅能放1-2件大行李。`}
            </p>
          </div>
        )}
        {dawn && (
          <div className="mt-3 rounded-lg bg-indigo-500/10 border border-indigo-400/30 px-3 py-2">
            <p className="text-[13px] text-indigo-100 leading-relaxed">{(dawnCharter ? DAWN_BANNER : DAWN_BANNER_TAXI)[lang]}</p>
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
                <span className="absolute -top-1.5 right-2 px-2 py-0.5 rounded text-[11px] font-bold text-black"
                  style={{ background: '#FBBC05' }}>
                  ★ {recBadge}
                </span>
              )}
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="w-4 h-4 shrink-0" style={{ color: opt.iconColor }} />
                <p className="text-[14px] font-bold text-white truncate">{labels[opt.key]}</p>
              </div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-[14px] font-bold text-white">{fmtKRW(opt.priceKRW)}</span>
                <span className="text-[13px] text-white/65">· {opt.durationMin} min</span>
              </div>
              <p className="text-[13px] text-white/70 leading-snug">{notes[opt.noteKey]}</p>
              {opt.ctaTo && (
                <div className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold"
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
      {!heavyLoad && !dawn && (
        <div className="px-4 pb-4">
          <Link to="/charter"
            onClick={() => trackAdClick('charter', 'preTrip:airportToLodging:footer', '/charter')}
            className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl text-[14px] font-semibold text-white/85"
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
