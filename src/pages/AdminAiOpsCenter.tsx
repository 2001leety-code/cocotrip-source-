import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  ExternalLink,
  Inbox,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  TriangleAlert,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePageMeta } from '@/hooks/usePageMeta';
import { OwnerControllerSetupPanel } from '@/components/OwnerControllerSetupPanel';

type Priority = 'P0' | 'P1' | 'P2' | 'P3';
type ReservationFilter = 'today' | 'week' | 'all';

interface OpsSummary {
  actionRequired: number;
  urgent: number;
  todayReservations: number;
  upcoming7d: number;
  openInquiries: number;
  openCs: number;
  paymentReviews: number;
  automationAttention: number;
}

interface WorkItem {
  workItemId: string;
  type: string;
  sourceSystem: string;
  sourceRecordId: string;
  title: string;
  status: string;
  priority: Priority;
  nextAction: string;
  actionRequired: boolean;
  ageHours: number;
  eventDate: string;
  createdAtMs: number;
  deepLink: string;
}

interface ReservationItem {
  workItemId: string;
  sourceSystem: 'bookings' | 'pending_bookings' | 'mood_bookings';
  sourceLabel: string;
  sourceRecordId: string;
  bookingRef: string;
  customerIdentityVerified: boolean;
  tripAt: string;
  tripAtMs: number;
  reservationStatus: string;
  paymentStatus: string;
  dispatchStatus: string;
  replyStatus: string;
  priority: Priority;
  nextAction: string;
  actionRequired: boolean;
  updatedAtMs: number;
  createdAtMs: number;
  deepLink: string;
  label: string;
  isTest: boolean;
}

interface InboxItem extends WorkItem {
  eventDate: string;
}

type AutomationStatus = 'ok' | 'attention' | 'retrying' | 'off' | 'unknown' | 'unlinked';

interface AutomationItem {
  key: string;
  label: string;
  status: AutomationStatus;
  pending: number;
  manual: number;
  count: number;
  detail: string;
  deepLink: string;
}

interface SourceState {
  key: string;
  label: string;
  ok: boolean;
  count: number;
  possiblyTruncated: boolean;
}

export interface OpsCenterData {
  generatedAt: string;
  summary: OpsSummary;
  workItems: WorkItem[];
  reservations: ReservationItem[];
  inboxItems: InboxItem[];
  automation: AutomationItem[];
  sources: SourceState[];
  partialErrors: string[];
  deduplication: {
    rule: string;
    removedMirrorCount: number;
  };
  window: {
    perSourceLimit: number;
    note: string;
  };
}

interface ApiResponse {
  ok: boolean;
  data?: OpsCenterData;
  error?: string;
}

const FOREGROUND_REFRESH_DEBOUNCE_MS = 900;


const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  P0: { label: '즉시', className: 'border-rose-400/40 bg-rose-400/15 text-rose-200' },
  P1: { label: '우선', className: 'border-amber-300/35 bg-amber-300/10 text-amber-100' },
  P2: { label: '확인', className: 'border-sky-300/30 bg-sky-300/10 text-sky-100' },
  P3: { label: '일반', className: 'border-white/10 bg-white/[0.04] text-slate-300' },
};

const AUTOMATION_META: Record<AutomationStatus, { label: string; className: string }> = {
  ok: { label: '정상', className: 'text-emerald-200 bg-emerald-400/10 border-emerald-400/25' },
  attention: { label: '수동 확인', className: 'text-rose-200 bg-rose-400/10 border-rose-400/25' },
  retrying: { label: '재시도 중', className: 'text-amber-100 bg-amber-300/10 border-amber-300/25' },
  off: { label: '꺼짐', className: 'text-slate-300 bg-white/[0.04] border-white/10' },
  unknown: { label: '확인 실패', className: 'text-rose-200 bg-rose-400/10 border-rose-400/25' },
  unlinked: { label: '미연동', className: 'text-violet-200 bg-violet-400/10 border-violet-400/25' },
};

const SOURCE_CLASSES: Record<ReservationItem['sourceSystem'], string> = {
  bookings: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  pending_bookings: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
  mood_bookings: 'border-pink-400/30 bg-pink-400/10 text-pink-200',
};

function kstDayStart(nowMs = Date.now()) {
  const shifted = new Date(nowMs + 9 * 60 * 60 * 1000);
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 9 * 60 * 60 * 1000;
}

function shortId(value: string) {
  if (!value) return '-';
  if (value.length <= 18) return value;
  return `${value.slice(0, 9)}…${value.slice(-5)}`;
}

function formatKst(value: string | number) {
  if (!value) return '-';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10) || '-';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTripDate(value: string) {
  if (!value) return '날짜 미정';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}

