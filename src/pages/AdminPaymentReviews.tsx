// /admin/payment-reviews — capture 무결성 격리(payment_reviews) 운영자 큐.
//
// 왜 이 페이지가 생겼나 (미사용 감사 2026-07-25):
//   api/admin-payment-reviews.js 는 완성돼 있었지만 **호출하는 UI 가 0개**였다.
//   → 격리된 주문(돈은 빠져나갔는데 예약 미확정)을 푸는 유일한 방법이 Firebase 콘솔 수동 편집.
//
// 이 화면이 하는 일 = **기록**뿐. 환불도 예약 생성도 실행하지 않는다. 화면이 그 한계를
// 그대로 고지한다 — "확정" 을 눌렀는데 예약이 안 생기는 것을 버그로 오해하면 안 되므로.
//
// 신규 코드 규약: nullish coalescing 금지, OR 사용 (pre-commit 이 차단).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { Header } from '@/sections/Header';
import { authFetch } from '@/lib/authFetch';

interface PaymentReviewItem {
  orderID: string;
  flow: string | null;
  mismatchCode: string | null;
  mismatchDetail: string | null;
  expectedAmountMinor: number | null;
  expectedCurrency: string | null;
  actualAmountMinor: number | null;
  actualCurrency: string | null;
  paymentCaptured: boolean;
  captureID: string | null;
  captureStatus: string | null;
  userEmail: string | null;
  createdAtMs: number;
}

// 서버 화이트리스트(PAYMENT_REVIEW_RESOLUTION)와 같은 3개. 서버가 재검증하므로 여기 값이
// 어긋나면 400 INVALID_RESOLUTION 으로 즉시 드러난다(조용히 틀리지 않는다).
type Resolution = 'MANUALLY_CONFIRMED' | 'REFUNDED' | 'REJECTED';

const ACTIONS: { resolution: Resolution; label: string; hint: string; bg: string; fg: string }[] = [
  {
    resolution: 'MANUALLY_CONFIRMED',
    label: '✓ 정상 확정',
    hint: 'PayPal 에서 결제가 정상임을 확인했다. AI 플랜 발급이 풀린다.',
    bg: 'rgba(16,185,129,0.18)',
    fg: '#6EE7B7',
  },
  {
    resolution: 'REFUNDED',
    label: '💸 환불 기록',
    hint: 'PayPal 대시보드에서 직접 환불을 끝낸 뒤 그 사실을 기록한다. 이 버튼은 환불을 실행하지 않는다.',
    bg: 'rgba(251,191,36,0.15)',
    fg: '#FCD34D',
  },
  {
    resolution: 'REJECTED',
    label: '✕ 반려',
    hint: '이행하지 않기로 결정. 유료 콘텐츠는 계속 잠긴다.',
    bg: 'rgba(248,113,113,0.15)',
    fg: '#FCA5A5',
  },
];

const cardStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' };

/**
 * minor unit(센트 등) 정수를 통화 문자열로. 소수 자릿수는 Intl 이 통화별로 알려주므로
 * KRW/JPY(0자리)와 USD(2자리)를 따로 분기하지 않아도 맞다.
 */
function formatMinor(minor: number | null, currency: string | null): string {
  if (minor === null || minor === undefined || !currency) return '—';
  try {
    const fmt = new Intl.NumberFormat('ko-KR', { style: 'currency', currency });
    const digits = fmt.resolvedOptions().maximumFractionDigits || 0;
    return fmt.format(minor / Math.pow(10, digits));
  } catch {
    // 알 수 없는 통화 코드 — 값을 숨기지 말고 raw 로 보여준다(돈은 조용히 사라지면 안 됨).
    return `${minor} ${currency} (minor)`;
  }
}

