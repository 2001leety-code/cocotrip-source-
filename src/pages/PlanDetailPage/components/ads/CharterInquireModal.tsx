// P3-B in-app charter inquiry modal — alternative to the WhatsApp prefill.
// The server verifies plan access and recalculates the reference quote from
// the pricing SSOT before writing `charter_inquiries`.
//
// Out of scope here (deferred):
//   - MyPlans status widget
//   - Admin approval UI
//   - PayPal integration on approval
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Send, Loader2, AlertCircle, Check } from 'lucide-react';
import { authFetch } from '@/lib/authFetch';
import { useLanguage } from '@/hooks/useLanguage';
import type { PlanDay, PlanDocument } from '../../types';

// 2026-07-17: 전체 영어 하드코딩이던 모달 4언어화 (컴포넌트 로컬 사전 — 레포 관례).
const INQUIRE_STR = {
  en: {
    title: 'Charter Quote Request',
    received: 'Request received', receivedDesc: "We'll email you a confirmed quote within 24 hours.", close: 'Close',
    email: 'Email *', name: 'Name', phone: 'Phone / WhatsApp',
    notes: 'Notes (pickup point, special requests)', notesPh: 'e.g. pickup from Lotte Hotel at 8:30, baby seat needed',
    context: (dayCount: number, startDate: string, pax: string) => `Your trip context (planId · ${dayCount} day${dayCount === 1 ? '' : 's'} · start ${startDate} · ${pax} pax) will be sent automatically so we can quote without back-and-forth.`,
    estimate: 'Server-calculated reference estimate', quoteChanged: (amount: number, hours: number) => `The reference estimate changed to ₩${amount.toLocaleString()} / ${hours}h. Please review it and submit again.`,
    duration: (hours: number) => `${hours} hrs`,
    invalidEmail: 'Please enter a valid email.', submitFail: 'Submission failed',
    sending: 'Sending…', submit: 'Submit request',
  },
  ko: {
    title: '차터 견적 요청',
    received: '요청이 접수됐어요', receivedDesc: '24시간 안에 확정 견적을 이메일로 보내드립니다.', close: '닫기',
    email: '이메일 *', name: '이름', phone: '전화 / WhatsApp',
    notes: '요청사항 (픽업 장소, 특이사항)', notesPh: '예: 롯데호텔 8:30 픽업, 유아 카시트 필요',
    context: (dayCount: number, startDate: string, pax: string) => `여행 정보(플랜 ID · ${dayCount}일 · 시작 ${startDate} · ${pax}명)가 자동으로 함께 전송되어 추가 문답 없이 견적을 드릴 수 있어요.`,
    estimate: '서버 계산 참고 예상가', quoteChanged: (amount: number, hours: number) => `참고 예상가가 ₩${amount.toLocaleString()} / ${hours}시간으로 바뀌었습니다. 확인한 뒤 다시 제출해 주세요.`,
    duration: (hours: number) => `${hours}시간`,
    invalidEmail: '올바른 이메일을 입력해 주세요.', submitFail: '제출에 실패했어요',
    sending: '전송 중…', submit: '견적 요청하기',
  },
  ja: {
    title: 'チャーター見積もりリクエスト',
    received: 'リクエストを受け付けました', receivedDesc: '24時間以内に確定見積もりをメールでお送りします。', close: '閉じる',
    email: 'メール *', name: 'お名前', phone: '電話 / WhatsApp',
    notes: 'ご要望（ピックアップ場所・特記事項）', notesPh: '例: ロッテホテル8:30ピックアップ、チャイルドシート必要',
    context: (dayCount: number, startDate: string, pax: string) => `旅行情報（プランID · ${dayCount}日 · 開始 ${startDate} · ${pax}名）が自動送信されるため、やり取りなしで見積もりが可能です。`,
    estimate: 'サーバー計算の参考価格', quoteChanged: (amount: number, hours: number) => `参考価格が₩${amount.toLocaleString()} / ${hours}時間に変わりました。確認してもう一度送信してください。`,
    duration: (hours: number) => `${hours}時間`,
    invalidEmail: '有効なメールアドレスを入力してください。', submitFail: '送信に失敗しました',
    sending: '送信中…', submit: '見積もりを依頼',
  },
  zh: {
    title: '包车报价申请',
    received: '已收到申请', receivedDesc: '我们将在24小时内通过邮件发送确认报价。', close: '关闭',
    email: '邮箱 *', name: '姓名', phone: '电话 / WhatsApp',
    notes: '备注（上车地点、特殊要求）', notesPh: '例: 乐天酒店8:30接、需要婴儿座椅',
    context: (dayCount: number, startDate: string, pax: string) => `您的行程信息（planId · ${dayCount}天 · 出发 ${startDate} · ${pax}人）会自动一并发送，无需反复沟通即可报价。`,
    estimate: '服务器计算的参考价', quoteChanged: (amount: number, hours: number) => `参考价已变更为₩${amount.toLocaleString()} / ${hours}小时。请确认后再次提交。`,
    duration: (hours: number) => `${hours}小时`,
    invalidEmail: '请输入有效的邮箱。', submitFail: '提交失败',
    sending: '发送中…', submit: '提交申请',
  },
};

interface Props {
  open: boolean;
  onClose: () => void;
  plan: PlanDocument | undefined;
  days: PlanDay[];
  recommendedTour: string;
  quotedKRW: number;
  hours: number;
  tourKey: string;
  planId: string;
}

interface QuoteView {
  tourKey: string;
  recommendedTour: string;
  amountKRW: number;
  hours: number;
}