function ageLabel(hours: number) {
  if (hours < 1) return '1시간 이내';
  if (hours < 24) return `${hours}시간 대기`;
  return `${Math.floor(hours / 24)}일 대기`;
}

function reservationStatusLabel(status: string) {
  const normalized = status.toLowerCase();
  const labels: Record<string, string> = {
    confirmed: '확정',
    completed: '완료',
    awaiting_verification: '입금 대기',
    pending: '대기',
    refunded: '환불 완료',
    canceled: '취소',
    cancelled: '취소',
  };
  return labels[normalized] || status || '상태 미확인';
}

function dispatchLabel(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'accepted') return '배차 완료';
  if (normalized === 'not_required') return '배차 불필요';
  if (normalized === 'rejected') return '재배차 필요';
  return '배차 미확인';
}

function isExternal(url: string) {
  return /^https?:\/\//.test(url);
}

function SectionJumpBar({ items }: { items: { id: string; label: string }[] }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#181b22] p-3 sm:p-4">
      <p className="mb-2 text-xs text-slate-400">한눈에 이동</p>
      <nav
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="운영 센터 섹션 바로가기"
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="min-h-[44px] shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </section>
  );
}

function RefreshBadge({
  mode,
  lastFetchedAt,
  syncing,
  isPreview,
}: {
  mode: 'server' | 'preview';
  lastFetchedAt: number | null;
  syncing: boolean;
  isPreview: boolean;
}) {
  const updated = lastFetchedAt && Number.isFinite(lastFetchedAt) ? `${formatKst(lastFetchedAt)} 기준` : '갱신 대기중';
  if (mode === 'preview' && lastFetchedAt == null) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-400">
        미리보기 데이터
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-100">
      <p className="font-black">{isPreview ? '미리보기 모드' : '운영 연동 모드'}</p>
      <p className="mt-0.5 text-[11px] text-slate-300">
        {syncing ? '갱신 중' : '갱신 완료'} · {updated}
      </p>
    </div>
  );
}

