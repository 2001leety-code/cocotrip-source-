// PayPalQrPanel — 한국 체류 외국인 사용자용 PayPal.Me QR 결제 패널.
//
// 배경 (2026-05-06): 외국인 사용자가 한국 도착 후 wifi/방화벽이 PayPal SDK CDN 차단
// → 사이트 임베디드 결제 (BraintreePaymentButton) 실패. 사용자 폰의 PayPal 앱은
// 모바일 데이터로 PayPal 직접 통신 가능 → QR 스캔으로 우회.
//
// 흐름:
//   1. 동적 QR 생성 — paypal.me/{username}/{usdAmount}USD
//   2. 사용자 폰 카메라로 QR 스캔 → PayPal 앱 자동 열림
//   3. PayPal 앱에서 booking ref 메모 입력 후 결제
//   4. 사용자가 [결제 완료 신고] 버튼 클릭
//   5. /api/manual-payment-request → Firestore pending_bookings + 텔레그램 booking #1 알림
//   6. 운영자 PayPal 알림 받고 admin UI 에서 [입금 확인] 클릭 → CONFIRMED + AI 플랜 자동 생성
//
// 환경변수 (frontend exposed - VITE_ prefix):
//   VITE_PAYPAL_ME_USERNAME   paypal.me username (필수, 예: 'cocotripkr')
//   VITE_USD_KRW_RATE         (옵션) hardcoded 환율, 미설정 시 1380
import { useState, useEffect } from 'react';
import { Smartphone, Copy, Check, Loader2, AlertCircle, Mail, Phone, ExternalLink } from 'lucide-react';
import QRCode from 'qrcode';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/hooks/useAuth';

interface Props {
  productType: string;
  passengers: number;
  dateStart?: string;
  dateEnd?: string;
  priceKRW: number;
  pickupLocation?: string;
  dropoffLocation?: string;
  vehicleType?: string;
  memo?: string;
  itineraryData?: unknown;
  airport?: { terminal?: 'T1' | 'T2'; flightNumber?: string; luggage?: { small?: number; medium?: number; large?: number } };
  /** 결제 신고 후 호출 — 호출자가 후속 UI 처리 (모달 close + 안내 토스트). bookingRef 전달. */
  onPaymentReported?: (bookingRef: string) => void | Promise<void>;
  onBack?: () => void;
  customerEmail?: string;
  customerPhone?: string;
}