export function CharterInquireModal({ open, onClose, plan, days, recommendedTour, quotedKRW, hours, tourKey, planId }: Props) {
  const { language } = useLanguage();
  const M = INQUIRE_STR[language as keyof typeof INQUIRE_STR] || INQUIRE_STR.en;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [quoteView, setQuoteView] = useState<QuoteView>({
    tourKey,
    recommendedTour,
    amountKRW: quotedKRW,
    hours,
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const successCloseRef = useRef<HTMLButtonElement>(null);

  // PlanDetail 캐러셀은 transform 조상을 가진다. 모달은 아래 createPortal로 body에
  // 렌더하고, 키보드 사용자가 배경 결제 카드로 빠져나가지 않도록 초점을 가둔다.
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    emailInputRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (submitted) successCloseRef.current?.focus();
  }, [submitted]);

  if (!open || typeof document === 'undefined') return null;

  const input = plan?.input || {};
  const dayCount = days.length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { setError(M.invalidEmail); return; }
    setSubmitting(true);
    setError(null);
    try {
      const queryToken = typeof window === 'undefined'
        ? ''
        : new URLSearchParams(window.location.search).get('token') || '';
      const response = await authFetch('/api/inquiry-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          name: name.trim(),
          phone: phone.trim(),
          details: notes.trim(),
          planId,
          accessToken: plan?.accessToken || queryToken,
          expectedTourKey: quoteView.tourKey,
          expectedAmountKRW: quoteView.amountKRW,
          expectedHours: quoteView.hours,
          vehicle: 'charter',
          language,
          source: 'plan_detail_charter_inquiry',
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload?.code === 'QUOTE_CHANGED' && payload?.quote) {
        const nextQuote: QuoteView = {
          tourKey: String(payload.quote.tourKey || quoteView.tourKey),
          recommendedTour: String(payload.quote.recommendedTour || quoteView.recommendedTour),
          amountKRW: Number(payload.quote.amountKRW || quoteView.amountKRW),
          hours: Number(payload.quote.hours || quoteView.hours),
        };
        setQuoteView(nextQuote);
        setError(M.quoteChanged(nextQuote.amountKRW, nextQuote.hours));
        return;
      }
      if (!response.ok || !payload?.success) {
        console.warn('[charter-inquiry] rejected:', response.status, payload?.code || 'UNKNOWN');
        throw new Error(M.submitFail);
      }
      setSubmitted(true);
    } catch (err) {
      console.error('[charter-inquiry] submit failed:', err);
      setError(M.submitFail);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal((
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-3" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="charter-inquiry-title"
        className="bg-[#0f1117] border border-cyan-500/25 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] sticky top-0 bg-[#0f1117] z-10">
          <div>
            <p id="charter-inquiry-title" className="text-white font-bold">{M.title}</p>
            <p className="text-[13px] text-white/55 mt-0.5">{quoteView.recommendedTour} · ₩{quoteView.amountKRW.toLocaleString()} / {M.duration(quoteView.hours)}</p>
            <p className="text-[11px] text-cyan-300/70 mt-0.5">{M.estimate}</p>
          </div>
          <button type="button" aria-label={M.close} onClick={onClose} className="text-white/55 hover:text-white/80 min-h-[44px] min-w-[44px] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"><X className="w-5 h-5" /></button>
        </div>

        {submitted ? (
          <div role="status" aria-live="polite" className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-3">
              <Check className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-white font-bold mb-2">{M.received}</p>
            <p className="text-white/60 text-sm">{M.receivedDesc}</p>
            <button ref={successCloseRef} type="button" onClick={onClose} className="mt-5 px-6 py-2.5 rounded-xl bg-white/10 text-white text-sm hover:bg-white/15 min-h-[44px]">{M.close}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-3">
            <div>
              <label htmlFor="charter-inquiry-email" className="block text-[13px] uppercase tracking-wider text-white/55 mb-1">{M.email}</label>
              <input
                ref={emailInputRef} id="charter-inquiry-email" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-300/70"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="charter-inquiry-name" className="block text-[13px] uppercase tracking-wider text-white/55 mb-1">{M.name}</label>
                <input
                  id="charter-inquiry-name" type="text" autoComplete="name" value={name} onChange={e => setName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                />
              </div>
              <div>
                <label htmlFor="charter-inquiry-phone" className="block text-[13px] uppercase tracking-wider text-white/55 mb-1">{M.phone}</label>
                <input
                  id="charter-inquiry-phone" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                />
              </div>
            </div>
            <div>
              <label htmlFor="charter-inquiry-notes" className="block text-[13px] uppercase tracking-wider text-white/55 mb-1">{M.notes}</label>
              <textarea
                id="charter-inquiry-notes" rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder={M.notesPh}
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-cyan-400 focus-visible:ring-2 focus-visible:ring-cyan-300/70 resize-none"
              />
            </div>
            <div className="text-[13px] text-white/55 bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
              {M.context(dayCount, String(input.startDate || '—'), String(input.adults || input.pax || '?'))}
            </div>
            {error && (
              <div role="alert" aria-live="assertive" className="flex items-start gap-2 text-rose-300 text-xs bg-rose-500/10 border border-rose-500/30 rounded-lg p-3">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit" disabled={submitting}
              className="w-full min-h-[44px] py-3 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              style={{ background: 'linear-gradient(135deg,#06b6d4,#3b82f6)' }}
            >
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {M.sending}</> : <><Send className="w-4 h-4" /> {M.submit}</>}
            </button>
          </form>
        )}
      </div>
    </div>
  ), document.body);
}