function DeepLink({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  const common = `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#111318] ${className}`;
  if (isExternal(to)) {
    return (
      <a href={to} target="_blank" rel="noopener noreferrer" className={common}>
        {children}
      </a>
    );
  }
  return <Link to={to} className={common}>{children}</Link>;
}

function SummaryCard({
  label,
  value,
  detail,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail: string;
  tone: 'rose' | 'violet' | 'sky' | 'amber';
  icon: typeof AlertCircle;
}) {
  const tones = {
    rose: 'border-rose-400/20 bg-rose-400/[0.07] text-rose-200',
    violet: 'border-violet-400/20 bg-violet-400/[0.07] text-violet-200',
    sky: 'border-sky-400/20 bg-sky-400/[0.07] text-sky-200',
    amber: 'border-amber-300/20 bg-amber-300/[0.07] text-amber-100',
  };
  return (
    <div className={`rounded-2xl border p-3.5 sm:p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-300">{label}</p>
        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
      </div>
      <p className="mt-2 text-2xl font-black text-white">{value}<span className="ml-0.5 text-sm font-semibold text-slate-300">건</span></p>
      <p className="mt-1 text-[11px] leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function WorkQueue({ items, sectionId }: { items: WorkItem[]; sectionId?: string }) {
  return (
    <section id={sectionId} className="rounded-3xl border border-white/10 bg-[#181b22] p-4 sm:p-5" aria-labelledby="work-queue-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="work-queue-title" className="text-base font-extrabold text-white">지금 해야 할 일</h2>
          <p className="mt-1 text-xs text-slate-400">긴급도와 대기시간 순서</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-slate-200">
          {items.length}건
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-400/25 bg-emerald-400/[0.05] px-4 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-emerald-100">지금 급한 업무가 없습니다</p>
          <p className="mt-1 text-xs text-slate-400">각 원본의 조회 성공 여부는 아래 자료 상태에서 확인할 수 있습니다.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.slice(0, 10).map((item) => {
            const meta = PRIORITY_META[item.priority];
            return (
              <DeepLink
                key={item.workItemId}
                to={item.deepLink}
                className="group flex min-h-[60px] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 transition-colors hover:border-violet-300/25 hover:bg-white/[0.05]"
              >
                <span className={`inline-flex shrink-0 items-center rounded-lg border px-2 py-1 text-[10px] font-black ${meta.className}`}>
                  {meta.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-100">{item.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                    <span>{item.nextAction}</span>
                    {item.ageHours > 0 && <span>· {ageLabel(item.ageHours)}</span>}
                    {item.eventDate && <span>· {formatTripDate(item.eventDate)}</span>}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-200" aria-hidden="true" />
              </DeepLink>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AutomationPanel({ items, sectionId }: { items: AutomationItem[]; sectionId?: string }) {
  return (
    <section id={sectionId} className="rounded-3xl border border-white/10 bg-[#181b22] p-4 sm:p-5" aria-labelledby="automation-title">
      <div>
        <h2 id="automation-title" className="text-base font-extrabold text-white">자동화 상태</h2>
        <p className="mt-1 text-xs text-slate-400">실행 결과가 없는 항목은 미연동으로 표시</p>
      </div>
      <div className="mt-4 space-y-2">
        {items.map((item) => {
          const meta = AUTOMATION_META[item.status];
          return (
            <DeepLink
              key={item.key}
              to={item.deepLink}
              className="flex min-h-[58px] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 hover:bg-white/[0.05]"
            >
              {item.status === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
              ) : item.status === 'attention' || item.status === 'unknown' ? (
                <TriangleAlert className="h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
              ) : (
                <CircleDot className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-100">{item.label}</span>
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}>{meta.label}</span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">{item.detail}</span>
              </span>
              {isExternal(item.deepLink) ? (
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              )}
            </DeepLink>
          );
        })}
      </div>
    </section>
  );
}

function ReservationsPanel({ reservations, sectionId }: { reservations: ReservationItem[]; sectionId?: string }) {
  const [filter, setFilter] = useState<ReservationFilter>('week');
  const visible = useMemo(() => {
    const start = kstDayStart();
    const end = filter === 'today' ? start + 24 * 60 * 60 * 1000 : start + 8 * 24 * 60 * 60 * 1000;
    if (filter === 'all') return reservations;
    return reservations.filter((item) => item.tripAtMs >= start && item.tripAtMs < end);
  }, [filter, reservations]);

  const filters: { key: ReservationFilter; label: string }[] = [
    { key: 'today', label: '오늘' },
    { key: 'week', label: '7일' },
    { key: 'all', label: '최근 전체' },
  ];

  return (
    <section id={sectionId} className="rounded-3xl border border-white/10 bg-[#181b22] p-4 sm:p-5" aria-labelledby="reservations-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="reservations-title" className="text-base font-extrabold text-white">통합 예약 흐름</h2>
          <p className="mt-1 text-xs text-slate-400">온라인·입금 대기·MOOD를 원본 식별자로 정리</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-[#111318] p-1" role="group" aria-label="예약 기간 필터">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`min-h-[44px] rounded-lg px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${
                filter === item.key ? 'bg-violet-500/25 text-white' : 'text-slate-400 hover:text-white'
              }`}
              aria-pressed={filter === item.key}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4 flex min-h-28 items-center justify-center rounded-2xl border border-dashed border-white/10 px-4 text-center text-sm text-slate-400">
          선택한 기간에 표시할 예약이 없습니다.
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {visible.slice(0, 30).map((item) => (
            <DeepLink
              key={item.workItemId}
              to={item.deepLink}
              className="group grid min-h-[72px] grid-cols-[1fr_auto] gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 transition-colors hover:border-violet-300/25 hover:bg-white/[0.05] sm:grid-cols-[minmax(0,1.4fr)_minmax(120px,.7fr)_minmax(160px,.8fr)_auto] sm:items-center"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-black ${SOURCE_CLASSES[item.sourceSystem]}`}>
                    {item.sourceLabel}
                  </span>
                  <span className="truncate text-sm font-bold text-slate-100">{item.label}</span>
                  {item.isTest && <span className="shrink-0 text-[10px] font-bold text-amber-200">테스트</span>}
                </span>
                <span className="mt-1 block truncate font-mono text-[11px] text-slate-400">{shortId(item.bookingRef)}</span>
              </span>
              <span className="justify-self-end text-right sm:justify-self-start sm:text-left">
                <span className="block text-xs font-bold text-slate-200">{formatTripDate(item.tripAt)}</span>
                <span className="mt-0.5 block text-[10px] text-slate-500">여행일</span>
              </span>
              <span className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-200">
                  {reservationStatusLabel(item.reservationStatus)}
                </span>
                {item.sourceSystem === 'bookings' && (
                  <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${
                    item.dispatchStatus === 'accepted'
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                      : 'border-white/10 bg-white/[0.04] text-slate-400'
                  }`}>
                    {dispatchLabel(item.dispatchStatus)}
                  </span>
                )}
                {item.actionRequired && (
                  <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${PRIORITY_META[item.priority].className}`}>
                    {item.nextAction}
                  </span>
                )}
              </span>
              <ArrowUpRight className="hidden h-4 w-4 text-slate-500 group-hover:text-violet-200 sm:block" aria-hidden="true" />
            </DeepLink>
          ))}
          {visible.length > 30 && (
            <p className="pt-2 text-center text-xs text-slate-400">화면 속도를 위해 앞 30건만 표시합니다. 기간을 좁히거나 원본 화면에서 전체를 확인하세요.</p>
          )}
        </div>
      )}
    </section>
  );
}