function formatWhen(ms: number): string {
  if (!ms) return '시각 미상';
  return new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

export default function AdminPaymentReviews() {
  const { language, t, changeLanguage } = useLanguage();
  const [items, setItems] = useState<PaymentReviewItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/admin-payment-reviews');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `불러오기 실패 (${res.status})`);
      setItems(json.items || []);
      setTruncated(json.truncated === true);
    } catch (e) {
      // ⚠️ 실패했을 때 items 를 [] 로 두면 "격리된 결제 없음 ✅" 로 위장된다. null 로 되돌려
      //   빈 상태와 실패 상태가 절대 같은 화면이 되지 않게 한다.
      setItems(null);
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, []);

  // 마운트 1회 로드. 이펙트 본문에서 동기 setState 하면 cascading render 로 lint 가 막으므로
  // 마이크로태스크로 한 틱 미룬다. 언마운트 시 취소해 사라진 화면에 setState 하지 않는다.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => { if (!cancelled) reload(); });
    return () => { cancelled = true; };
  }, [reload]);

  const resolve = useCallback(async (orderID: string, resolution: Resolution) => {
    const action = ACTIONS.find((a) => a.resolution === resolution);
    // 돈 상태를 바꾸는 기록 — 되돌릴 수 없다(서버는 이미 해결된 건을 no-op 으로 막는다).
    const ok = window.confirm(
      `주문 ${orderID}\n\n${action ? action.label : resolution} 으로 기록합니다.\n${action ? action.hint : ''}\n\n계속할까요?`,
    );
    if (!ok) return;
    setBusy(orderID);
    setError(null);
    try {
      const note = (notes[orderID] || '').trim();
      const res = await authFetch('/api/admin-payment-reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderID, resolution, auditNote: note || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `처리 실패 (${res.status})`);
      if (json.alreadyResolved) {
        setError(`주문 ${orderID} 은 이미 해결된 건이었습니다 — 이번 기록은 반영되지 않았습니다.`);
      }
      setItems((prev) => (prev || []).filter((it) => it.orderID !== orderID));
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setBusy(null);
    }
  }, [notes]);

  return (
    <div className="min-h-screen" style={{ background: '#0a0b14' }}>
      <Header language={language} t={t} onLanguageChange={changeLanguage} />
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <Link to="/admin" className="inline-flex items-center gap-1.5 text-white/60 hover:text-white text-sm">
            <ArrowLeft size={16} /> 어드민
          </Link>
          <button onClick={reload} disabled={loading} className="px-3 py-1.5 rounded-lg text-sm text-white/80" style={cardStyle}>
            {loading ? '갱신 중...' : '↻ 갱신'}
          </button>
        </div>

        <h1 className="text-[22px] font-black text-white mb-1">💰 결제 격리 큐</h1>
        <p className="text-[12px] text-white/40 mb-4">
          capture 금액·통화가 안 맞아 <b>예약이 확정되지 않은</b> 주문. 돈은 이미 빠져나갔을 수 있음.
        </p>

        {/* 이 화면의 한계를 숨기지 않는다 — "확정했는데 예약이 없다" 를 버그로 오해하면
            운영자가 손님을 방치하게 된다. */}
        <div
          className="rounded-2xl p-4 mb-5 text-[12px] leading-relaxed"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.28)' }}
        >
          <p className="flex items-center gap-1.5 font-bold mb-1.5" style={{ color: '#FCD34D' }}>
            <AlertTriangle size={14} /> 이 화면은 <u>기록만</u> 합니다
          </p>
          <ul className="list-disc pl-4 space-y-1 text-white/70">
            <li><b>정상 확정</b> → 풀리는 건 <b>AI 플랜 발급뿐</b>입니다. 투어·차터 <b>예약 문서는 자동 생성되지 않습니다</b> — 어드민 예약 화면에서 직접 만들어 주세요.</li>
            <li><b>환불 기록</b> → 환불을 <b>실행하지 않습니다</b>. PayPal 대시보드에서 먼저 환불한 뒤 여기에 기록하세요.</li>
            <li>어드민 예약의 <code>환불 처리</code> 버튼은 <code>pending_bookings</code> 전용이라 이 격리 건에는 404 가 납니다.</li>
          </ul>
        </div>

        {error && (
          <div
            className="rounded-xl p-3 mb-4 text-sm"
            style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)', color: '#FCA5A5' }}
          >
            {error}
          </div>
        )}

        {items === null && !error && <p className="text-white/40 py-12 text-center">불러오는 중...</p>}
        {items === null && error && (
          <p className="text-white/40 py-8 text-center text-sm">목록을 불러오지 못했습니다. 갱신을 눌러 다시 시도하세요.</p>
        )}
        {items !== null && items.length === 0 && <p className="text-white/40 py-12 text-center">격리된 결제 없음 ✅</p>}
        {truncated && (
          <p className="text-[12px] mb-3" style={{ color: '#FCD34D' }}>
            ⚠️ 50건까지만 표시됩니다. 처리 후 갱신하면 나머지가 나타납니다.
          </p>
        )}

        <div className="space-y-3">
          {(items || []).map((it) => {
            const mismatched = it.expectedAmountMinor !== it.actualAmountMinor || it.expectedCurrency !== it.actualCurrency;
            return (
              <div key={it.orderID} className="rounded-2xl p-4" style={cardStyle}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div>
                    <p className="text-[15px] font-bold text-white font-mono">{it.orderID}</p>
                    <p className="text-[11px] text-white/40">
                      {it.flow === 'cart' ? '🛒 장바구니' : '🧾 단건'} · {formatWhen(it.createdAtMs)}
                    </p>
                  </div>
                  {it.paymentCaptured && (
                    <span
                      className="shrink-0 px-2 py-0.5 rounded-md text-[11px] font-bold"
                      style={{ background: 'rgba(248,113,113,0.15)', color: '#FCA5A5' }}
                    >
                      💳 돈 빠져나감
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[12px] mb-2">
                  <div className="rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <p className="text-white/40">청구했어야 할 금액</p>
                    <p className="text-white font-semibold">{formatMinor(it.expectedAmountMinor, it.expectedCurrency)}</p>
                  </div>
                  <div
                    className="rounded-lg px-3 py-2"
                    style={{ background: mismatched ? 'rgba(248,113,113,0.10)' : 'rgba(255,255,255,0.03)' }}
                  >
                    <p className="text-white/40">실제 결제된 금액</p>
                    <p className="font-semibold" style={{ color: mismatched ? '#FCA5A5' : '#ffffff' }}>
                      {formatMinor(it.actualAmountMinor, it.actualCurrency)}
                    </p>
                  </div>
                </div>

                <p className="text-[12px] text-white/60">
                  <b className="text-white/80">사유</b> {it.mismatchCode || '—'}
                  {it.mismatchDetail ? ` · ${it.mismatchDetail}` : ''}
                </p>
                <p className="text-[11px] text-white/40 mt-1">
                  손님 {it.userEmail || '(미상)'} · capture {it.captureID || '—'} ({it.captureStatus || '—'})
                </p>

                <textarea
                  value={notes[it.orderID] || ''}
                  onChange={(e) => setNotes((p) => ({ ...p, [it.orderID]: e.target.value }))}
                  placeholder="처리 메모 (선택) — 왜 이렇게 판단했는지. 최대 500자"
                  rows={2}
                  maxLength={500}
                  className="w-full mt-3 rounded-lg px-3 py-2 text-[12px] text-white/90 bg-transparent resize-y"
                  style={{ border: '1px solid rgba(255,255,255,0.12)' }}
                />

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {ACTIONS.map((a) => (
                    <button
                      key={a.resolution}
                      onClick={() => resolve(it.orderID, a.resolution)}
                      disabled={busy === it.orderID}
                      title={a.hint}
                      className="px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                      style={{ background: a.bg, color: a.fg }}
                    >
                      {busy === it.orderID ? '…' : a.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
