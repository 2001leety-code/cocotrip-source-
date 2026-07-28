/**
 * /admin/all-bookings — 통합 예약 뷰 (무드 + 코코트립 한 곳에)
 *
 * 운영자 요청: "총 토탈 예약사항이 '무드 - OOO 예약', '코코트립 - OOO 예약' 이렇게
 * 한눈에 떠야 함." → 두 사업의 예약을 한 리스트로.
 *
 * 데이터: GET /api/admin-all-bookings (admin SDK 가 pending_bookings + mood_bookings
 * 둘 다 읽어 출처 라벨 붙여 합침). mood_bookings 는 firestore.rules client read:false
 * 라 반드시 백엔드 엔드포인트 경유.
 *
 * 2026-07-28: "배차실패 취소" 버튼 추가 — 차량·기사를 못 구했을 때 운영자가 사유를 남기고
 * 전액 환불로 취소한다(POST /api/admin-booking-action, action=dispatch-cancel).
 * 그 외에는 여전히 읽기 전용.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Calendar, Loader2 } from 'lucide-react';

type Source = 'cocotrip' | 'mood';
type SourceFilter = Source | 'all';

interface BookingItem {
  source: Source;
  id: string;
  bookingRef: string;
  label: string;
  date: string;
  amountKRW: number;
  priceUSD: string | null;
  status: string;
  detail: string;
  createdAtMs: number;
  isTest: boolean;
}

interface ApiResponse {
  ok: boolean;
  data?: {
    items: BookingItem[];
    total: number;
    counts: { cocotrip: number; mood: number };
    partialErrors?: Record<string, string>;
  };
  error?: string;
}

// 출처별 라벨 + 색 (DESIGN.md: 코코트립=보라 #7C5CFC, 무드=핑크 그라데이션 계열).
const SOURCE_META: Record<Source, { label: string; badgeClass: string }> = {
  cocotrip: { label: '코코트립', badgeClass: 'bg-[#7C5CFC]/18 text-[#B9A4FF] border-[#7C5CFC]/40' },
  mood: { label: '무드', badgeClass: 'bg-pink-500/15 text-pink-300 border-pink-500/40' },
};

// 상태 한글 뱃지 (코코트립 pending_bookings + 무드 confirmed 공통).
function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    AWAITING_VERIFICATION: { label: '입금 대기', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
    CONFIRMED: { label: '결제완료', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
    confirmed: { label: '확정', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
    REFUNDED: { label: '환불완료', className: 'bg-rose-500/15 text-rose-300 border-rose-500/40' },
    CANCELED: { label: '취소', className: 'bg-white/[0.05] text-white/55 border-white/[0.15]' },
  };
  if (!status) return null;
  const s = map[status] || { label: status, className: 'bg-white/[0.05] text-white/55 border-white/[0.15]' };
  return <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold border ${s.className}`}>{s.label}</span>;
}

function formatKRW(n: number): string {
  return `₩${(Number(n) || 0).toLocaleString('ko-KR')}`;
}

/** 배차 실패 취소 사유 분류 — 값은 백엔드 DISPATCH_CANCEL_CATEGORIES 와 1:1. */
type CancelCategory = 'no_vehicle' | 'no_driver' | 'other';
const CANCEL_CATEGORY_OPTIONS: { key: CancelCategory; label: string }[] = [
  { key: 'no_vehicle', label: '차량 미확보' },
  { key: 'no_driver', label: '기사 미확보' },
  { key: 'other', label: '기타' },
];

