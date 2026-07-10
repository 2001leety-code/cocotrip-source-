import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Tag, Check, AlertCircle, Ticket, Sparkles, ChevronDown, ChevronUp, ArrowRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { track as posthogTrack } from '@/lib/posthog';
import { trackPaidConversion, trackBeginCheckout, getAttributionSnapshot } from '@/lib/analytics';
import { useLoyalty } from '@/hooks/useLoyalty';
import { useAuth } from '@/hooks/useAuth';
import { haptic } from '@/lib/haptic';
import { authFetch } from '@/lib/authFetch';
import { CALCULATOR_KRW_PER_USD } from '@/lib/calculator';
import { formatPrice } from '@/lib/exchange-rate';
import { discountV2Enabled } from '@/lib/discountFlags';

// SDK 차단·로드 실패 시 fallback — paypal.me QR (외부 redirect, paypalobjects.com 무관).
// lazy import 로 첫 paint 영향 0.
const PayPalQrPanel = lazy(() =>
  import('./PayPalQrPanel').then((m) => ({ default: m.PayPalQrPanel })),
);

/** PayPal 결제 컴포넌트에서 사용하는 i18n 키 */
interface BookingDict {
  paypalSdkError?: string;
  paypalError?: string;
  paypalCancel?: string;
  paypalLoading?: string;
  paypalBookBtn?: string;
  paypalRateLabel?: string;
  paypalRetry?: string;
  [key: string]: unknown;  // 추가 키 허용 (하위 호환)
}

/** 공항 픽업 부가 정보 — 터미널/편명/수하물. */
// batch 9 (B9-21): terminal 값을 ICN 외 공항(GMP 국내선/국제선 등)으로 확장.
//   ICN: 'T1' | 'T2', GMP: 'GMP_DOM' | 'GMP_INT', PUS/CJU: undefined.
export interface AirportBookingInfo {
  terminal?: string;
  flightNumber?: string;
  luggage?: { small?: number; medium?: number; large?: number };
}

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  /** i18n dict — 옵션 (호출처 일부 InlineBookingCard 가 미전달, 기본값 {}로 처리) */
  p?: BookingDict;
  lang: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  vehicleType?: string;
  memo?: string;
  itineraryData?: unknown;
  /** Called after PayPal capture succeeds — parent handles next step (e.g. AI plan generation) */
  onPaymentSuccess?: (orderID: string) => void | Promise<void>;
  /** 현재 사용자 이메일 — 테스트 계정 감지용 */
  userEmail?: string;
  /** 공항 픽업 전용 부가 정보 (터미널/편명/수하물) */
  airport?: AirportBookingInfo;
  /** charter_custom_estimate 결제용 — backend로 전달, priceKRW override */
  customAmountKRW?: number;
  /** PR-R (2026-05-08): 픽업 시각 (HH:mm KST). 서버 마감 검증 기준. */
  pickupTime?: string;
  /** PR-R (2026-05-08): 투어 일수. >= 2 일 때 multi_day cutoff (48h) 적용. */
  durationDays?: number;
  /** 2026-06-02: 도시간 transfer/멀티데이/투어 시간제 backend 재계산용 — matrix km 조회 키.
   *  createPaypalOrder body 에 전달. 미전달 시 backend resolveXxxCheckoutKrw 에서 km=null → total null → 결제 불가.
   *  ⚠️ 플래그 ON + 이 값 미전달 = 활성화해도 결제 0. 각 서비스 UI 에서 state.origin/dest 기반 전달 필수. */
  originKey?: string;
  destKey?: string;
  /** 'oneway' | 'roundtrip' — transfer service 전용. 미전달 시 'oneway' fallback. */
  tripType?: 'oneway' | 'roundtrip';
  /** transfer/tour_hourly 결제 시 backend 차종 재계산용 */
  vehicle?: string;
  /** 2026-06-28 트립닷컴식 예약정보 — 개인정보/이용약관 동의 여부. (금액 로직 무관, 추적용 보존.)
   *  ⚠️ 결제 금액·capture·멱등성 로직 무관. createPaypalOrder/capturePaypalOrder body 에
   *  additive 로 전달만 → 백엔드가 booking 레코드에 컴플라이언스 메타로 보존. 미전달 시 false. */
  termsAgreed?: boolean;
  /** 2026-06-29 마케팅(선택) 정보 수신 동의 — termsAgreed 와 독립. 금액/게이트 무관, capture body 로
   *  보존만(미동의해도 결제 진행). 미전달 시 false. */
  marketingConsent?: boolean;
}

interface RateInfo {
  usdAmount: string;
  currentRate: number;
  displayKRW: string;
  displayUSD: string;
  orderID: string;
}

interface SuccessData {
  orderID: string;
  payerName: string;
  payerEmail: string;
  amount: string;
}

declare global {
  interface Window {
    paypal?: {
      Buttons: (config: Record<string, unknown>) => { render: (selector: string) => void; isEligible: () => boolean };
      FUNDING: Record<string, string>;
    } & Record<string, unknown>;
  }
}

// Launch (2026-04-30) 부터 live 결제만 사용. sandbox 분기 필요 시 이메일 추가.
// 2026-05-03: 운영자(태연) 본인 결제+환불 end-to-end 테스트용. sandbox PayPal +
// 🧪 bypass 버튼 노출. 운영 안정 후 제거 가능.
const TEST_ACCOUNTS: string[] = ['2001leety@gmail.com'];

