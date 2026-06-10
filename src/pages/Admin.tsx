import { useMemo, useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp, query, orderBy, onSnapshot } from 'firebase/firestore';
import { toast, Toaster } from 'sonner';
import { RefreshCw, Plus, List, ChevronDown, ChevronUp, Bell, Users, TrendingUp } from 'lucide-react';

interface Booking {
  id: string;
  [key: string]: unknown;
}

export default function Admin() {
  const { user, loading, error } = useAuth();
  const { t } = useLanguage();
  const ta = t.admin;

  // ── Tour creation form ──
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [totalSeats, setTotalSeats] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Booking list (Firestore) ──
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingHeaders, setBookingHeaders] = useState<string[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [totalBookings, setTotalBookings] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [pushTesting, setPushTesting] = useState(false);

  // ── 방문자 통계 (PostHog, 본인 제외) ──
  interface VisitorBucket { uniqueVisitors: number; pageviews: number }
  interface VisitorData {
    today: VisitorBucket; week: VisitorBucket; month: VisitorBucket;
    topPages: { path: string; pageviews: number }[];
    excludedAdmin: string | null;
  }
  const [visitors, setVisitors] = useState<VisitorData | null>(null);
  const [visitorsLoading, setVisitorsLoading] = useState(false);
  const [visitorsError, setVisitorsError] = useState<string | null>(null);

  const loadVisitors = async () => {
    if (!user) return;
    setVisitorsLoading(true);
    setVisitorsError(null);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/admin-posthog-visitors', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await resp.json();
      if (!json.ok) {
        setVisitorsError(json.code === 'POSTHOG_DISABLED' ? 'PostHog 미연결' : (json.error || 'unknown'));
        return;
      }
      setVisitors(json.data);
    } catch (err) {
      setVisitorsError(err instanceof Error ? err.message : 'unknown');
    } finally {
      setVisitorsLoading(false);
    }
  };

  useEffect(() => {
    if (user) void loadVisitors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleTestPush = async () => {
    if (!user) return;
    setPushTesting(true);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/admin-test-push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'send failed');
      const r = data.data;
      toast.success(`Push 발송: ${r.sent}/${r.total} 성공${r.expired ? ` (${r.expired} 만료 정리됨)` : ''}`);
    } catch (err) {
      toast.error('Push 실패: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setPushTesting(false);
    }
  };

  const canSubmit = useMemo(() => {
    return (
      !loading &&
      !!user &&
      title.trim().length > 0 &&
      description.trim().length > 0 &&
      Number.isFinite(price) &&
      price >= 0 &&
      Number.isFinite(totalSeats) &&
      totalSeats > 0
    );
  }, [loading, user, title, description, price, totalSeats]);

  const fetchBookings = async () => {
    if (!user) return;
    setLoadingBookings(true);
    try {
      const idToken = await user.getIdToken();
      const resp = await fetch('/api/admin-bookings', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      const payload = data.data || data;
      const list: Booking[] = payload.bookings || data.bookings || [];
      setBookings(list);
      setTotalBookings(payload.total || data.total || list.length);
      // 헤더 자동 추출 (id 제외). airport 정보가 담긴 '메모/memo' 열을 항상 포함시킨다.
      if (list.length > 0) {
        const keys = Object.keys(list[0]).filter(k => k !== 'id');
        const memoKey = keys.find(k => /memo|메모/i.test(k));
        const sliced = keys.slice(0, 8);
        const withMemo = memoKey && !sliced.includes(memoKey) ? [...sliced, memoKey] : sliced;
        setBookingHeaders(withMemo);
      }
    } catch (err) {
      console.error('Failed to fetch bookings:', err);
      toast.error(ta.toasts.bookingsLoadFailed);
    } finally {
      setLoadingBookings(false);
    }
  };

  useEffect(() => {
    if (user && !loading) {
      fetchBookings();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  // ── 결제 KPI + 입금 확인 대기 (pending_bookings 실시간, AdminPayments 와 동일 컬렉션) ──
  interface PendingRow {
    id: string; bookingRef?: string; customerEmail?: string; priceUSD?: string | null;
    status?: string; paymentMethod?: string; paypalTransactionId?: string;
    createdAt?: { toMillis(): number }; confirmedAt?: { toMillis(): number }; refundedAt?: { toMillis(): number };
  }
  const [pending, setPending] = useState<PendingRow[]>([]);
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'pending_bookings'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => setPending(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) as PendingRow[]),
      (err) => console.error('[admin] pending_bookings listen error:', err),
    );
    return () => unsub();
  }, [user]);

  const kpi = useMemo(() => {
    const isTest = (b: PendingRow) =>
      b.paymentMethod === 'admin-bypass'
      || String(b.paypalTransactionId || '').startsWith('ADMIN-BYPASS-')
      || String(b.id || '').startsWith('ADMIN-BYPASS-');
    const ymd = (ms?: number) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const todayStr = ymd(Date.now());
    const monthStr = todayStr.slice(0, 7);
    const usd = (b: PendingRow) => parseFloat(String(b.priceUSD || 0)) || 0;
    const real = pending.filter((b) => !isTest(b));
    const awaiting = real.filter((b) => b.status === 'AWAITING_VERIFICATION');
    const paidToday = real.filter((b) => b.status === 'CONFIRMED' && ymd(b.confirmedAt?.toMillis()) === todayStr);
    const refundToday = real.filter((b) => b.status === 'REFUNDED' && ymd(b.refundedAt?.toMillis()) === todayStr);
    const monthRevenue = real.filter((b) => b.status === 'CONFIRMED' && ymd(b.confirmedAt?.toMillis()).slice(0, 7) === monthStr).reduce((s, b) => s + usd(b), 0);
    return {
      paidTodayCount: paidToday.length, paidTodayUSD: paidToday.reduce((s, b) => s + usd(b), 0),
      awaitingCount: awaiting.length, awaiting,
      refundTodayCount: refundToday.length, monthRevenueUSD: monthRevenue,
      testCount: pending.length - real.length,
    };
  }, [pending]);

  const handleCreateTour = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      toast.error(ta.toasts.loginFirst);
      return;
    }
    if (!title.trim() || !description.trim()) {
      toast.error(ta.toasts.emptyFields);
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error(ta.toasts.invalidPrice);
      return;
    }
    if (!Number.isFinite(totalSeats) || totalSeats <= 0) {
      toast.error(ta.toasts.invalidSeats);
      return;
    }

    try {
      setIsSubmitting(true);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        price: Number(price),
        totalSeats: Number(totalSeats),
        currentBookings: 0,
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'tours'), payload);
      toast.success(ta.toasts.tourCreated);

      setTitle('');
      setDescription('');
      setPrice(0);
      setTotalSeats(0);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : ta.toasts.tourCreateFailed;
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#faf9f6] text-[#0f3460]">
        {ta.loading}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f6] p-4 sm:p-6">
      <Toaster position="top-center" richColors />
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#1a1a2e]">{ta.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {ta.subtitle}
            </p>
          </div>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}

        {/* ── 오늘 한눈에 (결제 KPI) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-500">오늘 실결제</span><span className="text-lg">💳</span></div>
            <p className="text-2xl font-extrabold text-[#1a1a2e]">{kpi.paidTodayCount}건</p>
            <p className="text-xs text-gray-400 mt-1"><span className="text-emerald-600 font-bold">${kpi.paidTodayUSD.toLocaleString()}</span> 확인됨</p>
          </div>
          <a href="/admin/payments" className="block bg-gradient-to-b from-amber-50 to-white rounded-2xl border border-amber-200 shadow-sm p-4 hover:border-amber-300 transition-colors">
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-500">입금 확인 대기</span><span className="text-lg">⏳</span></div>
            <p className="text-2xl font-extrabold text-amber-600">{kpi.awaitingCount}건</p>
            <p className="text-xs text-gray-400 mt-1">{kpi.awaitingCount > 0 ? '클릭해 확인하기' : '대기 없음'}</p>
          </a>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-500">오늘 환불</span><span className="text-lg">↩️</span></div>
            <p className="text-2xl font-extrabold text-[#1a1a2e]">{kpi.refundTodayCount}건</p>
            <p className="text-xs text-gray-400 mt-1">실결제 기준</p>
          </div>
          <a href="/admin/sales" className="block bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:border-[#7C5CFC]/30 transition-colors">
            <div className="flex items-center justify-between mb-2"><span className="text-xs font-semibold text-gray-500">이번 달 매출</span><span className="text-lg">📈</span></div>
            <p className="text-2xl font-extrabold text-[#1a1a2e]">${Math.round(kpi.monthRevenueUSD).toLocaleString()}</p>
            <p className="text-xs text-gray-400 mt-1">확정 결제 합 (자세히)</p>
          </a>
        </div>

        {/* ── 지금 확인할 것 (입금 대기 실결제) ── */}
        {kpi.awaitingCount > 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <h2 className="text-sm font-bold text-[#1a1a2e] flex items-center gap-2">🔔 입금 확인 대기 <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">{kpi.awaitingCount}</span></h2>
              <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">✓ 실결제만{kpi.testCount > 0 ? ` · 테스트 ${kpi.testCount} 숨김` : ''}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {kpi.awaiting.slice(0, 6).map((b) => (
                <a key={b.id} href="/admin/payments" className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50/60 transition-colors">
                  <span className="font-mono text-sm font-bold text-[#1a1a2e]">{b.bookingRef || b.id}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">💳 실결제</span>
                  <span className="text-xs text-gray-500 flex-1 truncate">{b.customerEmail || '-'}</span>
                  <span className="text-sm font-bold text-[#1a1a2e] shrink-0">{b.priceUSD ? `$${b.priceUSD}` : '-'}</span>
                  <span className="text-xs font-bold text-white bg-[#7C5CFC] px-3 py-1.5 rounded-lg shrink-0">입금 확인</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {/* ── 방문자 통계 (PostHog, 운영자 본인 제외) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#7C5CFC]" />
              <h2 className="text-base font-bold text-[#1a1a2e]">외부 방문자 통계</h2>
              {visitors?.excludedAdmin ? (
                <span className="text-xs text-gray-400">({visitors.excludedAdmin} 제외)</span>
              ) : null}
            </div>
            <button
              type="button"
              onClick={loadVisitors}
              disabled={visitorsLoading}
              className="text-xs text-gray-500 hover:text-[#7C5CFC] inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${visitorsLoading ? 'animate-spin' : ''}`} />
              새로고침
            </button>
          </div>

          {visitorsError ? (
            <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              ⚠ {visitorsError}. PostHog 사이트 직접 접속:{' '}
              <a href="https://us.posthog.com" target="_blank" rel="noopener noreferrer" className="underline">us.posthog.com</a>
            </p>
          ) : visitors ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">오늘</p>
                  <p className="text-2xl font-bold text-[#7C5CFC] mt-1">{visitors.today.uniqueVisitors.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">방문자</p>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">최근 7일</p>
                  <p className="text-2xl font-bold text-[#7C5CFC] mt-1">{visitors.week.uniqueVisitors.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">방문자 합</p>
                </div>
                <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                  <p className="text-xs text-gray-500">최근 30일</p>
                  <p className="text-2xl font-bold text-[#7C5CFC] mt-1">{visitors.month.uniqueVisitors.toLocaleString()}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">방문자 합</p>
                </div>
              </div>
              {visitors.topPages.length > 0 ? (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">가장 많이 본 페이지 (7일)</h3>
                  </div>
                  <div className="space-y-1">
                    {visitors.topPages.map((p, i) => (
                      <div key={p.path} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-gray-700 truncate">{i + 1}. {p.path}</span>
                        <span className="text-xs font-bold text-[#7C5CFC]">{p.pageviews.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : visitorsLoading ? (
            <p className="text-sm text-gray-500">불러오는 중...</p>
          ) : null}
        </div>

        {/* ── 자주 쓰는 (빠른 접근) ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <a href="/admin/payments" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:border-[#7C5CFC]/40 hover:shadow-md transition-all text-center group">
            <span className="text-2xl block mb-1.5">💳</span>
            <h3 className="text-sm font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC]">예약·결제</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">입금 확인·환불</p>
          </a>
          <a href="/admin/sales" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:border-[#7C5CFC]/40 hover:shadow-md transition-all text-center group">
            <span className="text-2xl block mb-1.5">💰</span>
            <h3 className="text-sm font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC]">매출</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">기간별 매출·정산</p>
          </a>
          <a href="/admin/briefing" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:border-[#7C5CFC]/40 hover:shadow-md transition-all text-center group">
            <span className="text-2xl block mb-1.5">☀️</span>
            <h3 className="text-sm font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC]">모닝 브리핑</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">어제 회사 한 장</p>
          </a>
          <a href="/admin/decisions" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:border-[#7C5CFC]/40 hover:shadow-md transition-all text-center group">
            <span className="text-2xl block mb-1.5">📥</span>
            <h3 className="text-sm font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC]">결정 대기</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">승인/거절</p>
          </a>
          <a href="/admin/ops?tab=profit" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:border-[#7C5CFC]/40 hover:shadow-md transition-all text-center group">
            <span className="text-2xl block mb-1.5">🧾</span>
            <h3 className="text-sm font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC]">회계·손익</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">손익·세무 엑셀</p>
          </a>
          <a href="/admin/ops" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 hover:border-[#7C5CFC]/40 hover:shadow-md transition-all text-center group">
            <span className="text-2xl block mb-1.5">🛠️</span>
            <h3 className="text-sm font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC]">운영 허브</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">배차·텔레그램·시스템</p>
          </a>
        </div>

        {/* ── 전체 메뉴 ── */}
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-1">전체 메뉴</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <a
            href="/admin/reviews"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🛡️</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">{ta.quickLinks.moderationTitle}</h3>
            </div>
            <p className="text-xs text-gray-400">{ta.quickLinks.moderationDesc}</p>
          </a>
          <a
            href="/admin/claims"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📋</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">신청·문의 관리</h3>
            </div>
            <p className="text-xs text-gray-400">무료 플랜 신청 및 차터 문의 승인·거절</p>
          </a>
          <a
            href="/admin/reconciliation"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-amber-400/40 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">⚠️</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-amber-600 transition-colors">정산 · 복구</h3>
            </div>
            <p className="text-xs text-gray-400">추정가 결제 정산 + 알림 누락 booking 일괄 복구</p>
          </a>
          <a
            href="/admin/plans"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📑</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">AI 플랜 검색</h3>
            </div>
            <p className="text-xs text-gray-400">사용자 이메일·planId 로 플랜 lookup + revisionCredits 조정</p>
          </a>
          <a
            href="/admin/calendar"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📅</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">캘린더</h3>
            </div>
            <p className="text-xs text-gray-400">월별 예약 + 투어 일정 한눈에 보기</p>
          </a>
          <a
            href="/admin/sales"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">💰</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">매출</h3>
            </div>
            <p className="text-xs text-gray-400">기간별 매출 · 환불 · 정산 요약</p>
          </a>
          <a
            href="/admin/ops?tab=profit"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🧾</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">회계 · 손익</h3>
            </div>
            <p className="text-xs text-gray-400">월별 손익 · 건별 비용 입력 · 회계자료 엑셀(세무사 제출용)</p>
          </a>
          <a
            href="/admin/analytics"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📊</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">분석</h3>
            </div>
            <p className="text-xs text-gray-400">PostHog 퍼널 · 전환 · 사용자 행동</p>
          </a>
          <a
            href="/admin/ops"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🛠️</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">운영 허브</h3>
            </div>
            <p className="text-xs text-gray-400">기사 배차 · 텔레그램 봇 · 시스템 상태</p>
          </a>
          <a
            href="/admin/availability"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🚐</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">투어 가용성</h3>
            </div>
            <p className="text-xs text-gray-400">일자별 투어 운영 가능 여부 관리</p>
          </a>
          <a
            href="/admin/products"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🎫</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">상품 관리 <span className="text-[10px] text-[#7C5CFC] font-bold ml-1">NEW</span></h3>
            </div>
            <p className="text-xs text-gray-400">OTA 표준 — 4언어·갤러리·일정·미팅포인트·FAQ·취소정책 9-탭 등록</p>
          </a>
          <a
            href="/admin/zone-courses"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🗺️</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">존 코스 <span className="text-[10px] text-[#7C5CFC] font-bold ml-1">NEW</span></h3>
            </div>
            <p className="text-xs text-gray-400">AI 플래너의 day-block 시스템 — 동선 검증된 zone 별 코스 사전 큐레이션</p>
          </a>
          <a
            href="/admin/intent-classifier"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🧭</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">분류 분석 <span className="text-[10px] text-[#7C5CFC] font-bold ml-1">NEW</span></h3>
            </div>
            <p className="text-xs text-gray-400">AI 플래너 수정 요청 intent classifier 정확도 + LLM 폴백률 + mutator 실패율 모니터링</p>
          </a>
          <a
            href="/admin/translations"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🌐</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">번역 검수</h3>
            </div>
            <p className="text-xs text-gray-400">AI 번역 어색한 영·일·중 단어 직접 수정 — 다음 손님부터 깔끔하게 표시</p>
          </a>
          <a
            href="/admin/coupons"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">🎫</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">쿠폰 발행</h3>
            </div>
            <p className="text-xs text-gray-400">특정 손님에게 즉시 % / 정액 쿠폰 발행 — 컴플레인 대응 + VIP 보너스</p>
          </a>
          <a
            href="/admin/quality"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 hover:border-[#7C5CFC]/30 hover:shadow-md transition-all group"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">📊</span>
              <h3 className="text-base font-bold text-[#1a1a2e] group-hover:text-[#7C5CFC] transition-colors">품질 대시보드</h3>
            </div>
            <p className="text-xs text-gray-400">지역·항목별 약점 시각화 — 어디부터 DB 보강할지 결정</p>
          </a>
        </div>

        {/* ── Bookings Table (Firestore) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <List className="w-5 h-5 text-[#7C5CFC]" />
              <h2 className="text-lg font-bold text-[#1a1a2e]">{ta.bookings.title}</h2>
              <span className="text-xs bg-[#7C5CFC]/10 text-[#7C5CFC] px-2 py-0.5 rounded-full font-medium">
                {ta.bookings.count.replace('{n}', String(totalBookings))}
              </span>
              <span className="text-xs text-gray-400">
                {ta.bookings.source}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestPush}
                disabled={pushTesting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#B668FC] bg-[#B668FC]/5 rounded-lg hover:bg-[#B668FC]/10 transition-colors disabled:opacity-50"
                title="본인의 등록된 모든 디바이스에 테스트 푸시 발송"
              >
                <Bell className={`w-3.5 h-3.5 ${pushTesting ? 'animate-pulse' : ''}`} />
                {pushTesting ? '발송 중...' : '🔔 Test Push'}
              </button>
              <button
                onClick={fetchBookings}
                disabled={loadingBookings}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#7C5CFC] bg-[#7C5CFC]/5 rounded-lg hover:bg-[#7C5CFC]/10 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingBookings ? 'animate-spin' : ''}`} />
                {ta.bookings.refresh}
              </button>
            </div>
          </div>

          {loadingBookings ? (
            <div className="p-12 text-center text-gray-400 text-sm">{ta.loading}</div>
          ) : bookings.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              {ta.bookings.empty}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                    {bookingHeaders.map((h) => (
                      <th key={h} className="text-left px-5 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {bookings.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                      {bookingHeaders.map((h) => (
                        <td key={h} className="px-5 py-3.5 text-gray-600 max-w-[200px] truncate">
                          {String(b[h] || '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Tour Creation Form (Collapsible) ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            onClick={() => setShowForm(!showForm)}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-[#7C5CFC]" />
              <h2 className="text-lg font-bold text-[#1a1a2e]">{ta.tourForm.header}</h2>
            </div>
            {showForm ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {showForm && (
            <div className="p-5 pt-0 border-t border-gray-100">
              <form onSubmit={handleCreateTour} className="space-y-5 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {ta.tourForm.titleLabel}
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                    placeholder={ta.tourForm.titlePlaceholder}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {ta.tourForm.descriptionLabel}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                    rows={4}
                    placeholder={ta.tourForm.descriptionPlaceholder}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {ta.tourForm.priceLabel}
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(parseFloat(e.target.value || '0'))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {ta.tourForm.seatsLabel}
                    </label>
                    <input
                      type="number"
                      value={totalSeats}
                      onChange={(e) => setTotalSeats(parseFloat(e.target.value || '0'))}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#7C5CFC]/20 focus:border-[#7C5CFC] transition-all"
                      min={1}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full py-3 rounded-xl bg-[#7C5CFC] text-white font-bold hover:bg-[#6b4ce0] transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? ta.tourForm.submitting : ta.tourForm.submit}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