const LABELS: Record<string, {
  title: string;
  step1Title: string;
  step1Desc: string;
  scanHint: string;
  amountLabel: string;
  refLabel: string;
  refHint: string;
  copy: string;
  copied: string;
  openLink: string;
  step2Title: string;
  step2Desc: string;
  emailLabel: string;
  emailPh: string;
  phoneLabel: string;
  phonePh: string;
  reportButton: string;
  reporting: string;
  reportedTitle: string;
  reportedDesc: string;
  reportedHint: string;
  back: string;
  errorEmail: string;
  errorReport: string;
  notConfigured: string;
}> = {
  ko: {
    title: 'PayPal QR 결제',
    step1Title: '1단계 — QR 스캔으로 결제',
    step1Desc: '한국 wifi 가 PayPal 차단 시 폰의 모바일 데이터로 우회됩니다.',
    scanHint: '폰 카메라로 QR 스캔 → PayPal 앱 자동 열림',
    amountLabel: '결제 금액',
    refLabel: 'PayPal 메모란에 입력 (필수)',
    refHint: '※ 메모 입력 안 하면 운영자 매칭 지연될 수 있어요',
    copy: '복사',
    copied: '복사됨',
    openLink: 'QR 안 되면 직접 링크 열기',
    step2Title: '2단계 — 결제 완료 신고',
    step2Desc: '결제 후 이메일을 입력하고 신고해 주세요. 운영자 확인 후 24시간 내 (보통 1시간) 영수증 + 플랜 발송됩니다.',
    emailLabel: '이메일 주소',
    emailPh: '예약 확정 받을 이메일',
    phoneLabel: '연락처 (선택)',
    phonePh: '+82 10-1234-5678',
    reportButton: '결제 완료 신고',
    reporting: '신고 중...',
    reportedTitle: '결제 신고가 접수되었습니다',
    reportedDesc: '운영자가 PayPal 입금 확인 후 영수증과 플랜을 이메일로 발송드립니다.',
    reportedHint: '예약 번호를 저장해 두세요',
    back: '뒤로',
    errorEmail: '이메일 주소를 입력해 주세요',
    errorReport: '신고 실패. 잠시 후 다시 시도해 주세요.',
    notConfigured: 'PayPal 결제 설정 중입니다. 카카오톡 @cocotripkr 로 직접 문의해 주세요.',
  },
  en: {
    title: 'PayPal QR Payment',
    step1Title: 'Step 1 — Scan QR to pay',
    step1Desc: "If Korean wifi blocks PayPal, your phone's mobile data bypasses it.",
    scanHint: 'Scan with your phone camera → PayPal app opens automatically',
    amountLabel: 'Amount',
    refLabel: 'PayPal memo (required)',
    refHint: '※ Without this memo, your booking match may be delayed',
    copy: 'Copy',
    copied: 'Copied',
    openLink: "QR not working? Open link directly",
    step2Title: 'Step 2 — Report payment',
    step2Desc: 'Enter your email after paying. We email your receipt + plan within 24 hours (usually 1 hour) once payment is verified.',
    emailLabel: 'Email',
    emailPh: 'Email to receive confirmation',
    phoneLabel: 'Phone (optional)',
    phonePh: '+1 555 0123',
    reportButton: 'Report payment complete',
    reporting: 'Submitting...',
    reportedTitle: 'Payment report received',
    reportedDesc: "We'll verify your PayPal deposit and email your receipt + plan shortly.",
    reportedHint: 'Please keep your booking reference',
    back: 'Back',
    errorEmail: 'Please enter your email',
    errorReport: 'Submission failed. Please try again shortly.',
    notConfigured: 'PayPal payment is being configured. Please contact us via KakaoTalk @cocotripkr.',
  },
  ja: {
    title: 'PayPal QR 決済',
    step1Title: 'ステップ1 — QRスキャンで決済',
    step1Desc: '韓国のWi-FiがPayPalをブロックする場合、スマホのモバイルデータで迂回します。',
    scanHint: 'スマホカメラでスキャン → PayPalアプリが自動で開きます',
    amountLabel: 'お支払い金額',
    refLabel: 'PayPalメモに入力 (必須)',
    refHint: '※ メモを入力しないと予約照合に時間がかかります',
    copy: 'コピー',
    copied: 'コピー済み',
    openLink: 'QRが動作しない場合は直接リンクを開く',
    step2Title: 'ステップ2 — 決済完了を報告',
    step2Desc: '決済後、メールアドレスを入力してご報告ください。担当者がPayPal入金を確認後、24時間以内 (通常1時間) に領収書とプランをメールでお送りします。',
    emailLabel: 'メールアドレス',
    emailPh: '予約確定通知用メール',
    phoneLabel: '電話番号 (任意)',
    phonePh: '+81 90-1234-5678',
    reportButton: '決済完了を報告',
    reporting: '送信中...',
    reportedTitle: '決済報告を受け付けました',
    reportedDesc: '担当者がPayPalの入金を確認後、領収書とプランをメールでお送りします。',
    reportedHint: '予約番号を保存してください',
    back: '戻る',
    errorEmail: 'メールアドレスを入力してください',
    errorReport: '送信に失敗しました。しばらくしてから再試行してください。',
    notConfigured: 'PayPal決済を設定中です。KakaoTalk @cocotripkrまでお問い合わせください。',
  },
  zh: {
    title: 'PayPal 二维码支付',
    step1Title: '步骤 1 — 扫描二维码支付',
    step1Desc: '若韩国 Wi-Fi 屏蔽 PayPal,手机的移动数据可绕过限制。',
    scanHint: '用手机相机扫码 → PayPal 应用自动打开',
    amountLabel: '支付金额',
    refLabel: 'PayPal 备注栏输入 (必填)',
    refHint: '※ 不输入备注可能延迟匹配您的预订',
    copy: '复制',
    copied: '已复制',
    openLink: '二维码无效?直接打开链接',
    step2Title: '步骤 2 — 报告付款完成',
    step2Desc: '付款后请输入邮箱。运营方核对 PayPal 收款后,在 24 小时内 (通常 1 小时) 邮件发送收据和行程。',
    emailLabel: '邮箱',
    emailPh: '接收预订确认的邮箱',
    phoneLabel: '联系电话 (可选)',
    phonePh: '+86 138-1234-5678',
    reportButton: '报告付款完成',
    reporting: '提交中...',
    reportedTitle: '付款报告已接收',
    reportedDesc: '运营方核对 PayPal 收款后,稍后将通过邮件发送收据和行程。',
    reportedHint: '请保存您的预订编号',
    back: '返回',
    errorEmail: '请输入邮箱地址',
    errorReport: '提交失败,请稍后再试。',
    notConfigured: 'PayPal 支付正在设置中。请通过 KakaoTalk @cocotripkr 联系我们。',
  },
};