export default function AdminAllBookings() {
  const { user } = useAuth();
  const [items, setItems] = useState<BookingItem[] | null>(null);
  const [counts, setCounts] = useState<{ cocotrip: number; mood: number }>({ cocotrip: 0, mood: 0 });
  const [partialErrors, setPartialErrors] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SourceFilter>('all');
  const [hideTest, setHideTest] = useState(true);
  // 배차 실패 취소 대상 (모달) — 읽기 전용이던 화면에 유일하게 추가된 쓰기 동작.
  const [cancelTarget, setCancelTarget] = useState<BookingItem | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin-all-bookings?limit=200', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json: ApiResponse = await res.json();
      if (!res.ok || !json.ok || !json.data) throw new Error(json.error || '불러오기 실패');
      setItems(json.data.items);
      setCounts(json.data.counts);
      setPartialErrors(json.data.partialErrors || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void reload(); }, [reload]);

  const filtered = useMemo(() => {
    let r = items || [];
    if (hideTest) r = r.filter((b) => !b.isTest);
    if (filter !== 'all') r = r.filter((b) => b.source === filter);
    return r;
  }, [items, filter, hideTest]);

  const testCount = useMemo(() => (items || []).filter((b) => b.isTest).length, [items]);

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: '#080b14' }}>
      {/* Header */}
      <div className="border-b border-white/[0.06] bg-[#0c1220]/95 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-3 sm:px-5 py-3 sm:py-4 flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <Link to="/admin" className="flex items-center gap-2 text-white/60 hover:text-white text-sm min-h-[44px]">
            <ArrowLeft className="w-4 h-4" />
            관리자 홈
          </Link>
          <div className="flex items-center gap-2 order-3 sm:order-2 w-full sm:w-auto justify-center">
            <Calendar className="w-5 h-5 text-[#B9A4FF]" />
            <h1 className="text-sm sm:text-base font-bold text-white">통합 예약 (무드 + 코코트립)</h1>
          </div>
          <button
            onClick={reload}
            disabled={loading}
            className="text-[11px] text-white/45 hover:text-white inline-flex items-center gap-1.5 order-2 sm:order-3 min-h-[36px]"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            갱신
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-5">
        {/* 출처별 합계 */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-xl px-3 py-2.5 text-center">
            <p className="text-[10px] text-white/45 uppercase tracking-wider mb-0.5">전체</p>
            <p className="text-lg font-extrabold text-white">{(items || []).length}</p>
          </div>
          <div className="bg-[#7C5CFC]/[0.08] border border-[#7C5CFC]/25 rounded-xl px-3 py-2.5 text-center">
            <p className="text-[10px] text-[#B9A4FF]/70 uppercase tracking-wider mb-0.5">코코트립</p>
            <p className="text-lg font-extrabold text-[#B9A4FF]">{counts.cocotrip}</p>
          </div>
          <div className="bg-pink-500/[0.08] border border-pink-500/25 rounded-xl px-3 py-2.5 text-center">
            <p className="text-[10px] text-pink-300/70 uppercase tracking-wider mb-0.5">무드</p>
            <p className="text-lg font-extrabold text-pink-300">{counts.mood}</p>
          </div>
        </div>

        {/* 필터 + 테스트 토글 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {([
              { key: 'all', label: '전체' },
              { key: 'cocotrip', label: '코코트립' },
              { key: 'mood', label: '무드' },
            ] as { key: SourceFilter; label: string }[]).map(({ key, label }) => {
              const sel = filter === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3.5 py-2 rounded-xl text-[12px] font-semibold border transition-all min-h-[40px] ${
                    sel
                      ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white'
                      : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {testCount > 0 && (
            <button
              onClick={() => setHideTest((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all min-h-[36px] ${
                hideTest
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
              }`}
            >
              {hideTest ? `✓ 실결제만 (테스트 ${testCount} 숨김)` : '테스트 숨기기'}
            </button>
          )}
        </div>

        {/* 부분 오류 안내 (한쪽 컬렉션 읽기 실패해도 다른 쪽 표시) */}
        {partialErrors && (
          <div className="bg-amber-500/[0.08] border border-amber-500/25 rounded-xl px-3 py-2.5 text-[12px] text-amber-100/80">
            ⚠ 일부 데이터를 불러오지 못했습니다: {Object.keys(partialErrors).join(', ')}
          </div>
        )}

        {/* 리스트 */}
        {error ? (
          <div className="text-center py-12">
            <p className="text-rose-300/80 text-sm">{error}</p>
          </div>
        ) : loading && !items ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-white/55" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/45 text-sm">표시할 예약이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((b) => {
              const meta = SOURCE_META[b.source];
              return (
                <article
                  key={`${b.source}:${b.id}`}
                  className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4"
                >
                  {/* 출처 뱃지 + 라벨 */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className={`shrink-0 inline-block px-2 py-1 rounded-md text-[11px] font-bold border ${meta.badgeClass}`}>
                      {meta.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-white font-semibold text-sm truncate">
                        {b.label}
                        {b.isTest && <span className="ml-1.5 text-[10px] font-bold text-amber-300">🧪</span>}
                      </p>
                      {b.detail && <p className="text-[11px] text-white/45 truncate">{b.detail}</p>}
                    </div>
                  </div>

                  {/* 날짜 + 금액 + 상태 */}
                  <div className="flex items-center gap-3 sm:gap-4 shrink-0 flex-wrap">
                    {b.date && (
                      <span className="text-[12px] text-white/55 flex items-center gap-1">
                        <Calendar className="w-3 h-3" /> {b.date}
                      </span>
                    )}
                    <span className="text-sm font-bold text-white">
                      {formatKRW(b.amountKRW)}
                      {b.priceUSD && <span className="text-[10px] text-white/40 ml-1">${b.priceUSD}</span>}
                    </span>
                    {statusBadge(b.status)}
                    {/* 배차 실패 취소 — 코코트립 결제완료 건에만. 무드는 별도 정산 체계라 제외. */}
                    {b.source === 'cocotrip' && b.status === 'CONFIRMED' && (
                      <button
                        onClick={() => setCancelTarget(b)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors min-h-[36px]"
                      >
                        배차실패 취소
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {cancelTarget && (
        <DispatchCancelModal
          booking={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); void reload(); }}
          getIdToken={() => user!.getIdToken()}
        />
      )}
    </div>
  );
}

/**
 * 배차 실패 취소 모달 (2026-07-28).
 * 우리 귀책 취소라 **항상 전액 환불**이고 사유가 필수다 — 입력한 문장이 그대로
 * 고객 이메일에 실린다. 그래서 확인 단계에서 환불액과 문구를 다시 보여준다.
 */
function DispatchCancelModal({
  booking, onClose, onDone, getIdToken,
}: {
  booking: BookingItem;
  onClose: () => void;
  onDone: () => void;
  getIdToken: () => Promise<string>;
}) {
  const [category, setCategory] = useState<CancelCategory>('no_vehicle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!reason.trim()) { setErr('사유를 입력해주세요 (고객에게 그대로 전달됩니다)'); return; }
    setBusy(true);
    setErr(null);
    try {
      const idToken = await getIdToken();
      const res = await fetch('/api/admin-booking-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          bookingRef: booking.bookingRef,
          action: 'dispatch-cancel',
          cancelCategory: category,
          reason: reason.trim(),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || `취소 실패 (HTTP ${res.status})`);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="w-full max-w-md rounded-2xl border border-white/[0.10] p-4 sm:p-5 space-y-3.5" style={{ background: '#0c1220' }}>
        <div>
          <h2 className="text-white font-bold text-[15px]">배차 실패 취소</h2>
          <p className="text-[11px] text-white/45 mt-1">
            {booking.label} · {booking.bookingRef} · {formatKRW(booking.amountKRW)}
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-200">
          우리 쪽 사정으로 인한 취소이므로 <b>취소정책과 무관하게 전액 환불</b>됩니다.
          입력한 사유는 <b>고객 이메일에 그대로</b> 실립니다.
        </div>

        <div>
          <label className="block text-[11px] text-white/50 mb-1.5">사유 분류</label>
          <div className="grid grid-cols-3 gap-2">
            {CANCEL_CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setCategory(opt.key)}
                className={`px-2 py-2 rounded-xl text-[12px] font-semibold border transition-all min-h-[40px] ${
                  category === opt.key
                    ? 'bg-[#7C5CFC]/20 border-[#7C5CFC]/50 text-white'
                    : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:border-white/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] text-white/50 mb-1.5">고객에게 전달할 사유 (필수)</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="예: 당일 폭설로 배정 예정이던 차량이 운행 불가해졌습니다. 불편을 드려 죄송합니다."
            className="w-full rounded-xl bg-white/[0.04] border border-white/[0.10] px-3 py-2.5 text-[13px] text-white placeholder:text-white/25 outline-none focus:border-[#7C5CFC]/50"
          />
        </div>

        {err && <p className="text-[12px] text-rose-300">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-semibold border border-white/[0.10] text-white/60 hover:text-white min-h-[44px] disabled:opacity-50"
          >
            닫기
          </button>
          <button
            onClick={() => { void submit(); }}
            disabled={busy || !reason.trim()}
            className="flex-1 px-3 py-2.5 rounded-xl text-[13px] font-bold border border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 min-h-[44px] disabled:opacity-40"
          >
            {busy ? '처리 중…' : '취소 + 전액 환불'}
          </button>
        </div>
      </div>
    </div>
  );
}