export function PayPalBookingButton({ productType, passengers, dateStart = '', dateEnd = '', priceKRW: rawPriceKRW, p = {}, lang, pickupLocation = '', dropoffLocation = '', vehicleType = '', memo = '', itineraryData, onPaymentSuccess, userEmail = '', airport, customAmountKRW, pickupTime = '', durationDays, originKey, destKey, tripType, vehicle, termsAgreed, marketingConsent }: Props) {
  // 이슈 18: userId 필요 — Firestore 개인 쿠폰 검증 시 backend에 전달.
  // B-9 (2026-05-12): authUser 를 isSandboxAccount 계산에도 재사용. hook 호출 1회로 통합.
  const { user: authUser } = useAuth();
  const authUserId = authUser?.uid ?? null;
  // B-9 (2026-05-12): Test Mode 버튼은 Firebase auth + email input 둘 다 admin email 매칭
  // 시에만 노출. ADMIN-BYPASS- 흐름은 server-side 가 Firebase ID token 으로 admin 검증
  // — 미로그인 시 무조건 401. userEmail input 만으로는 부족.
  const adminEmailMatched = TEST_ACCOUNTS.includes(userEmail.toLowerCase().trim());
  const firebaseEmailMatched = !!(authUser?.email && TEST_ACCOUNTS.includes(authUser.email.toLowerCase().trim()));
  const isSandboxAccount = adminEmailMatched && firebaseEmailMatched;
  // 🔴 돈 버그 fix (2026-06-14): 쿠폰 피커는 FEATURE_DISCOUNT_V2 활성 시에만 노출.
  //   v2 OFF(현 prod 기본)면 createPaypalOrder 가 쿠폰 할인을 청구가에 미반영(정가 청구)하므로
  //   피커를 보이면 화면 할인가 ≠ 실제 정가 청구 + 1회용 쿠폰 소진(capture) = 초과청구·쿠폰 손실.
  //   백엔드 청구·소진 게이트(createPaypalOrder.js:237, capturePaypalOrder coupon pre-lock)와
  //   동일 플래그로 일관 — v2 OFF: 정가·쿠폰 미노출·미소진 / v2 ON: 정상 동작.
  const showCouponPicker = discountV2Enabled();
  // customAmountKRW (charter_custom_estimate) 가 있으면 priceKRW override — 5/4 추가
  const priceKRW = customAmountKRW != null && customAmountKRW > 0 ? customAmountKRW : rawPriceKRW;
  console.log('[PayPal Props]', { productType, passengers, dateStart, dateEnd, priceKRW });
  const [paypalReady, setPaypalReady] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [showPaypal,  setShowPaypal]  = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [rateInfo,    setRateInfo]    = useState<RateInfo | null>(null);
  const buttonsRendered = useRef(false);
  // SDK 차단/로드 실패 시 사용자가 paypal.me QR fallback 으로 전환 가능. error 발생 시
  // [QR 로 결제] 버튼 노출 → 클릭 시 PayPalQrPanel 렌더.
  const [useFallback, setUseFallback] = useState(false);

  // ── Promo code state ──────────────────────────────────────────────
  const [promoCode,     setPromoCode]     = useState('');
  const [promoLoading,  setPromoLoading]  = useState(false);
  const [promoApplied,  setPromoApplied]  = useState(false);
  const [promoError,    setPromoError]    = useState<string | null>(null);
  const [discountedKRW, setDiscountedKRW] = useState<number | null>(null);
  const [savedAmount,   setSavedAmount]   = useState(0);
  // 이슈 37 fix (2026-05-08): 적용된 쿠폰 종류/할인율 추적 — fixed-amount(USD)
  // 쿠폰을 (-20%) 처럼 percent로 잘못 표시하던 버그 해결.
  const [discountRate,  setDiscountRate]  = useState<number | null>(null);
  const [couponDocId,   setCouponDocId]   = useState<string | null>(null);
  const [couponUserId,  setCouponUserId]  = useState<string | null>(null);
  const [pickerOpen,    setPickerOpen]    = useState(false);

  // \ubcf4\uc720 \ucfe0\ud3f0 \u2014 \ubbf8\ub85c\uadf8\uc778 \uc2dc hook\uc740 \uc548\uc804 (loyalty=null, coupons=[]).
  const { activeCoupons } = useLoyalty();
  // P1-②: AI 무료쿠폰(productScope='ai-plan')은 이 할인 picker 에서 제외 — 할인 적용 대상이 아니라
  //   PurchaseSection 의 "무료 쿠폰으로 받기"(0원) 버튼 전용. (MyPage 쿠폰함에는 그대로 노출.)
  const discountCoupons = activeCoupons.filter(c => {
    if (c.productScope === 'ai-plan') return false; // AI 무료쿠폰 제외(위)
    // 상품 스코프 불일치 쿠폰 숨김 — 투어 전용 쿠폰을 차터/공항/콤보 결제에 노출 X.
    // (서버 applyPromoCode 도 reject 하지만 프론트 picker 가 안 맞는 쿠폰을 보여주던 UX 갭 fix.)
    const isCharterFamily = productType.startsWith('charter_') || productType.startsWith('airport_') || productType.startsWith('combo_');
    if ((c.productScope === 'tour-package' || c.productScope === 'tour_package') && isCharterFamily) return false;
    return true;
  });
  // B-9 (2026-05-12): authUser / authUserId \ub294 \ucef4\ud3ec\ub10c\ud2b8 \uc0c1\ub2e8\uc5d0\uc11c \uc774\ubbf8 \ud638\ucd9c\ub428.

  const PROMO_LABELS: Record<string, Record<string, string>> = {
    ko: {
      label: '\ucfe0\ud3f0 \ucf54\ub4dc', apply: '\uc801\uc6a9', success: '\ud560\uc778 \uc801\uc6a9\ub428',
      invalid: '\uc720\ud6a8\ud558\uc9c0 \uc54a\uc740 \ucf54\ub4dc', expired: '\ud504\ub85c\ubaa8\uc158 \uc885\ub8cc',
      pickerOpen: '\ucfe0\ud3f0 \uc0ac\uc6a9\ud558\uae30',
      pickerEmpty: '\uc0ac\uc6a9 \uac00\ub2a5\ud55c \ucfe0\ud3f0\uc774 \uc5c6\uc5b4\uc694',
      adTitle: 'AI \ud50c\ub798\ub108 1\ud68c = 5% \ucfe0\ud3f0 1\uc7a5',
      adBody: '124,000\uc6d0 \ucc28\ub7c9 \uc608\uc57d = \uc57d 6,200\uc6d0 \uc808\uc57d. \ud50c\ub798\ub108($9.90) \uac70\uc758 \ubb34\ub8cc!',
      adCta: 'AI \ud50c\ub798\ub108 \ub9cc\ub4e4\uae30',
      saved: '\uc808\uc57d', expires: '\ub9cc\ub8cc',
    },
    en: {
      label: 'Promo code', apply: 'Apply', success: 'Discount applied',
      invalid: 'Invalid code', expired: 'Promotion ended',
      pickerOpen: 'Use a coupon',
      pickerEmpty: 'No coupons yet',
      adTitle: '1 AI plan = 1\u00d7 5% coupon',
      adBody: 'Book a \u20a9124,000 charter \u2248 \u20a96,200 saved. The planner ($9.90) pays for itself.',
      adCta: 'Make AI plan',
      saved: 'Saved', expires: 'Expires',
    },
    ja: {
      label: '\u30af\u30fc\u30dd\u30f3\u30b3\u30fc\u30c9', apply: '\u9069\u7528', success: '\u5272\u5f15\u9069\u7528',
      invalid: '\u7121\u52b9\u306a\u30b3\u30fc\u30c9', expired: '\u30d7\u30ed\u30e2\u7d42\u4e86',
      pickerOpen: '\u30af\u30fc\u30dd\u30f3\u3092\u4f7f\u3046',
      pickerEmpty: '\u4f7f\u3048\u308b\u30af\u30fc\u30dd\u30f3\u304c\u3042\u308a\u307e\u305b\u3093',
      adTitle: 'AI\u30d7\u30e9\u30f31\u56de = 5%\u30af\u30fc\u30dd\u30f3',
      adBody: '\u20a9124,000\u306e\u30c1\u30e3\u30fc\u30bf\u30fc\u4e88\u7d04 \u2245 \u20a96,200\u306e\u7bc0\u7d04\u3002\u30d7\u30e9\u30f3($9.90)\u306f\u307b\u307c\u7121\u6599\uff01',
      adCta: 'AI\u30d7\u30e9\u30f3\u4f5c\u6210',
      saved: '\u7bc0\u7d04', expires: '\u6709\u52b9\u671f\u9650',
    },
    zh: {
      label: '\u4f18\u60e0\u5238\u7801', apply: '\u5e94\u7528', success: '\u6298\u6263\u5df2\u5e94\u7528',
      invalid: '\u65e0\u6548\u4ee3\u7801', expired: '\u4fc3\u9500\u5df2\u7ed3\u675f',
      pickerOpen: '\u4f7f\u7528\u4f18\u60e0\u5238',
      pickerEmpty: '\u6682\u65e0\u53ef\u7528\u4f18\u60e0\u5238',
      adTitle: 'AI \u884c\u7a0b 1 \u6b21 = 5% \u4f18\u60e0\u5238',
      adBody: '\u9884\u8ba2 \u20a9124,000 \u5305\u8f66 \u2248 \u8282\u7701 \u20a96,200\uff0c\u884c\u7a0b($9.90)\u51e0\u4e4e\u514d\u8d39\uff01',
      adCta: '\u5236\u4f5c AI \u884c\u7a0b',
      saved: '\u8282\u7701', expires: '\u5230\u671f',
    },
  };
  const pl = PROMO_LABELS[lang] ?? PROMO_LABELS.en;

  async function applyCouponCode(code: string) {
    if (!code.trim()) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      // 서버가 토큰(auth.uid)으로 본인 확인 후 개인 쿠폰 조회 — body.userId 제거(IDOR fix).
      // authFetch 가 로그인 시 Firebase ID 토큰을 Bearer 로 첨부. 비로그인은 글로벌 프로모만.
      const res = await authFetch('/api/applyPromoCode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, productType, originalPrice: priceKRW }),
      });
      const json = await res.json();
      const d = json.data;
      if (d?.valid) {
        setDiscountedKRW(d.discountedPrice);
        setSavedAmount(d.savedAmount);
        // 이슈 37 fix: backend의 discountRate (0.05 = 5%) 보존. fixed-amount(USD)
        // 쿠폰은 환율에 따라 다른 비율이 나오므로 percent 표시는 비활성화.
        setDiscountRate(typeof d.discountRate === 'number' ? d.discountRate : null);
        setPromoApplied(true);
        setCouponDocId(d.couponDocId || null);
        // 이슈 18 fix: userId는 authUserId로 직접 설정 (d.userId가 없을 경우 fallback).
        setCouponUserId(d.userId || authUserId);
        setPromoCode(code);
        setPickerOpen(false);
        haptic('success');
      } else {
        // 이슈 19 fix: INVALID_CODE는 '미등록/만료된 코드' 가 아닌 '유효하지 않은 코드'.
        // promo_expired / PROMO_LIMIT_REACHED 일 때만 pl.expired("Promotion ended") 표시.
        const isExpired = json.code === 'PROMO_LIMIT_REACHED' || d?.error === 'promo_expired';
        setPromoError(isExpired ? pl.expired : pl.invalid);
      }
    } catch {
      setPromoError(pl.invalid);
    } finally {
      setPromoLoading(false);
    }
  }


  const effectiveKRW = discountedKRW ?? priceKRW;

  // ── PayPal SDK 동적 로드 ─────────────────────────────────────────
  // 2026-05-03 사용자 신고: prod에서 SDK timeout 발생 + "다시 시도" 버튼이 실제로
  // 재로드를 안 함 → 같은 timeout 재발. loadPaypalSdk를 함수로 추출해 force=true
  // 모드 추가 (script element 강제 제거 후 재생성).
  function loadPaypalSdk(force = false) {
    // P314 (2026-05-30): sandbox e2e 모드 — VITE_PAYPAL_ENV==='sandbox' (preview 빌드에만
    // 등록) 일 때 sandbox client-id 로 SDK 로드. prod 빌드엔 VITE_PAYPAL_ENV 미등록 → live.
    // 백엔드 resolveIsSandbox 와 대칭 (백엔드는 런타임 VERCEL_ENV, 프론트는 빌드타임 분리).
    // 가짜 미국 buyer 로그인하려면 SDK 도 sandbox client-id 여야 함 (live SDK ↔ sandbox buyer 불가).
    // P314 rebuild marker (2026-05-30): VITE_PAYPAL_ENV=sandbox 를 Vercel Preview 에 확정한 후
    // 재빌드 트리거용 (Vite env 는 빌드타임 박힘 — env 변경 후 재빌드 안 하면 옛 번들 서빙).
    const sandboxMode = String(import.meta.env.VITE_PAYPAL_ENV || '').toLowerCase() === 'sandbox';
    const clientId = sandboxMode
      ? import.meta.env.VITE_PAYPAL_SANDBOX_CLIENT_ID
      : import.meta.env.VITE_PAYPAL_CLIENT_ID;
    console.log(`[PayPal SDK] mode: ${sandboxMode ? 'SANDBOX' : 'LIVE'} | clientId:`, clientId ? clientId.substring(0, 8) + '...' : '❌ 없음', '| force:', force);
    if (!clientId) {
      setError(p.paypalSdkError ?? 'PayPal client ID not configured.');
      return;
    }

    // 2026-05-03 사용자 정책: 실제 결제는 LIVE. TEST 계정은 🧪 Test Mode 버튼으로 결제 우회.
    // P314: sandbox e2e 는 별도 — VITE_PAYPAL_ENV 빌드 플래그로만 활성 (preview 전용).
    void isSandboxAccount; // 의도적으로 무시 (Test Mode 버튼 노출 분기에만 사용)
    const expectedMode = sandboxMode ? 'sandbox' : 'live';
    let existing = document.getElementById('paypal-sdk') as HTMLScriptElement | null;

    if (existing) {
      const loadedMode = existing.dataset.mode ?? 'live';
      const mismatched = loadedMode !== expectedMode;
      if (force || mismatched) {
        console.log('[PayPal SDK] removing existing script (force:', force, '| mismatch:', mismatched, ')');
        existing.remove();
        try { delete window.paypal; } catch { /* ignore */ }
        setPaypalReady(false);
        existing = null;
      } else if (window.paypal) {
        setPaypalReady(true);
        return;
      } else {
        existing.addEventListener('load', () => setPaypalReady(true));
        return;
      }
    } else if (!force && window.paypal) {
      setPaypalReady(true);
      return;
    }

    const script = document.createElement('script');
    script.id   = 'paypal-sdk';
    script.dataset.mode = expectedMode;
    script.async = true;
    // 2026-05-03: sandbox 분기 제거 — 항상 LIVE clientId + LIVE URL.
    // TEST 계정도 실제 결제는 LIVE로 진행하고, Test Mode 버튼만 별도 SDK 우회 경로.
    const resolvedClientId = clientId;
    const sdkBase = 'https://www.paypal.com/sdk/js';
    // force=true 시 cache-buster 추가 (브라우저가 실패한 응답을 캐시한 경우 회피).
    const cacheBust = force ? `&_t=${Date.now()}` : '';
    // 2026-05-19 P95: `enable-funding=googlepay,applepay` 제거. Apple Pay/Google Pay
    // 활성화는 PayPal 머천트 대시보드 (1) 결제 수단 활성화 (2) cocotripkr.com 도메인
    // 등록 (3) /.well-known/apple-developer-merchantid-domain-association 호스팅
    // 3종 모두 필요. 미완료 상태에서 enable-funding 에 포함하면 PayPal CDN 이
    // SDK js 요청에 HTTP 400 반환 → SDK 로드 자체 실패 → 결제 페이지 사용 불가.
    // 운영자 PayPal 머천트 대시보드 설정 완료 후 재추가. 회귀 차단: 메모리 P95 + lint.
    const sdkUrl = `${sdkBase}?client-id=${resolvedClientId}&currency=USD&intent=capture&components=buttons${cacheBust}`;
    script.src = sdkUrl;
    console.log('[PayPal SDK] loading mode:', expectedMode, '| clientId prefix:', resolvedClientId.substring(0, 8));
    script.onload = () => {
      script.dataset.loaded = 'true';
      // 2026-05-03 사용자 신고: ad blocker (uBlock 등)가 PayPal CDN을 200 stub
      // 응답으로 가로챌 수 있음 → script.onload는 fire되지만 실제 SDK 코드는
      // 실행 안 됨 → window.paypal undefined. 명시적 가드 + 친절한 메시지.
      if (typeof window.paypal === 'undefined') {
        console.error('[PayPal SDK] script onload fired but window.paypal undefined — likely ad blocker stub');
        setError(p.paypalSdkError ?? 'PayPal blocked by ad blocker / browser shields. Please disable for this site and reload.');
        return;
      }
      console.log('[PayPal SDK] loaded successfully, window.paypal ready');
      setPaypalReady(true);
    };
    script.onerror = (err) => {
      console.error('PayPal SDK load error:', err);
      setError(p.paypalSdkError ?? 'Failed to load PayPal SDK. Disable ad blocker for this site and retry.');
    };
    document.body.appendChild(script);
  }

  // isSandboxAccount가 바뀔 때마다 재실행 — 이메일 입력 후 올바른 SDK 로드 보장
  useEffect(() => {
    loadPaypalSdk(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSandboxAccount]);

  // ── PayPal Buttons 렌더링 ────────────────────────────────────────
  useEffect(() => {
    if (!showPaypal || !paypalReady || !rateInfo || buttonsRendered.current) return;
    if (!window.paypal) return;

    buttonsRendered.current = true;

    const sharedConfig = {
      // 모바일 호환: 주문은 미리 생성됨 → ID만 동기 반환 (async 금지 — 모바일 팝업 차단 방지)
      createOrder: () => rateInfo.orderID,
      onApprove: async (data: { orderID: string }) => {
        try {
          // PR-J fix: 글로벌 프로모 코드 (COCO5/COCO10/EARLY50) 사용량 increment 는
          // capturePaypalOrder runTransaction (L176-194) 가 처리. 여기서 promoCode 를
          // 누락하면 backend 가 받지 못해 카운트가 0 으로 남음. 사용자 쿠폰 (couponDocId/
          // couponUserId) 와는 별개 — 둘 다 적용 가능 (예: 사용자 쿠폰 없이 EARLY50 만).
          if (promoApplied && !promoCode) {
            console.warn('[PayPal onApprove] promoApplied=true but promoCode empty — global promo increment will be skipped');
          }
          // 버그헌트 2026-06-19 IDOR fix: 쿠폰 소유자 검증용 토큰 전송(authFetch — 로그인 시 자동
          //   Bearer 첨부, 게스트는 헤더 없이 진행). 백엔드가 토큰 uid===couponUserId 확인.
          const res = await authFetch('/api/capturePaypalOrder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderID:         data.orderID,
              product:         productType,
              tourDate:        dateStart,
              pickupLocation,
              dropoffLocation,
              paxCount:        passengers,
              vehicleType,
              memo,
              itineraryData:   itineraryData || null,
              userEmail,
              ...(airport ? { airport } : {}),
              ...(couponDocId ? { couponDocId, couponUserId } : {}),
              ...(promoApplied && promoCode ? { promoCode } : {}),
              // 2026-06-30 트립닷컴식 예약정보 — 약관동의 컴플라이언스 메타 (SMS 본인인증 제거 운영자).
              //   🔴 fix: 이 값을 capture body 에 전달하지 않으면 capturePaypalOrder.js 가
              //   항상 false 로 기록(동의 증거 미보존). additive — 금액/capture/멱등성 로직 무관.
              //   undefined 면 false 전달(백엔드 ===true 비교라 false 명시가 안전).
              termsAgreed: termsAgreed === true,
              ...(termsAgreed === true ? { termsAgreedAt: new Date().toISOString() } : {}),
              // 2026-06-29 마케팅(선택) 동의 — termsAgreed 와 독립, capture body 보존만(게이트 X).
              marketingConsent: marketingConsent === true,
              ...(marketingConsent === true ? { marketingConsentAt: new Date().toISOString() } : {}),
              // P1 (2026-07-11): 장기 유입 귀속 — first/last UTM 스냅샷(PII 없음, null 이면 생략).
              //   서버(sanitizeAttribution)가 화이트리스트 재검증. 금액/capture/멱등성 무관.
              ...((() => { const a = getAttributionSnapshot(); return a ? { attribution: a } : {}; })()),
            }),
          });
          const json = await res.json();
          if (import.meta.env.DEV) {
            console.log('[PayPal onApprove] capture result:', JSON.stringify(json));
          }
          const isSuccess = json.ok === true;
          const result = json.data;
          if (isSuccess) {
            void posthogTrack('payment_completed', {
              planType: productType,
              amount: priceKRW,
              currency: 'KRW',
              planId: (result && typeof result === 'object' && 'planId' in result) ? (result as { planId?: string }).planId : undefined,
            });
            // 홍보 실행안 1순위: GA4 표준 'purchase' 전환 발화 → Google Ads import(value+currency+orderID dedup).
            //   value=USD (PayPal 실제 청구통화 currency=USD 와 일치 — 운영자 "달러로 맞춰" 2026-06-15.
            //   KRW/CALCULATOR_KRW_PER_USD = 표시 USD 동일. begin_checkout 과 통화 일치 = 깔때기 정합).
            //   GA_ID 미설정 시 no-op. orderID=거래당 유니크.
            trackPaidConversion({
              transactionId: data.orderID,
              productType,
              value: Math.round((effectiveKRW / CALCULATOR_KRW_PER_USD) * 100) / 100,
              currency: 'USD',
            });
            if (onPaymentSuccess) {
              setShowPaypal(false);
              await onPaymentSuccess(data.orderID);
              return;
            }
            setSuccessData(result);
            setShowSuccess(true);
            setShowPaypal(false);
          } else {
            const msg = json.error ?? result?.error ?? p.paypalError;
            console.error('[PayPal onApprove] 실패:', msg);
            void posthogTrack('payment_failed', { planType: productType, reason: 'capture_rejected' });
            setError(msg);
            setShowPaypal(false);
          }
        } catch (captureErr) {
          console.error('[PayPal onApprove] catch:', captureErr);
          void posthogTrack('payment_failed', { planType: productType, reason: 'capture_exception' });
          setError(captureErr instanceof Error ? captureErr.message : JSON.stringify(captureErr));
          setShowPaypal(false);
        }
      },
      onCancel: () => {
        setShowPaypal(false);
        buttonsRendered.current = false;
        setError(p.paypalCancel ?? null);
      },
      onError: (err: unknown) => {
        console.error('[PayPal SDK] onError:', err);
        void posthogTrack('payment_failed', { planType: productType, reason: 'sdk_error' });
        setError(err instanceof Error ? err.message : JSON.stringify(err));
        setShowPaypal(false);
        buttonsRendered.current = false;
      },
    };

    // layout:'vertical' → enable-funding=googlepay,applepay 로 활성화된
    // Google Pay / Apple Pay 를 자동으로 PayPal 버튼 아래 스택으로 표시.
    // 별도 fundingSource 렌더를 추가하면 중복 표시되므로 하나의 Buttons() 호출로 통합.
    window.paypal.Buttons({
      ...sharedConfig,
      style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
    }).render(`#paypal-btn-${productType}`);
  }, [showPaypal, paypalReady, rateInfo]);

  // ── SDK 준비 대기 헬퍼 ─────────────────────────────────────────
  // 2026-05-03: 사용자 prod에서 SDK timeout 발생 — 10s가 모바일/저속망에서 부족.
  // 20초로 확대 (preconnect 추가로 평균 로드 시간 단축, 단 abuse 방어용 한계는 유지).
  function waitForPaypalReady(timeoutMs = 20000): Promise<boolean> {
    return new Promise((resolve) => {
      if (window.paypal) return resolve(true);
      const start = Date.now();
      const interval = setInterval(() => {
        if (window.paypal) { clearInterval(interval); resolve(true); }
        else if (Date.now() - start > timeoutMs) { clearInterval(interval); resolve(false); }
      }, 200);
    });
  }

  // ── 버튼 클릭 핸들러 — SDK 대기 + 주문 생성 + PayPal 버튼 표시 ──
  async function handleBookClick() {
    setError(null);
    setLoading(true);
    buttonsRendered.current = false;
    // Sprint 2 #7: payment_started — fired when user commits to checkout
    // (CTA click), before PayPal SDK opens. amount=USD price (priceKRW÷~1300).
    void posthogTrack('payment_started', {
      planType: productType,
      amount: priceKRW,
      currency: 'KRW',
    });
    try {
      // 1. SDK가 로딩 중이면 대기 (최대 10초)
      const sdkReady = await waitForPaypalReady();
      if (!sdkReady) {
        const sdkTimeoutMsg = (p as unknown as Record<string, string | undefined>).paypalSdkTimeout
          || 'PayPal SDK loading timeout. If you use an ad blocker (uBlock, Brave shields), please allow this site and refresh.';
        throw new Error(sdkTimeoutMsg);
      }

      // 2. 주문 생성
      const res = await fetch('/api/createPaypalOrder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productType, passengers, dateStart, dateEnd, language: lang,
          userEmail,
          // PR-R (2026-05-08): 마감 검증용 — pickupTime + durationDays
          ...(pickupTime ? { pickupTime } : {}),
          ...(typeof durationDays === 'number' ? { durationDays } : {}),
          // 2026-06-02: transfer/multiday/tour_hourly backend 재계산용 (끊긴 고리 수정)
          ...(originKey ? { originKey } : {}),
          ...(destKey ? { destKey } : {}),
          ...(tripType ? { tripType } : {}),
          ...(vehicle ? { vehicle } : {}),
          ...(promoApplied ? { promoCode, discountedPrice: effectiveKRW } : {}),
          // v2(2026-06-07): 개인 쿠폰을 createOrder 에도 전달 → 백엔드가 실제 청구가에 적용(표시=청구).
          // OFF 시 백엔드가 무시 → 현행 동작. capture 의 couponDocId 전달(소진)과 별개.
          ...(couponDocId ? { couponDocId, couponUserId } : {}),
          // 🔴 charter_custom_estimate 즉시결제 — 추정가(customAmountKRW)를 backend 로 전달(끊긴 고리 수정).
          //   이 값 없으면 createPaypalOrder 가 금액 해석 실패→400("Unknown productType or invalid amount").
          //   backend 가 pricing.js SSOT range(30,000~10,000,000)로 sanity 검증 후 PayPal order 금액 확정.
          //   charter_custom_estimate 가 아니면 미전달(다른 상품 무영향).
          ...(productType === 'charter_custom_estimate' && customAmountKRW != null && customAmountKRW > 0 ? { customAmountKRW } : {}),
          // 2026-06-30 트립닷컴식 예약정보 — 약관동의 메타(컴플라이언스). SMS 본인인증 제거 운영자.
          //   additive 전달만 — createPaypalOrder 는 금액을 productType/날짜/쿠폰으로만 산정,
          //   이 값은 무시(알 수 없는 필드). 멱등성/금액/환율/락 로직 무관.
          ...(termsAgreed === true ? { termsAgreed: true } : {}),
        }),
      });
      const json = await res.json();
      const d = json.data;
      // PR-R (2026-05-08): BOOKING_CLOSED → 토스트 + ChatWidget 자동 오픈
      if (!res.ok && json.code === 'BOOKING_CLOSED') {
        const msg = json.error ??
          (lang === 'ko' ? '예약 마감 시간이 지났습니다. 빠른 예약은 챗 상담을 이용해주세요.'
          : lang === 'ja' ? '予約締切時間を過ぎました。お急ぎの方はチャットでご相談ください。'
          : lang === 'zh' ? '预订已截止。如需紧急预订，请使用聊天咨询。'
          : 'Booking is closed. For urgent bookings, please contact us via chat.');
        setError(msg);
        // 글로벌 이벤트 dispatch — ChatWidget이 listen 후 자동 오픈.
        try {
          window.dispatchEvent(new CustomEvent('cocotrip:open-chat', {
            detail: { reason: 'booking_closed', productType, dateStart, pickupTime },
          }));
        } catch (dispatchErr) {
          console.warn('[PayPal] open-chat dispatch failed:', dispatchErr);
        }
        return;
      }
      if (!res.ok || !json.ok) throw new Error(json.error ?? d?.error ?? 'Order creation failed');
      setRateInfo(d);
      setPaypalReady(true);
      // GA4 begin_checkout: 주문 생성 성공 → 결제창 진입 시점. "결제진입→구매" 전환율 측정(GA_ID 미설정 시 no-op).
      //   value=USD (PayPal 이 USD 로 청구 — currency=USD. KRW/CALCULATOR_KRW_PER_USD = 표시 USD 와 동일).
      trackBeginCheckout(productType, productType, passengers, Math.round((effectiveKRW / CALCULATOR_KRW_PER_USD) * 100) / 100);
      setShowPaypal(true);
    } catch (err) {
      console.error('[PayPal handleBookClick] catch:', err);
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  // 예상 USD (rate 없을 때 간이 계산)
  const estimatedUSD = rateInfo
    ? rateInfo.displayUSD
    : `\u2248 $${(effectiveKRW / CALCULATOR_KRW_PER_USD).toFixed(2)} USD`;

  // ── 예약 확인 모달 (Premium Overlay) ──────────────────────────────
  if (showSuccess && successData) {
    const CONFIRM_LABELS: Record<string, Record<string, string>> = {
      ko: { title: '예약이 확정되었습니다!', subtitle: '예약 확인 이메일이 발송됩니다.', orderNo: '주문 번호', payer: '예약자', amount: '결제 금액', date: '이용 날짜', next: '다음 단계', step1: '확인 이메일을 확인하세요', step2: '카카오톡/WhatsApp으로 기사 정보를 보내드립니다', step3: '이용 당일 기사가 픽업 장소에서 대기합니다', close: '확인', contact: '문의하기' },
      en: { title: 'Booking Confirmed!', subtitle: 'A confirmation email will be sent shortly.', orderNo: 'Order No.', payer: 'Booked by', amount: 'Amount Paid', date: 'Service Date', next: 'Next Steps', step1: 'Check your confirmation email', step2: 'Driver details will be sent via WhatsApp/LINE', step3: 'Your driver will be waiting at the pickup location', close: 'Done', contact: 'Contact Us' },
      ja: { title: '予約が確定しました！', subtitle: '確認メールが送信されます。', orderNo: '注文番号', payer: '予約者', amount: '支払金額', date: '利用日', next: '次のステップ', step1: '確認メールをご確認ください', step2: 'ドライバー情報をWhatsApp/LINEでお送りします', step3: '当日ドライバーがピックアップ場所でお待ちします', close: '確認', contact: 'お問い合わせ' },
      zh: { title: '预订已确认！', subtitle: '确认邮件将很快发送。', orderNo: '订单号', payer: '预订人', amount: '支付金额', date: '服务日期', next: '下一步', step1: '请查收确认邮件', step2: '司机信息将通过WhatsApp/LINE发送', step3: '当天司机将在接机地点等候', close: '确认', contact: '联系我们' },
    };
    const cl = CONFIRM_LABELS[lang] ?? CONFIRM_LABELS.en;
    
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}>
        <div className="w-full max-w-md bg-gradient-to-b from-[#0f1628] to-[#0a0f1a] rounded-3xl border border-[#7C5CFC]/30 shadow-[0_0_60px_rgba(124,92,252,0.15)] overflow-hidden animate-[fade-slide-up_0.4s_ease-out]">
          {/* Header with gradient */}
          <div className="relative px-6 pt-8 pb-6 text-center" style={{ background: 'linear-gradient(180deg, rgba(124,92,252,0.15) 0%, transparent 100%)' }}>
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-tr from-emerald-500 to-emerald-400 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.3)]">
              <Check className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">{cl.title}</h2>
            <p className="text-sm text-white/50">{cl.subtitle}</p>
          </div>
          
          {/* Booking Details */}
          <div className="px-6 pb-4">
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 space-y-3">
              <div className="flex justify-between items-center text-sm">
                <span className="text-white/55">{cl.orderNo}</span>
                <span className="font-mono text-white/80 text-xs bg-white/5 px-2 py-1 rounded-lg">{successData.orderID}</span>
              </div>
              {successData.payerName && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/55">{cl.payer}</span>
                  <span className="text-white/80">{successData.payerName}</span>
                </div>
              )}
              {successData.payerEmail && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/55">Email</span>
                  <span className="text-white/80 text-xs">{successData.payerEmail}</span>
                </div>
              )}
              {dateStart && (
                <div className="flex justify-between items-center text-sm">
                  <span className="text-white/55">{cl.date}</span>
                  <span className="text-white/80">{dateStart}{dateEnd && dateEnd !== dateStart ? ` ~ ${dateEnd}` : ''}</span>
                </div>
              )}
              <div className="flex justify-between items-center text-sm border-t border-white/[0.06] pt-3">
                <span className="text-white/55">{cl.amount}</span>
                <span className="text-xl font-bold text-emerald-400">${successData.amount} USD</span>
              </div>
            </div>
          </div>
          
          {/* Next Steps */}
          <div className="px-6 pb-4">
            <p className="text-[10px] uppercase tracking-widest text-white/55 font-semibold mb-3">{cl.next}</p>
            <div className="space-y-2">
              {[cl.step1, cl.step2, cl.step3].map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-5 h-5 rounded-full bg-[#7C5CFC]/20 text-[#7C5CFC] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{i + 1}</span>
                  <span className="text-white/60 leading-relaxed">{step}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Actions */}
          <div className="px-6 pb-6 flex gap-3">
            <a href="https://wa.me/821087140611" target="_blank" rel="noopener noreferrer"
              className="flex-1 py-3 rounded-xl border border-white/10 text-white/50 text-sm font-medium text-center hover:border-white/25 hover:text-white/70 transition-all">
              {cl.contact}
            </a>
            <button
              onClick={() => { setShowSuccess(false); setSuccessData(null); setRateInfo(null); }}
              className="flex-1 py-3 rounded-xl text-white font-bold text-sm transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #7C5CFC, #EA537E)' }}>
              {cl.close}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // SDK 차단·로드 실패 시 사용자가 fallback 으로 전환 → paypal.me QR 패널 노출.
  // PayPal 본 사이트 redirect (외부) 라 paypalobjects.com SDK CDN 차단 영향 무관.
  if (useFallback) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/55">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading alternative payment...
          </div>
        }
      >
        <PayPalQrPanel
          productType={productType}
          passengers={passengers}
          dateStart={dateStart}
          dateEnd={dateEnd}
          priceKRW={priceKRW}
          pickupLocation={pickupLocation}
          dropoffLocation={dropoffLocation}
          vehicleType={vehicleType}
          memo={memo}
          itineraryData={itineraryData}
          airport={airport}
          customerEmail={userEmail}
          onBack={() => setUseFallback(false)}
          onPaymentReported={(bookingRef) => {
            // paypal.me 흐름 = manual 결제. onPaymentSuccess 레거시 콜백 호환 위해 'MANUAL-' prefix
            // orderID 로 매핑 (paymentGate 가 인식).
            if (onPaymentSuccess) {
              return onPaymentSuccess(`MANUAL-${bookingRef}`);
            }
          }}
        />
      </Suspense>
    );
  }

  return (
    <div className="space-y-3">
      {/* Coupon picker — replaces the legacy text-input. Closed: a single
          row "Use a coupon ▼". Open: list of the user's owned coupons; an
          empty state shows the AI-planner ad copy. Picking a card calls
          the existing /api/applyPromoCode with the coupon's code, so the
          backend stays unchanged. The legacy promoCode state is still
          populated downstream for purchase metadata back-compat. */}
      {showCouponPicker && !showPaypal && !promoApplied && (
        <div>
          <button
            type="button"
            onClick={() => { haptic('tap'); setPickerOpen(o => !o); }}
            aria-expanded={pickerOpen}
            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 hover:border-[#7C5CFC]/40 hover:bg-white/[0.08] transition-all"
          >
            <span className="flex items-center gap-2">
              <Ticket className="w-4 h-4 text-[#B668FC]" />
              <span className="text-sm font-semibold text-white">{pl.pickerOpen}</span>
              {discountCoupons.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#B668FC]/20 text-[#B668FC] border border-[#B668FC]/25">
                  {discountCoupons.length}
                </span>
              )}
            </span>
            {pickerOpen ? <ChevronUp className="w-4 h-4 text-white/50" /> : <ChevronDown className="w-4 h-4 text-white/50" />}
          </button>

          {pickerOpen && (
            <div
              className="mt-2 space-y-2 overflow-hidden"
              style={{ animation: 'coupon-picker-in 0.25s ease-out' }}
            >
              <style>{`
                @keyframes coupon-picker-in {
                  from { opacity: 0; transform: translateY(-4px); }
                  to { opacity: 1; transform: translateY(0); }
                }
              `}</style>
              {discountCoupons.length === 0 ? (
                /* Ad: AI planner → 5% coupon. Math is per user spec. */
                <div className="rounded-xl border border-[#7C5CFC]/25 p-3.5"
                  style={{ background: 'linear-gradient(135deg, rgba(124,92,252,0.10), rgba(255,107,157,0.06))' }}>
                  <div className="flex items-start gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)' }}>
                      <Sparkles className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-bold text-white leading-tight">{pl.adTitle}</p>
                      <p className="text-[11px] text-white/65 leading-snug mt-1">{pl.adBody}</p>
                      <Link
                        to="/planner"
                        onClick={() => haptic('tap')}
                        className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#B668FC] hover:text-[#FF6B9D] transition-colors"
                      >
                        {pl.adCta}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                  <p className="text-[10px] text-white/35 mt-2.5 pt-2.5 border-t border-white/[0.05]">
                    {pl.pickerEmpty}
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {discountCoupons.map(c => {
                    const valueLabel = c.type === 'percent' ? `${c.value}%` : (c.currency === 'KRW' ? `₩${c.value.toLocaleString()}` : `$${c.value}`);
                    const expDate = new Date(c.expiresAt).toLocaleDateString();
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => applyCouponCode(c.code)}
                          disabled={promoLoading}
                          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] hover:border-[#7C5CFC]/40 hover:bg-white/[0.07] transition-all text-left disabled:opacity-50"
                        >
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-[#7C5CFC]/15 border border-[#7C5CFC]/25">
                            <Tag className="w-3.5 h-3.5 text-[#B668FC]" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-white truncate">{c.label}</p>
                            <p className="text-[10.5px] text-white/45 mt-0.5">{pl.expires}: {expDate}</p>
                          </div>
                          <span className="text-[14px] font-black text-[#B668FC] shrink-0">{valueLabel}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {promoError && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          {promoError}
        </div>
      )}
      {promoApplied && (
        <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/25 rounded-xl px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300">
            <Check className="w-3.5 h-3.5" />
            {/* \uC774\uC288 37 fix: percent \uCFE0\uD3F0\uC77C \uB54C\uB9CC (-N%) \uD45C\uC2DC, fixed-amount\uB294 \uC6B0\uCE21 \u20A9\uCC28\uAC10\uC561\uC73C\uB85C \uCDA9\uBD84.
                discountRate\uAC00 \uAE54\uB054\uD55C percent (5/10/20%)\uC77C \uB54C\uB9CC percent \uD45C\uAE30 \u2014 \uD658\uC728 \uD658\uC0B0\uB41C
                fixed-amount\uB294 5.4% \uAC19\uC740 \uC5B4\uC0C9\uD55C \uC218\uCE58\uAC00 \uB098\uC624\uBBC0\uB85C \uC0DD\uB7B5. */}
            {pl.success}{discountRate != null && Number.isInteger(discountRate * 100) && discountRate > 0 ? ` (-${Math.round(discountRate * 100)}%)` : ''}
          </div>
          <span className="text-xs font-bold text-emerald-300">{'-\u20A9'}{savedAmount.toLocaleString('ko-KR')}</span>
        </div>
      )}

      {/* PayPal 버튼 패널 */}
      {showPaypal ? (
        <div className="rounded-xl overflow-hidden border border-white/10 p-3 bg-white/[0.03]">
          <div id={`paypal-btn-${productType}`} />
          {!paypalReady && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-white/50">
              <div className="w-4 h-4 border-2 border-white/30 border-t-[#7C5CFC] rounded-full animate-spin" />
              Loading PayPal...
            </div>
          )}
        </div>
      ) : (
        /* 초기 예약 버튼 */
        <button
          type="button"
          disabled={loading}
          onClick={handleBookClick}
          className="w-full rounded-xl text-white font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: '#0070BA', padding: '13px 20px' }}>
          {loading ? (
            <span className="flex items-center justify-center gap-2 text-sm">
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {p.paypalLoading}
            </span>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-sm font-semibold">{p.paypalBookBtn}</span>
              <div className="flex items-center gap-2">
                {promoApplied ? (
                  <>
                    {/* \uC0AC\uC6A9\uC790 \uC5B8\uC5B4 \uAE30\uBC18 \uD45C\uC2DC. ko/en \uC740 \u20A9, ja\u2192\u00A5JPY, zh\u2192\u00A5CNY. \uC2E4 \uACB0\uC81C\uB294 PayPal USD. */}
                    <span className="text-[13px] text-white/55 line-through">
                      {lang === 'ja' || lang === 'zh' ? formatPrice(priceKRW, lang) : `\u20A9${priceKRW.toLocaleString('ko-KR')}`}
                    </span>
                    <span className="text-[15px] font-bold text-emerald-300">
                      {lang === 'ja' || lang === 'zh' ? formatPrice(effectiveKRW, lang) : `\u20A9${effectiveKRW.toLocaleString('ko-KR')}`}
                    </span>
                  </>
                ) : (
                  <span className="text-[15px] font-bold">
                    {lang === 'ja' || lang === 'zh'
                      ? formatPrice(priceKRW, lang)
                      : (rateInfo?.displayKRW ?? `\u20A9${priceKRW.toLocaleString('ko-KR')}`)}
                  </span>
                )}
                <span className="text-xs text-white/70">{estimatedUSD}</span>
              </div>
              {rateInfo && (
                <span className="text-[11px] text-white/50 mt-0.5">
                  {/* \uC774\uC288 38 fix: JSX text \uC548 \u20A9 \u2192 JS string literal\uB85C escape \uD480\uAE30 */}
                  {p.paypalRateLabel} 1 USD = {'\u20A9'}{rateInfo.currentRate.toLocaleString('ko-KR')}
                </span>
              )}
              {/* batch 9 fix (B9-9, 2026-05-09): \uBD80\uAC00\uC138 \uD3EC\uD568 \uBA85\uC2DC \u2014 \uCC28\uD130/\uD22C\uC5B4/AI\uD50C\uB798\uB108 \uACB0\uC81C \uACF5\uD1B5. */}
              <span className="text-[10px] text-white/45 mt-0.5">
                {lang === 'ko' ? '\uBD80\uAC00\uC138 \uD3EC\uD568' : lang === 'ja' ? '\u7A0E\u8FBC' : lang === 'zh' ? '\u542B\u7A0E' : 'VAT included'}
              </span>
            </div>
          )}
        </button>
      )}

      {/* 🧪 어드민 결제 우회 — TEST_ACCOUNTS(운영자 본인)만 보임.
           이슈 17 fix (2026-05-07): TEST- prefix → prod BRAINTREE_ENV 미설정 시 reject.
           ADMIN-BYPASS- prefix 사용 — paymentGate.js가 Firebase ID token + admin email
           이중 인증 후 허용.
           2026-05-12 (B-9 fix): 가정 명시화 — Test Mode 버튼은 위 isSandboxAccount 가드가
           Firebase auth + email input 둘 다 admin 매칭 시에만 노출. 미로그인 admin 은
           버튼 안 보임. handlePaymentSuccess 에서 getAuthHeader() 가 ID token 첨부 가능. */}
      {isSandboxAccount && onPaymentSuccess && (
        <button
          type="button"
          onClick={async () => {
            setLoading(true);
            setError(null);
            // batch 9 fix (B9-6): Test Mode 클릭 진단 로그.
            // userEmail 이 admin 매칭되어야 server-side ADMIN-BYPASS 통과 가능.
            const orderId = `ADMIN-BYPASS-${Date.now()}`;
            console.log('[Test Mode] click | userEmail:', userEmail, '| orderId:', orderId);
            try {
              await onPaymentSuccess(orderId);
            } catch (err) {
              console.error('[Test Mode] onPaymentSuccess failed:', err);
              setError(err instanceof Error ? err.message : 'Admin bypass failed');
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
          className="w-full rounded-xl text-white font-medium transition-all duration-200 hover:opacity-90 active:scale-[0.99] disabled:opacity-50 mt-2"
          style={{ background: 'linear-gradient(135deg, #f59e0b, #ef4444)', padding: '13px 20px' }}
        >
          <div className="flex items-center justify-center gap-2 text-sm">
            <span>🧪</span>
            <span className="font-bold">Test Mode: Skip Payment → Generate AI Plan</span>
          </div>
        </button>
      )}

      {/* 에러 — 2026-05-03 fix: SDK timeout인 경우 단순 state reset이 아니라
           실제로 script element 강제 재로드. 이전 동작은 같은 timeout 무한 재발.
           5/7 추가: SDK 차단 케이스 (한국 ISP의 paypalobjects.com 일부 차단) 대비
           "QR 로 결제" fallback 버튼 — paypal.me 외부 redirect 흐름. */}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setShowPaypal(false);
                buttonsRendered.current = false;
                // SDK 재로드 (캐시 무효화 + script 재생성). 로드되면 paypalReady=true.
                loadPaypalSdk(true);
              }}
              className="shrink-0 text-xs text-red-400 border border-red-500/40 px-3 py-1.5 rounded-lg hover:bg-red-500/20 transition-colors">
              {p.paypalRetry}
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setError(null); setUseFallback(true); }}
            className="w-full text-xs text-white/85 border border-white/25 hover:border-white/40 hover:bg-white/[0.04] px-3 py-2 rounded-lg transition-colors"
          >
            {lang === 'ko' ? 'QR 로 결제 (PayPal 본 사이트 직접)'
              : lang === 'ja' ? 'QRで決済 (PayPal本サイト直接)'
              : lang === 'zh' ? 'QR支付 (PayPal主站直接)'
              : 'Pay via QR (PayPal direct redirect)'}
          </button>
        </div>
      )}
    </div>
  );
}
