// InlineBookingCard — 광고 카드 + 인라인 예약 폼 통합.
//
// 사용자 신고 (2026-05-05): 기존 wrap-up 카드는 외부 링크 (WhatsApp / cocotripkr.com/charter)
// 로 보내서 예약 흐름이 끊김. wrap-up 안에서 바로 결제까지 끝낼 수 있게 변경.
//
// 사용법:
//   <InlineBookingCard
//     title="공항 픽업 서비스"
//     subtitle="영어 가능 기사가 도착장에서 대기"
//     icon={<Plane />}
//     accent="amber"        // 카드 컬러 (amber/violet/teal)
//     options={[
//       { productType: 'airport_seoul_central', label: '서울 도심', priceKRW: 124800 },
//       ...
//     ]}
//     defaultDate={input.startDate}
//     defaultPax={input.pax}
//     userEmail={user?.email}
//     planId={planId}
//   />
//
// 사용자 흐름:
//   1. 옵션 카드 클릭 → 선택 표시
//   2. 날짜·시간·pax 입력
//   3. "결제 진행" 버튼 클릭 → Drop-in UI 펼침
//   4. paypal.me QR 결제 완료 → 사용자가 [결제 완료 신고] 클릭 (PayPalBookingButton
//      = paypal.me wrapper, 5/6 Braintree LIVE 한국 미가입 확정 후 변경)
//   5. /api/manual-payment-request → Firestore pending_bookings + 텔레그램 booking #1
//      → 운영자 admin 매칭 또는 PayPal Webhook 자동 매칭 (PR #276)

