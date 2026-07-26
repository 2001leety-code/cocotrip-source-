import { useMemo, useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { MoodTopupModal } from '@/components/admin/MoodTopupModal';
import { MoodAccessManager } from '@/components/admin/MoodAccessManager';
import { MoodPlacesManager } from '@/components/admin/MoodPlacesManager';
import { useLanguage } from '@/hooks/useLanguage';
import { db } from '@/lib/firebase';
import { addDoc, collection, serverTimestamp, query, orderBy, onSnapshot } from 'firebase/firestore';
import { toast, Toaster } from 'sonner';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileSearch,
  Gauge,
  Inbox,
  KeyRound,
  Languages,
  List,
  Map,
  MapPin,
  Megaphone,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  TrendingUp,
  Truck,
  Users,
  WalletCards,
} from 'lucide-react';

interface Booking {
  id: string;
  [key: string]: unknown;
}

export default function Admin() {
  const { user, loading, error } = useAuth();
  const { t } = useLanguage();
  const ta = t.admin;

  // ── 무드 선불 충전 모달 (어드민 인라인 — /mood 이동 없이 여기서 충전) ──
  const [moodTopupOpen, setMoodTopupOpen] = useState(false);
  // ── MOOD 접근 관리 · 주소록 모달 (어드민 인라인) ──
  const [moodAccessOpen, setMoodAccessOpen] = useState(false);
  const [moodPlacesOpen, setMoodPlacesOpen] = useState(false);

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

  const statusCards = [
    {
      label: '오늘 실결제',
      value: `${kpi.paidTodayCount}건`,
      meta: `$${kpi.paidTodayUSD.toLocaleString()} 확인됨`,
      href: undefined,
      icon: CreditCard,
      accent: 'text-emerald-300',
      panel: 'border-emerald-400/20 bg-emerald-400/[0.08]',
    },
    {
      label: '입금 확인 대기',
      value: `${kpi.awaitingCount}건`,
      meta: kpi.awaitingCount > 0 ? '바로 처리 필요' : '대기 없음',
      href: '/admin/payments',
      icon: AlertTriangle,
      accent: kpi.awaitingCount > 0 ? 'text-amber-300' : 'text-slate-300',
      panel: kpi.awaitingCount > 0 ? 'border-amber-300/35 bg-amber-300/[0.1]' : 'border-white/10 bg-white/[0.045]',
    },
    {
      label: '오늘 환불',
      value: `${kpi.refundTodayCount}건`,
      meta: '실결제 기준',
      href: undefined,
      icon: RotateCcw,
      accent: 'text-rose-300',
      panel: 'border-rose-400/20 bg-rose-400/[0.08]',
    },
    {
      label: '이번 달 매출',
      value: `$${Math.round(kpi.monthRevenueUSD).toLocaleString()}`,
      meta: '확정 결제 합',
      href: '/admin/sales',
      icon: CircleDollarSign,
      accent: 'text-sky-300',
      panel: 'border-sky-400/20 bg-sky-400/[0.08]',
    },
  ];

  const quickActions = [
    { href: '/admin/payments', title: '예약·결제', desc: '입금 확인·환불', icon: CreditCard, tone: 'text-sky-300' },
    { href: '/admin/all-bookings', title: '통합 예약', desc: '무드 + 코코트립', icon: ClipboardList, tone: 'text-violet-300' },
    { href: '/mood#topup', title: '무드 충전', desc: '입금 확인 후 선불 잔액', icon: WalletCards, tone: 'text-pink-300' },
    { href: '#mood-access', title: 'MOOD 접근 관리', desc: '조회·충전 이메일 관리', icon: KeyRound, tone: 'text-violet-300' },
    { href: '#mood-places', title: 'MOOD 주소록', desc: '자주 가는 곳·이사님 댁', icon: MapPin, tone: 'text-violet-300' },
    { href: '/admin/ops', title: '운영 허브', desc: '배차·텔레그램·시스템', icon: BriefcaseBusiness, tone: 'text-emerald-300' },
  ];

  const menuSections = [
    {
      title: '예약 운영',
      items: [
        { href: '/admin/reviews', title: '리뷰 관리', desc: '후기 검수와 노출 관리', icon: ShieldCheck },
        { href: '/admin/claims', title: '신청·문의 관리', desc: '무료 플랜·차터·맞춤 투어', icon: Inbox },
        { href: '/admin/plans', title: 'AI 플랜 검색', desc: '사용자 이메일·planId 조회', icon: FileSearch },
        { href: '/admin/calendar', title: '캘린더', desc: '월별 예약과 투어 일정', icon: CalendarDays },
        { href: '/admin/availability', title: '투어 가용성', desc: '일자별 운영 가능 여부', icon: Truck },
        { href: '/admin/reconciliation', title: '정산 · 복구', desc: '추정가 정산과 알림 복구', icon: ShieldCheck },
        // 링크가 없으면 라우트가 있어도 운영자가 못 찾는다 — /onboarding 이 그렇게 죽었다(미사용 감사).
        { href: '/admin/payment-reviews', title: '결제 격리', desc: '금액 불일치로 미확정된 주문', icon: AlertTriangle },
      ],
    },
    {
      title: '상품·콘텐츠',
      items: [
        { href: '/admin/products', title: '상품 관리', desc: 'OTA 표준 상품 등록', icon: PackageOpen },
        { href: '/admin/zone-courses', title: '존 코스', desc: 'AI 플래너 코스 큐레이션', icon: Map },
        { href: '/admin/translations', title: '번역 검수', desc: '영·일·중 문구 보정', icon: Languages },
        { href: '/admin/coupons', title: '쿠폰 발행', desc: '고객별 쿠폰 지급', icon: Tags },
      ],
    },
    {
      title: '분석·시스템',
      items: [
        { href: '/admin/sales', title: '매출', desc: '기간별 매출·환불 요약', icon: CircleDollarSign },
        { href: '/admin/analytics', title: '분석', desc: '퍼널과 사용자 행동', icon: BarChart3 },
        { href: '/admin/promo-stats', title: '프로모션 현황', desc: '쿠폰 발급·사용률', icon: Megaphone },
        { href: '/admin/quality', title: '품질 대시보드', desc: '지역·항목별 약점', icon: Gauge },
        { href: '/admin/intent-classifier', title: '분류 분석', desc: '수정 요청 분류 정확도', icon: FileSearch },
        { href: '/admin/briefing', title: '모닝 브리핑', desc: '어제 회사 한 장', icon: Sparkles },
        { href: '/admin/decisions', title: '결정 대기', desc: '승인·거절 큐', icon: CheckCircle2 },
        { href: '/admin/ops?tab=profit', title: '회계 · 손익', desc: '손익·세무 엑셀', icon: Settings },
      ],
    },
  ];

  // ⚠️ 자체 loading 게이트 제거 (2026-07-03) — 인증 게이트는 AdminRoute가 이미 담당.
  // 여기서 또 useAuth loading을 기다리면 "불러오는 중..."에 갇히는 화면이 생김(prod 재현).
  // 데이터 fetch effect들은 user && !loading 가드가 있어 콘솔 셸을 즉시 그려도 안전.
  return (
    // translate="no": 어드민은 운영자 전용(번역 무의미) — 브라우저 자동번역기가
    // 텍스트 노드를 바꿔치기해 React removeChild 충돌("예기치 않은 오류")을 일으키던 것 원천 차단.
    // 사용자 페이지는 i18n 언어선택기 제공하므로 전역 아닌 어드민만 차단.
    <div className="min-h-screen bg-[#111318] text-slate-100" translate="no">
      <Toaster position="top-center" richColors />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="rounded-[28px] border border-white/10 bg-[#181b22] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">
                <Activity className="h-3.5 w-3.5 text-emerald-300" />
                운영 관제
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{ta.title}</h1>
                <p className="mt-1 text-sm text-slate-400">{ta.subtitle}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Link
                to="/admin/payments"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] px-4 py-3 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-300/[0.14]"
              >
                <CreditCard className="h-4 w-4" />
                입금 확인
              </Link>
              <button
                type="button"
                onClick={() => setMoodTopupOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-pink-300/25 bg-pink-300/[0.1] px-4 py-3 text-sm font-bold text-pink-100 transition-colors hover:bg-pink-300/[0.16]"
                aria-label="무드 선불 잔액 충전"
              >
                <WalletCards className="h-4 w-4" />
                무드 충전
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {statusCards.map((card) => {
              const StatusIcon = card.icon;
              const inner = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400">{card.label}</span>
                    <StatusIcon className={`h-4 w-4 ${card.accent}`} />
                  </div>
                  <p className="mt-3 text-2xl font-black text-white">{card.value}</p>
                  <p className="mt-1 text-xs text-slate-400">{card.meta}</p>
                </>
              );
              return card.href ? (
                <Link key={card.label} to={card.href} className={`rounded-2xl border p-4 transition-colors hover:bg-white/[0.08] ${card.panel}`}>
                  {inner}
                </Link>
              ) : (
                <div key={card.label} className={`rounded-2xl border p-4 ${card.panel}`}>
                  {inner}
                </div>
              );
            })}
          </div>
        </section>

        {error ? (
          <p className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.08] px-4 py-3 text-sm text-rose-100">{error}</p>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
          <div className="rounded-[24px] border border-white/10 bg-[#181b22] shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-300" />
                <h2 className="text-base font-bold text-white">지금 확인할 것</h2>
                <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs font-bold text-amber-200">{kpi.awaitingCount}</span>
              </div>
              <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-2.5 py-1 text-xs font-semibold text-emerald-200">
                실결제만{kpi.testCount > 0 ? ` · 테스트 ${kpi.testCount} 숨김` : ''}
              </span>
            </div>

            <div className="divide-y divide-white/10">
              {kpi.awaiting.length > 0 ? (
                kpi.awaiting.slice(0, 6).map((b) => (
                  <Link key={b.id} to="/admin/payments" className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-white/[0.045]">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-300/[0.12] text-amber-200">
                      <CreditCard className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-bold text-white">{b.bookingRef || b.id}</p>
                      <p className="truncate text-xs text-slate-400">{b.customerEmail || '-'}</p>
                    </div>
                    <span className="shrink-0 text-sm font-black text-white">{b.priceUSD ? `$${b.priceUSD}` : '-'}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-slate-500" />
                  </Link>
                ))
              ) : (
                <div className="flex items-center gap-3 px-5 py-8 text-sm text-slate-400">
                  <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                  입금 확인 대기 건이 없습니다.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/10 bg-[#181b22] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-sky-300" />
                <h2 className="text-base font-bold text-white">외부 방문자</h2>
              </div>
              <button
                type="button"
                onClick={loadVisitors}
                disabled={visitorsLoading}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-slate-300 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${visitorsLoading ? 'animate-spin' : ''}`} />
                새로고침
              </button>
            </div>

            {visitorsError ? (
              <p className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] px-3 py-2 text-sm text-amber-100">
                {visitorsError}. <a href="https://us.posthog.com" target="_blank" rel="noopener noreferrer" className="underline">PostHog</a>
              </p>
            ) : visitors ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    ['오늘', visitors.today.uniqueVisitors, '방문자'],
                    ['최근 7일', visitors.week.uniqueVisitors, '합계'],
                    ['최근 30일', visitors.month.uniqueVisitors, '합계'],
                  ].map(([label, value, caption]) => (
                    <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.045] p-3">
                      <p className="text-xs text-slate-400">{label}</p>
                      <p className="mt-1 text-xl font-black text-white">{Number(value).toLocaleString()}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">{caption}</p>
                    </div>
                  ))}
                </div>
                {visitors.topPages.length > 0 ? (
                  <div className="mt-4 border-t border-white/10 pt-4">
                    <div className="mb-2 flex items-center gap-1.5">
                      <TrendingUp className="h-3.5 w-3.5 text-slate-500" />
                      <h3 className="text-xs font-bold text-slate-400">많이 본 페이지</h3>
                    </div>
                    <div className="space-y-1.5">
                      {visitors.topPages.map((p, i) => (
                        <div key={p.path} className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate font-mono text-xs text-slate-300">{i + 1}. {p.path}</span>
                          <span className="shrink-0 text-xs font-bold text-sky-300">{p.pageviews.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {visitors?.excludedAdmin ? (
                  <p className="mt-3 text-[11px] text-slate-500">{visitors.excludedAdmin} 제외</p>
                ) : null}
              </>
            ) : visitorsLoading ? (
              <p className="text-sm text-slate-400">불러오는 중...</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-[#181b22] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-white">빠른 실행</h2>
            <span className="text-xs text-slate-500">자주 쓰는 흐름</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {quickActions.map((action) => {
              const ActionIcon = action.icon;
              // MOOD 관련 3종 = /mood 이동 대신 어드민 인라인 모달
              const modalOpener =
                action.href === '/mood#topup' ? () => setMoodTopupOpen(true)
                : action.href === '#mood-access' ? () => setMoodAccessOpen(true)
                : action.href === '#mood-places' ? () => setMoodPlacesOpen(true)
                : null;
              if (modalOpener) {
                return (
                  <button
                    type="button"
                    key={action.title}
                    onClick={modalOpener}
                    className="group rounded-2xl border border-white/10 bg-white/[0.045] p-4 text-left transition-colors hover:bg-white/[0.08]"
                  >
                    <ActionIcon className={`mb-3 h-5 w-5 ${action.tone}`} />
                    <h3 className="text-sm font-bold text-white">{action.title}</h3>
                    <p className="mt-1 text-xs text-slate-400">{action.desc}</p>
                  </button>
                );
              }
              return (
                <Link key={action.title} to={action.href} className="group rounded-2xl border border-white/10 bg-white/[0.045] p-4 transition-colors hover:bg-white/[0.08]">
                  <ActionIcon className={`mb-3 h-5 w-5 ${action.tone}`} />
                  <h3 className="text-sm font-bold text-white">{action.title}</h3>
                  <p className="mt-1 text-xs text-slate-400">{action.desc}</p>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-sm font-bold text-white">전체 메뉴</h2>
            <span className="text-xs text-slate-500">업무군별 정리</span>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {menuSections.map((section) => (
              <div key={section.title} className="rounded-[24px] border border-white/10 bg-[#181b22] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
                <h3 className="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">{section.title}</h3>
                <div className="space-y-2">
                  {section.items.map((item) => {
                    const MenuIcon = item.icon;
                    return (
                      <Link key={item.href} to={item.href} className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 transition-colors hover:bg-white/[0.075]">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.055] text-slate-300 group-hover:text-white">
                          <MenuIcon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-white">{item.title}</span>
                          <span className="block truncate text-xs text-slate-500">{item.desc}</span>
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 group-hover:text-slate-300" />
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-[#181b22] shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
          <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <List className="h-5 w-5 text-violet-300" />
              <h2 className="text-base font-bold text-white">{ta.bookings.title}</h2>
              <span className="rounded-full bg-violet-300/15 px-2 py-0.5 text-xs font-bold text-violet-200">
                {ta.bookings.count.replace('{n}', String(totalBookings))}
              </span>
              <span className="text-xs text-slate-500">{ta.bookings.source}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleTestPush}
                disabled={pushTesting}
                className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300/20 bg-violet-300/[0.08] px-3 py-2 text-xs font-bold text-violet-100 transition-colors hover:bg-violet-300/[0.14] disabled:opacity-50"
                title="본인의 등록된 모든 디바이스에 테스트 푸시 발송"
              >
                <Bell className={`h-3.5 w-3.5 ${pushTesting ? 'animate-pulse' : ''}`} />
                {pushTesting ? '발송 중...' : '테스트 푸시'}
              </button>
              <button
                onClick={fetchBookings}
                disabled={loadingBookings}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingBookings ? 'animate-spin' : ''}`} />
                {ta.bookings.refresh}
              </button>
            </div>
          </div>

          {loadingBookings ? (
            <div className="p-12 text-center text-sm text-slate-500">{ta.loading}</div>
          ) : bookings.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">{ta.bookings.empty}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.035] text-xs uppercase tracking-wider text-slate-500">
                    {bookingHeaders.map((h) => (
                      <th key={h} className="px-5 py-3 text-left font-bold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {bookings.map((b) => (
                    <tr key={b.id} className="transition-colors hover:bg-white/[0.035]">
                      {bookingHeaders.map((h) => (
                        <td key={h} className="max-w-[220px] truncate px-5 py-3.5 text-slate-300">
                          {String(b[h] || '-')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-[24px] border border-white/10 bg-[#181b22] shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-white/[0.035]"
          >
            <div className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-violet-300" />
              <h2 className="text-base font-bold text-white">{ta.tourForm.header}</h2>
            </div>
            {showForm ? (
              <ChevronUp className="h-5 w-5 text-slate-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500" />
            )}
          </button>

          {showForm && (
            <div className="border-t border-white/10 p-5">
              <form onSubmit={handleCreateTour} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">
                    {ta.tourForm.titleLabel}
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-slate-100 outline-none transition-all placeholder:text-slate-600 focus:border-violet-300/60 focus:ring-2 focus:ring-violet-300/10"
                    placeholder={ta.tourForm.titlePlaceholder}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">
                    {ta.tourForm.descriptionLabel}
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-slate-100 outline-none transition-all placeholder:text-slate-600 focus:border-violet-300/60 focus:ring-2 focus:ring-violet-300/10"
                    rows={4}
                    placeholder={ta.tourForm.descriptionPlaceholder}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-300">
                      {ta.tourForm.priceLabel}
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(parseFloat(e.target.value || '0'))}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-slate-100 outline-none transition-all focus:border-violet-300/60 focus:ring-2 focus:ring-violet-300/10"
                      min={0}
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-300">
                      {ta.tourForm.seatsLabel}
                    </label>
                    <input
                      type="number"
                      value={totalSeats}
                      onChange={(e) => setTotalSeats(parseFloat(e.target.value || '0'))}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 text-slate-100 outline-none transition-all focus:border-violet-300/60 focus:ring-2 focus:ring-violet-300/10"
                      min={1}
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting}
                  className="w-full rounded-2xl bg-violet-500 px-4 py-3 font-bold text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
                >
                  {isSubmitting ? ta.tourForm.submitting : ta.tourForm.submit}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>

      <MoodTopupModal open={moodTopupOpen} onClose={() => setMoodTopupOpen(false)} />
      <MoodAccessManager open={moodAccessOpen} onClose={() => setMoodAccessOpen(false)} />
      <MoodPlacesManager open={moodPlacesOpen} onClose={() => setMoodPlacesOpen(false)} />
    </div>
  );
}