function generateBookingRef(): string {
  // CT-YYYYMMDD-XXX (3자리 random)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dateStr = kst.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = Math.floor(Math.random() * 900) + 100;
  return `CT-${dateStr}-${seq}`;
}

export function PayPalQrPanel({
  productType, passengers, dateStart = '', dateEnd = '',
  priceKRW, pickupLocation = '', dropoffLocation = '', vehicleType = '', memo = '',
  itineraryData, airport,
  onPaymentReported, onBack,
  customerEmail = '', customerPhone = '',
}: Props) {
  const { language } = useLanguage();
  const lang = (['ko', 'en', 'ja', 'zh'].includes(language) ? language : 'en') as 'ko' | 'en' | 'ja' | 'zh';
  const L = LABELS[lang];
  const { user } = useAuth();

  const [bookingRef] = useState(generateBookingRef);
  const [email, setEmail] = useState(customerEmail || user?.email || '');
  const [phone, setPhone] = useState(customerPhone);
  const [submitting, setSubmitting] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [memoCopied, setMemoCopied] = useState(false);

  const username = (import.meta.env.VITE_PAYPAL_ME_USERNAME as string | undefined)?.trim() || '';
  const usdRate = Number((import.meta.env.VITE_USD_KRW_RATE as string | undefined) || '1380');

  // KRW → USD 환산 (정수, 소수 둘째 자리). PayPal.Me 는 USD 권장 — KRW 직접 미지원.
  const usdAmount = (priceKRW / usdRate).toFixed(2);
  const paypalUrl = username ? `https://paypal.me/${username}/${usdAmount}USD` : '';

  // QR 코드 생성
  useEffect(() => {
    if (!paypalUrl) return;
    let cancelled = false;
    QRCode.toDataURL(paypalUrl, {
      errorCorrectionLevel: 'M',
      width: 256,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setQrDataUrl(url);
    }).catch((e) => {
      console.error('[paypal-qr] QR generation failed:', e);
    });
    return () => { cancelled = true; };
  }, [paypalUrl]);

  async function copyMemo() {
    try {
      await navigator.clipboard.writeText(bookingRef);
      setMemoCopied(true);
      setTimeout(() => setMemoCopied(false), 1500);
    } catch { /* ignore */ }
  }

  async function handleReport() {
    setError(null);
    if (!email.trim() || !email.includes('@')) {
      setError(L.errorEmail);
      return;
    }
    setSubmitting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (user) {
        const idToken = await user.getIdToken();
        headers['Authorization'] = `Bearer ${idToken}`;
      }
      const res = await fetch('/api/manual-payment-request', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          bookingRef,
          productType, passengers, dateStart, dateEnd,
          priceKRW,
          priceUSD: usdAmount,
          customerEmail: email.trim(),
          customerPhone: phone.trim() || undefined,
          pickupLocation, dropoffLocation, vehicleType, memo,
          itineraryData: itineraryData || null,
          airport,
          paymentMethod: 'paypal-me-qr',
          paypalMeUrl: paypalUrl,
          language: lang,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'request failed');
      }
      setReported(true);
      if (onPaymentReported) await onPaymentReported(bookingRef);
    } catch (e) {
      console.error('[paypal-qr] report failed:', e);
      setError(L.errorReport);
    } finally {
      setSubmitting(false);
    }
  }

  if (!username) {
    return (
      <div className="bg-white/[0.04] border border-amber-500/30 rounded-xl p-5 text-center">
        <AlertCircle className="w-6 h-6 mx-auto mb-2 text-amber-300" />
        <p className="text-sm text-white/80">{L.notConfigured}</p>
      </div>
    );
  }

  if (reported) {
    return (
      <div className="rounded-xl p-5 text-center" style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.10), rgba(34,197,94,0.04))', border: '1px solid rgba(16,185,129,0.30)' }}>
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
          <Check className="w-7 h-7 text-emerald-300" />
        </div>
        <p className="text-base font-bold text-white">{L.reportedTitle}</p>
        <p className="text-[12px] text-white/65 mt-2 leading-relaxed">{L.reportedDesc}</p>
        <div className="mt-4 inline-block px-4 py-2 rounded-lg bg-white/[0.05] border border-white/[0.1]">
          <p className="text-[10px] text-white/45 uppercase tracking-wider">{L.reportedHint}</p>
          <p className="text-sm font-mono font-bold text-white">{bookingRef}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#0070BA]/15 border border-[#0070BA]/30 flex items-center justify-center shrink-0">
          <Smartphone className="w-5 h-5 text-[#3CB6FF]" />
        </div>
        <div>
          <p className="text-base font-bold text-white">{L.title}</p>
          <p className="text-[11px] text-white/55 mt-0.5">{L.step1Desc}</p>
        </div>
      </div>

      {/* Step 1: QR + 금액 + 메모 */}
      <div className="space-y-3">
        <p className="text-sm font-bold text-white">{L.step1Title}</p>

        {/* QR 코드 */}
        {qrDataUrl ? (
          <div className="flex flex-col items-center bg-white rounded-2xl p-4">
            <img src={qrDataUrl} alt="PayPal QR" className="w-56 h-56" />
            <p className="text-[11px] text-gray-600 mt-2 text-center">{L.scanHint}</p>
          </div>
        ) : (
          <div className="flex items-center justify-center bg-white/[0.04] border border-white/[0.08] rounded-2xl p-12">
            <Loader2 className="w-6 h-6 animate-spin text-white/55" />
          </div>
        )}

        {/* 금액 */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-3">
          <p className="text-[10px] text-white/45 uppercase tracking-wider">{L.amountLabel}</p>
          <p className="text-lg font-bold text-white">${usdAmount} USD <span className="text-[12px] text-white/55 font-normal">≈ ₩{priceKRW.toLocaleString('ko-KR')}</span></p>
        </div>

        {/* 메모 (booking ref) — 복사 가능 */}
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-[11px] text-amber-300/85 uppercase tracking-wider font-semibold">{L.refLabel}</p>
            <button
              type="button"
              onClick={copyMemo}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                memoCopied
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/15 text-amber-200 border border-amber-500/30 hover:bg-amber-500/25'
              }`}
            >
              {memoCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {memoCopied ? L.copied : L.copy}
            </button>
          </div>
          <p className="text-base font-mono font-bold text-amber-100">{bookingRef}</p>
          <p className="text-[10px] text-amber-300/70 mt-1.5 leading-snug">{L.refHint}</p>
        </div>

        {/* QR 안 되면 직접 링크 */}
        <a
          href={paypalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 text-[11px] text-[#3CB6FF] hover:text-[#79D0FF] py-1"
        >
          <ExternalLink className="w-3 h-3" />
          {L.openLink}
        </a>
      </div>

      {/* Step 2: 결제 완료 신고 */}
      <div className="space-y-2.5 border-t border-white/[0.06] pt-4">
        <div>
          <p className="text-sm font-bold text-white">{L.step2Title}</p>
          <p className="text-[12px] text-white/55 mt-0.5 leading-relaxed">{L.step2Desc}</p>
        </div>

        <label className="block">
          <span className="text-[11px] text-white/55 mb-1 flex items-center gap-1.5">
            <Mail className="w-3 h-3" /> {L.emailLabel}
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={L.emailPh}
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.1] text-white text-sm placeholder-white/30 outline-none focus:border-[#3CB6FF]/60"
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-white/55 mb-1 flex items-center gap-1.5">
            <Phone className="w-3 h-3" /> {L.phoneLabel}
          </span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={L.phonePh}
            className="w-full px-3 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.1] text-white text-sm placeholder-white/30 outline-none focus:border-[#3CB6FF]/60"
          />
        </label>

        {error && (
          <div className="text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              disabled={submitting}
              className="px-4 py-3 rounded-xl text-sm font-semibold text-white/70 border border-white/[0.15] hover:bg-white/[0.05] disabled:opacity-50"
            >
              {L.back}
            </button>
          )}
          <button
            type="button"
            onClick={handleReport}
            disabled={submitting}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #0070BA, #003087)' }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {L.reporting}
              </>
            ) : (
              L.reportButton
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