import { useState, lazy, Suspense } from 'react';
import { Calendar, Users, Check, ChevronRight, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

// 결제 — PayPalBookingButton (PayPal Smart Buttons) + SDK 차단 시 paypal.me QR fallback 통합 (5/7 복구).
// 클릭 시점에만 lazy 로드.
const PayPalBookingButton = lazy(() =>
  import('@/components/PayPalBookingButton').then(m => ({ default: m.PayPalBookingButton })),
);

export interface InlineBookingOption {
  productType: string;       // braintreeCheckout 가 받는 키 (e.g. airport_seoul_central)
  label: string;             // 사용자 표시 라벨 (예: "서울 도심")
  priceKRW: number;
  /** 선택 시 옵션 카드 위 추가 안내 (예: 출발-도착 zone 표시) */
  detail?: string;
}

interface AccentTheme {
  ring: string;
  bg: string;
  border: string;
  text: string;
  iconBg: string;
}

const ACCENTS: Record<string, AccentTheme> = {
  amber: {
    ring: 'ring-amber-400/60',
    bg: 'rgba(245,158,11,0.06)',
    border: 'rgba(245,158,11,0.30)',
    text: 'text-amber-300',
    iconBg: 'bg-amber-500/15 border-amber-500/30',
  },
  violet: {
    ring: 'ring-[#B668FC]/60',
    bg: 'rgba(124,92,252,0.06)',
    border: 'rgba(124,92,252,0.30)',
    text: 'text-[#B9A4FF]',
    iconBg: 'bg-[#7C5CFC]/15 border-[#7C5CFC]/30',
  },
  teal: {
    ring: 'ring-emerald-400/60',
    bg: 'rgba(16,185,129,0.06)',
    border: 'rgba(16,185,129,0.30)',
    text: 'text-emerald-300',
    iconBg: 'bg-emerald-500/15 border-emerald-500/30',
  },
};

interface Props {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent?: 'amber' | 'violet' | 'teal';
  badge?: string;  // 우측 상단 배지 (e.g. airport code "ICN")
  options: InlineBookingOption[];
  defaultDate?: string;
  defaultPax?: number;
  userEmail?: string;
  planId?: string;
  /**
   * batch 9 (B9-11/12/13): 추가 입력 필드 type (운영자 5/9 요청 — "투어창처럼
   *   더 자세한 정보 입력"). 옵션 선택 후 노출:
   *   - 'airport': 캐리어(소/중/대) + 편명 + 터미널 (T1/T2)
   *   - 'charter': 픽업 위치 + 언어
   *   - 'combo': 위 두 종류 모두
   *   - undefined: 추가 필드 없음 (기존 동작)
   */
  extraFields?: 'airport' | 'charter' | 'combo';
}

const LABELS: Record<string, Record<string, string>> = {
  ko: {
    chooseOption: '아래 옵션 중 선택',
    pickupTime: '날짜 / 시간',
    pax: '인원',
    proceed: '결제 진행',
    pickFirst: '먼저 옵션을 선택해 주세요',
    selected: '선택됨',
    paxUnit: '명',
    flightNo: '편명',
    flightNoPh: '예: KE085 / OZ213',
    terminal: '터미널',
    luggageLabel: '수하물',
    luggageSmall: '기내',
    luggageMedium: '중형',
    luggageLarge: '대형',
    pickupLocation: '픽업 위치 / 호텔',
    pickupLocationPh: '예: 명동 롯데호텔, 종로구 ○○○',
    driverLang: '기사 언어',
  },
  en: {
    chooseOption: 'Pick an option below',
    pickupTime: 'Date / Time',
    pax: 'Travelers',
    proceed: 'Proceed to Payment',
    pickFirst: 'Please pick an option first',
    selected: 'Selected',
    paxUnit: 'pax',
    flightNo: 'Flight number',
    flightNoPh: 'e.g. KE085 / OZ213',
    terminal: 'Terminal',
    luggageLabel: 'Luggage',
    luggageSmall: 'Carry-on',
    luggageMedium: 'Medium',
    luggageLarge: 'Large',
    pickupLocation: 'Pickup hotel / address',
    pickupLocationPh: 'e.g. Lotte Hotel Myeongdong',
    driverLang: 'Driver language',
  },
  ja: {
    chooseOption: '以下から選択',
    pickupTime: '日付 / 時間',
    pax: '人数',
    proceed: '決済へ進む',
    pickFirst: '先にオプションを選択してください',
    selected: '選択済み',
    paxUnit: '名',
    flightNo: '便名',
    flightNoPh: '例: KE085 / OZ213',
    terminal: 'ターミナル',
    luggageLabel: '荷物',
    luggageSmall: '機内',
    luggageMedium: '中型',
    luggageLarge: '大型',
    pickupLocation: 'ピックアップ場所 / ホテル',
    pickupLocationPh: '例: 明洞ロッテホテル',
    driverLang: 'ドライバー言語',
  },
  zh: {
    chooseOption: '请选择以下选项',
    pickupTime: '日期 / 时间',
    pax: '人数',
    proceed: '前往支付',
    pickFirst: '请先选择一个选项',
    selected: '已选',
    paxUnit: '人',
    flightNo: '航班号',
    flightNoPh: '例: KE085 / OZ213',
    terminal: '航站楼',
    luggageLabel: '行李',
    luggageSmall: '随身',
    luggageMedium: '中型',
    luggageLarge: '大型',
    pickupLocation: '接送地点 / 酒店',
    pickupLocationPh: '例: 明洞乐天酒店',
    driverLang: '司机语言',
  },
};

export function InlineBookingCard({
  title, subtitle, icon, accent = 'amber', badge,
  options, defaultDate, defaultPax = 2, userEmail = '', planId, extraFields,
}: Props) {
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const L = LABELS[lang];
  const a = ACCENTS[accent];

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [date, setDate] = useState<string>(defaultDate || '');
  const [time, setTime] = useState<string>('10:00');
  const [pax, setPax] = useState<number>(defaultPax);
  const [showPayment, setShowPayment] = useState(false);

  // batch 9 (B9-11/12/13): 추가 입력 필드 — extraFields prop 따라 노출.
  const showAirport = extraFields === 'airport' || extraFields === 'combo';
  const showCharter = extraFields === 'charter' || extraFields === 'combo';
  const [terminal, setTerminal] = useState<'T1' | 'T2' | ''>('');
  const [flightNumber, setFlightNumber] = useState<string>('');
  const [lugSmall, setLugSmall] = useState<number>(0);
  const [lugMedium, setLugMedium] = useState<number>(0);
  const [lugLarge, setLugLarge] = useState<number>(0);
  const [pickupAddress, setPickupAddress] = useState<string>('');
  const [driverLang, setDriverLang] = useState<'en' | 'ja' | 'zh'>('en');
  // 5/7 복구: PayPalBookingButton 이 PayPal Smart Buttons (live) + SDK 차단 시 paypal.me QR
  // fallback 통합. 위치 게이트 / 안내 모달 / 외부 토글 모두 제거 — 단순 button 렌더만.

  const selected = options.find((o) => o.productType === selectedKey);
  const canProceed = !!selected && !!date && !!userEmail;

  if (!options.length) return null;

  return (
    <div
      className="mb-6 rounded-2xl p-5 transition-all"
      style={{
        background: `linear-gradient(135deg, ${a.bg}, rgba(10,16,32,0.95))`,
        border: `1px solid ${a.border}`,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl ${a.iconBg} border flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-base leading-tight mb-0.5">{title}</p>
          <p className={`text-xs ${a.text}/80 whitespace-pre-line leading-relaxed`}>{subtitle}</p>
        </div>
        {badge && (
          <span className={`shrink-0 text-[10px] ${a.text} border ${a.border} rounded-full px-2.5 py-1 font-semibold`}
            style={{ borderColor: a.border }}>
            {badge}
          </span>
        )}
      </div>

      {/* Options grid */}
      <p className="text-[11px] text-white/55 mb-2">{L.chooseOption}</p>
      <div className="space-y-2 mb-4">
        {options.map((opt) => {
          const sel = selectedKey === opt.productType;
          return (
            <button
              key={opt.productType}
              type="button"
              onClick={() => { setSelectedKey(opt.productType); setShowPayment(false); }}
              className={`w-full flex items-center justify-between rounded-xl px-4 py-3 text-left transition-all border ${
                sel
                  ? `bg-white/[0.08] ${a.ring} ring-2 border-transparent`
                  : 'bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.06]'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white font-medium truncate">{opt.label}</p>
                {opt.detail && (
                  <p className="text-[11px] text-white/50 mt-0.5 truncate">{opt.detail}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className={`text-sm font-bold ${a.text}`}>
                  ₩{opt.priceKRW.toLocaleString('ko-KR')}
                </span>
                {sel && <Check className={`w-4 h-4 ${a.text}`} />}
              </div>
            </button>
          );
        })}
      </div>

      {/* Date + time + pax (only after option picked, to keep card compact when idle) */}
      {selected && (
        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <div>
            <label className="block text-[11px] text-white/55 mb-1.5 font-medium">
              <Calendar className="w-3 h-3 inline mr-1" />
              {L.pickupTime}
            </label>
            <div className="flex gap-1.5">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-xs outline-none focus:border-white/25 [color-scheme:dark]"
              />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-[80px] px-2.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-xs outline-none focus:border-white/25 [color-scheme:dark]"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-white/55 mb-1.5 font-medium">
              <Users className="w-3 h-3 inline mr-1" />
              {L.pax}
            </label>
            <select
              value={pax}
              onChange={(e) => setPax(Number(e.target.value))}
              className="w-full px-2.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-xs outline-none focus:border-white/25 [color-scheme:dark]"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n} {L.paxUnit}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* batch 9 (B9-11/12/13): 추가 입력 필드 — 공항 픽업 (캐리어/편명/터미널) */}
      {selected && showAirport && (
        <div className="space-y-3 mb-4 pt-3 border-t border-white/[0.06]">
          {/* 터미널 + 편명 */}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-white/55 mb-1.5 font-medium">{L.terminal}</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(['T1', 'T2'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTerminal(t)}
                    className={`py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                      terminal === t ? `bg-white/[0.08] ${a.text} border-current` : 'bg-white/[0.04] border-white/[0.08] text-white/60'
                    }`}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-white/55 mb-1.5 font-medium">{L.flightNo}</label>
              <input type="text" value={flightNumber}
                onChange={(e) => setFlightNumber(e.target.value.toUpperCase())}
                placeholder={L.flightNoPh} maxLength={10}
                className="w-full px-2.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-xs outline-none focus:border-white/25" />
            </div>
          </div>
          {/* 캐리어 — 소/중/대 */}
          <div>
            <label className="block text-[11px] text-white/55 mb-1.5 font-medium">{L.luggageLabel}</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { key: 'small', label: L.luggageSmall, value: lugSmall, set: setLugSmall },
                { key: 'medium', label: L.luggageMedium, value: lugMedium, set: setLugMedium },
                { key: 'large', label: L.luggageLarge, value: lugLarge, set: setLugLarge },
              ].map((lug) => (
                <div key={lug.key} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08]">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-white/55 truncate">{lug.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => lug.set(Math.max(0, lug.value - 1))} disabled={lug.value === 0}
                      className="w-5 h-5 text-xs text-white/70 disabled:opacity-30">−</button>
                    <span className="text-xs font-bold text-white w-3 text-center">{lug.value}</span>
                    <button type="button" onClick={() => lug.set(Math.min(20, lug.value + 1))}
                      className="w-5 h-5 text-xs text-white/70">+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* batch 9 (B9-12/13): 추가 입력 필드 — 차터 (픽업 위치 + 기사 언어) */}
      {selected && showCharter && (
        <div className="space-y-3 mb-4 pt-3 border-t border-white/[0.06]">
          <div>
            <label className="block text-[11px] text-white/55 mb-1.5 font-medium">{L.pickupLocation}</label>
            <input type="text" value={pickupAddress}
              onChange={(e) => setPickupAddress(e.target.value)}
              placeholder={L.pickupLocationPh} maxLength={120}
              className="w-full px-2.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white text-xs outline-none focus:border-white/25" />
          </div>
          <div>
            <label className="block text-[11px] text-white/55 mb-1.5 font-medium">{L.driverLang}</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['en', 'ja', 'zh'] as const).map((dl) => (
                <button key={dl} type="button" onClick={() => setDriverLang(dl)}
                  className={`py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                    driverLang === dl ? `bg-white/[0.08] ${a.text} border-current` : 'bg-white/[0.04] border-white/[0.08] text-white/60'
                  }`}>{dl === 'en' ? 'EN' : dl === 'ja' ? 'JA' : 'ZH'}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Action: show "Proceed" button until clicked, then mount payment route gate */}
      {selected && !showPayment && (
        <button
          type="button"
          onClick={() => { setShowPayment(true); }}
          disabled={!canProceed}
          className="w-full py-3.5 rounded-xl text-center text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
          style={{
            background: accent === 'amber'
              ? 'linear-gradient(135deg, #f59e0b, #d97706)'
              : accent === 'violet'
                ? 'linear-gradient(135deg, #7C5CFC, #EA537E)'
                : 'linear-gradient(135deg, #10b981, #059669)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          }}
        >
          {!userEmail
            ? '로그인 후 결제 가능'
            : !date
              ? L.pickupTime
              : L.proceed}
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* 결제 진행 — paypal.me QR 단일 흐름 (PayPalBookingButton wrapper). 위치 게이트
          / Braintree↔QR 토글 모두 제거 (5/6 Braintree LIVE 한국 미가입 확정 후). */}
      {selected && showPayment && (
        <div className="mt-2 flex flex-col gap-2">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/55">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading payment...
              </div>
            }
          >
            <PayPalBookingButton
              productType={selected.productType}
              passengers={pax}
              dateStart={date}
              dateEnd={date}
              priceKRW={selected.priceKRW}
              lang={lang}
              pickupLocation={pickupAddress || selected.label}
              memo={(() => {
                // batch 9 (B9-11/12/13): memo 에 추가 입력 정보 통합 — 운영자 어드민에서
                // 한 줄로 모든 정보 확인 가능. extraFields 미설정 시 기존 동작과 동일.
                const lines = [`Inline booking from plan ${planId || ''} — ${title}`, `Time: ${time}`];
                if (showAirport) {
                  if (terminal) lines.push(`Terminal: ${terminal}`);
                  if (flightNumber) lines.push(`Flight: ${flightNumber}`);
                  const lugTotal = lugSmall + lugMedium + lugLarge;
                  if (lugTotal > 0) lines.push(`Luggage: S${lugSmall}/M${lugMedium}/L${lugLarge} = ${lugTotal}`);
                }
                if (showCharter) {
                  if (pickupAddress) lines.push(`Pickup: ${pickupAddress}`);
                  lines.push(`Driver lang: ${driverLang.toUpperCase()}`);
                }
                return lines.join(' | ');
              })()}
              userEmail={userEmail}
              airport={showAirport ? {
                terminal: terminal || undefined,
                flightNumber: flightNumber || undefined,
                luggage: { small: lugSmall, medium: lugMedium, large: lugLarge },
              } : undefined}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
