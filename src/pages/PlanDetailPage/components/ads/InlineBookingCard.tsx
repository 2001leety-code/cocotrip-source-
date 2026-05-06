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
//   4. Braintree 결제 완료 → 성공 모달 (BraintreePaymentButton 가 자체 처리)
//   5. Firestore booking 저장 + booking-processor 가 텔레그램 driver bot 알림

import { useState, lazy, Suspense } from 'react';
import { Calendar, Users, Check, ChevronRight, Loader2, Info } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

// Lazy import — BraintreePaymentButton + Drop-in 모듈은 결제 클릭 시점에만 로드.
// PreTripSlide 가 항상 마운트되므로 eager import 시 첫 paint 번들에 포함되어
// bundle-size budget (365kB) 초과. 실제 결제는 사용자가 클릭한 후에만 일어남.
const BraintreePaymentButton = lazy(() =>
  import('@/components/BraintreePaymentButton').then(m => ({ default: m.BraintreePaymentButton })),
);

// PayPal.Me QR fallback — 결제 실패 / SDK 차단 케이스. PaymentGuidanceModal 에서 진입.
const PayPalQrPanel = lazy(() =>
  import('@/components/PayPalQrPanel').then(m => ({ default: m.PayPalQrPanel })),
);

// 결제 전 안내 모달 — 한국 거주 외국인용 사전 안내 (네트워크/VPN/3DS).
const PaymentGuidanceModal = lazy(() =>
  import('@/components/PaymentGuidanceModal').then(m => ({ default: m.PaymentGuidanceModal })),
);

const TRIGGER_LABELS: Record<string, { guide: string; back: string }> = {
  ko: { guide: '한국에서 결제하시나요? 결제 전 안내 보기', back: '← 기본 결제로 돌아가기' },
  en: { guide: 'Paying from Korea? Read tips before payment', back: '← Back to default payment' },
  ja: { guide: '韓国から決済? お支払い前のご案内', back: '← 通常の決済に戻る' },
  zh: { guide: '在韩国支付? 支付前请先阅读', back: '← 返回默认支付' },
};

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
  },
  en: {
    chooseOption: 'Pick an option below',
    pickupTime: 'Date / Time',
    pax: 'Travelers',
    proceed: 'Proceed to Payment',
    pickFirst: 'Please pick an option first',
    selected: 'Selected',
    paxUnit: 'pax',
  },
  ja: {
    chooseOption: '以下から選択',
    pickupTime: '日付 / 時間',
    pax: '人数',
    proceed: '決済へ進む',
    pickFirst: '先にオプションを選択してください',
    selected: '選択済み',
    paxUnit: '名',
  },
  zh: {
    chooseOption: '请选择以下选项',
    pickupTime: '日期 / 时间',
    pax: '人数',
    proceed: '前往支付',
    pickFirst: '请先选择一个选项',
    selected: '已选',
    paxUnit: '人',
  },
};

export function InlineBookingCard({
  title, subtitle, icon, accent = 'amber', badge,
  options, defaultDate, defaultPax = 2, userEmail = '', planId,
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
  // 기본 = Braintree. 한국 결제 어려움 우려 사용자는 "결제 전 안내" 모달 → 모달에서
  // 필요 시 fallback (paypal.me QR) 진입. PR #275 의 위치 게이트 (한국 체류 여부) 강제
  // 분기는 제거 — PayPal 정책상 분기 의미 부정확.
  const [showFallback, setShowFallback] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const fbLang = (['ko', 'en', 'ja', 'zh'].includes(lang) ? lang : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const triggerL = TRIGGER_LABELS[fbLang];

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
          <p className={`text-xs ${a.text}/80`}>{subtitle}</p>
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

      {/* Action: show "Proceed" button until clicked, then mount payment route gate */}
      {selected && !showPayment && (
        <button
          type="button"
          onClick={() => { setShowPayment(true); setShowFallback(false); }}
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

      {/* 결제 진행 — 기본 = Braintree (PayPal/카드 통합 Drop-in).
          토글 클릭 시 PayPal.Me QR fallback 노출 (결제 실패/네트워크 차단 케이스).
          위치/체류 여부 게이트 없음 (PayPal 정책 = 계정 등록국 기준, 위치 무관). */}
      {selected && showPayment && !showFallback && (
        <div className="mt-2 flex flex-col gap-2">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/55">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading payment options...
              </div>
            }
          >
            <BraintreePaymentButton
              productType={selected.productType}
              passengers={pax}
              dateStart={date}
              dateEnd={date}
              priceKRW={selected.priceKRW}
              p={{}}
              lang={lang}
              pickupLocation={selected.label}
              memo={`Inline booking from plan ${planId || ''} — ${title}`}
              userEmail={userEmail}
            />
          </Suspense>
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="inline-flex items-center justify-center gap-1.5 text-[11px] text-white/55 hover:text-white/85 underline underline-offset-2 transition-colors self-center"
          >
            <Info className="w-3 h-3" />
            {triggerL.guide}
          </button>
        </div>
      )}

      {selected && showPayment && showFallback && (
        <div className="mt-2 flex flex-col gap-2">
          <Suspense
            fallback={
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/55">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading alternative payment...
              </div>
            }
          >
            <PayPalQrPanel
              productType={selected.productType}
              passengers={pax}
              dateStart={date}
              dateEnd={date}
              priceKRW={selected.priceKRW}
              pickupLocation={selected.label}
              memo={`Inline booking from plan ${planId || ''} — ${title}`}
              customerEmail={userEmail}
              onBack={() => setShowFallback(false)}
            />
          </Suspense>
          <button
            type="button"
            onClick={() => setShowFallback(false)}
            className="text-[11px] text-white/45 hover:text-white/70 underline underline-offset-2 transition-colors self-center"
          >
            {triggerL.back}
          </button>
        </div>
      )}

      {showGuide && (
        <Suspense fallback={null}>
          <PaymentGuidanceModal
            onClose={() => setShowGuide(false)}
            onUseFallback={() => { setShowGuide(false); setShowFallback(true); }}
          />
        </Suspense>
      )}
    </div>
  );
}