function InboxSummary({ summary, sectionId }: { summary: OpsSummary; sectionId?: string }) {
  const entries = [
    { label: '웹 문의', count: summary.openInquiries, to: '/admin/claims', icon: Inbox },
    { label: 'CS 문의', count: summary.openCs, to: '/admin/ops?tab=review', icon: Stethoscope },
    { label: '결제 격리', count: summary.paymentReviews, to: '/admin/payment-reviews', icon: ShieldAlert },
  ];
  return (
    <section id={sectionId} className="grid gap-2 sm:grid-cols-3" aria-label="문의와 검토 바로가기">
      {entries.map((entry) => (
        <DeepLink
          key={entry.label}
          to={entry.to}
          className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-white/10 bg-[#181b22] px-4 py-3 hover:border-violet-300/25 hover:bg-white/[0.05]"
        >
          <entry.icon className="h-4 w-4 shrink-0 text-violet-200" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-400">{entry.label}</span>
            <span className="mt-0.5 block text-base font-black text-white">{entry.count}건</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </DeepLink>
      ))}
    </section>
  );
}

function SourceHealth({ data, sectionId }: { data: OpsCenterData; sectionId?: string }) {
  return (
    <details id={sectionId} className="rounded-2xl border border-white/10 bg-[#181b22] p-3.5 text-sm">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-bold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
        <span className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-violet-200" aria-hidden="true" />
          자료 연결 상태
        </span>
        <span className="text-xs font-medium text-slate-400">
          {data.partialErrors.length > 0 ? `${data.partialErrors.length}곳 확인 실패` : '모두 응답'}
        </span>
      </summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.sources.map((source) => (
          <div key={source.key} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5">
            {source.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden="true" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{source.label}</span>
            <span className="shrink-0 text-[11px] font-bold text-slate-400">
              {source.ok ? `${source.count}${source.possiblyTruncated ? '+' : ''}건` : '실패'}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        최근 원본별 {data.window.perSourceLimit}건 기준 · 확정된 입금 대기 mirror {data.deduplication.removedMirrorCount}건을 명시적 예약 식별자로만 정리했습니다.
      </p>
    </details>
  );
}

interface AdminAiOpsCenterProps {
  previewData?: OpsCenterData;
}

export default function AdminAiOpsCenter({ previewData }: AdminAiOpsCenterProps = {}) {
  usePageMeta({ title: 'AI 운영센터 (관리자)', description: 'CocoTrip reservations and operations control center.' });
  const { user } = useAuth();
  const [data, setData] = useState<OpsCenterData | null>(previewData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(previewData ? Date.parse(previewData.generatedAt) : null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const foregroundRefreshUntilRef = useRef(0);
  const serverMode = previewData == null;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (previewData) {
      setLastFetchedAt(Date.parse(previewData.generatedAt));
    }
  }, [previewData]);

  const load = useCallback(async () => {
    if (previewData) return;
    if (!user) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin-ai-ops-center?limit=180', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload: ApiResponse = await response.json();
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error ? payload.error : '운영 자료를 불러오지 못했습니다.');
      }
      if (isMountedRef.current) {
        setData(payload.data);
        setLastFetchedAt(Date.parse(payload.data.generatedAt));
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        setError(loadError instanceof Error ? loadError.message : '운영 자료를 불러오지 못했습니다.');
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, [previewData, user]);

  const triggerForegroundRefresh = useCallback(() => {
    if (!serverMode) return;
    if (document.hidden) return;
    if (inFlightRef.current) return;
    const now = Date.now();
    if (now < foregroundRefreshUntilRef.current) return;
    foregroundRefreshUntilRef.current = now + FOREGROUND_REFRESH_DEBOUNCE_MS;
    void load();
  }, [load, serverMode]);

  const handleForegroundReturn = useCallback(() => {
    if (typeof document === 'undefined') return;
    if (document.hidden) return;
    triggerForegroundRefresh();
  }, [triggerForegroundRefresh]);

  useEffect(() => {
    const timerId = window.setTimeout(() => { void load(); }, 0);
    if (serverMode) {
      window.addEventListener('focus', handleForegroundReturn);
      document.addEventListener('visibilitychange', handleForegroundReturn);
    }
    return () => {
      window.clearTimeout(timerId);
      window.removeEventListener('focus', handleForegroundReturn);
      document.removeEventListener('visibilitychange', handleForegroundReturn);
    };
  }, [load, handleForegroundReturn, serverMode]);

  const visibleTimestamp = lastFetchedAt && Number.isFinite(lastFetchedAt) ? lastFetchedAt : null;
  const mode: 'server' | 'preview' = serverMode ? 'server' : 'preview';

  const visibleWorkItems = useMemo(() => data ? data.workItems.filter((item) => item.actionRequired) : [], [data]);

  return (
    <div className="min-h-screen bg-[#111318] text-slate-100" translate="no">
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#111318]/95 backdrop-blur">
        <div className="mx-auto flex min-h-[64px] w-full max-w-7xl flex-wrap items-start gap-2 px-3 py-2 sm:flex-nowrap sm:items-center sm:gap-3 sm:px-6 lg:px-8">
          <Link
            to="/admin"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            aria-label="관리자 홈으로"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black text-white sm:text-lg">AI 운영센터</h1>
              <p className="truncate text-[11px] text-slate-400">예약 · 문의 · 자동화 한눈에 보기</p>
            </div>
          </div>
          <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:ml-0 sm:flex-none sm:flex-nowrap">
            <RefreshBadge mode={mode} lastFetchedAt={visibleTimestamp} syncing={loading} isPreview={!serverMode} />
            <button
              type="button"
              onClick={() => { void load(); }}
              disabled={loading}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-slate-200 hover:bg-white/[0.08] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span className="hidden sm:inline">새로고침</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:px-8">
        {error && !data && (
          <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-rose-100">운영 자료를 불러오지 못했습니다</p>
                <p className="mt-1 break-words text-xs text-slate-300">{error}</p>
                <button
                  type="button"
                  onClick={() => { void load(); }}
                  className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-rose-300/25 bg-rose-300/10 px-4 text-sm font-bold text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> 다시 불러오기
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && !data && (
          <div role="status" aria-live="polite" className="flex min-h-64 items-center justify-center rounded-3xl border border-white/10 bg-[#181b22]">
            <div className="text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-violet-300" aria-hidden="true" />
              <p className="mt-3 text-sm text-slate-300">원본 자료를 안전하게 모으는 중…</p>
            </div>
          </div>
        )}

        {data && (
          <>
            <OwnerControllerSetupPanel />
            {data.partialErrors.length > 0 && (
              <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] px-3.5 py-3 text-xs leading-5 text-amber-100">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p><b>일부 자료를 확인하지 못했습니다.</b> 없는 자료로 계산하지 않았으며, 나머지 원본은 계속 표시합니다.</p>
              </div>
            )}

            <SectionJumpBar
              items={[
                { id: 'ops-summary', label: '요약' },
                { id: 'ops-queue', label: '긴급업무' },
                { id: 'ops-automation', label: '자동화' },
                { id: 'ops-reservation', label: '예약' },
                { id: 'ops-inbox', label: '문의' },
                { id: 'ops-source', label: '연결상태' },
              ]}
            />

            <section id="ops-summary" className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="운영 핵심 요약">
              <SummaryCard
                label="처리할 일"
                value={data.summary.actionRequired}
                detail={`즉시·우선 ${data.summary.urgent}건`}
                tone="rose"
                icon={AlertCircle}
              />
              <SummaryCard
                label="오늘 예약"
                value={data.summary.todayReservations}
                detail={`7일 안에 ${data.summary.upcoming7d}건`}
                tone="violet"
                icon={CalendarDays}
              />
              <SummaryCard
                label="미답변 문의"
                value={data.summary.openInquiries + data.summary.openCs}
                detail={`웹 ${data.summary.openInquiries} · CS ${data.summary.openCs}`}
                tone="sky"
                icon={Inbox}
              />
              <SummaryCard
                label="자동화 주의"
                value={data.summary.automationAttention}
                detail="재시도·자료 연결 포함"
                tone="amber"
                icon={TriangleAlert}
              />
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
              <WorkQueue items={visibleWorkItems} sectionId="ops-queue" />
              <AutomationPanel items={data.automation} sectionId="ops-automation" />
            </div>

            <ReservationsPanel reservations={data.reservations} sectionId="ops-reservation" />
            <InboxSummary summary={data.summary} sectionId="ops-inbox" />
            <SourceHealth data={data} sectionId="ops-source" />

            <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-slate-500">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              읽기 전용 화면 · 원본 예약·문의·결제 상태를 변경하지 않습니다.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
