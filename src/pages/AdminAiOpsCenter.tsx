import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
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
import { useLanguage } from '@/hooks/useLanguage';
import type { Language } from '@/i18n';
import { adminAiOpsCopy } from '@/lib/adminAiOpsCopy';
import { OwnerControllerSetupPanel } from '@/components/OwnerControllerSetupPanel';
import { OwnerNotificationSetup } from '@/components/OwnerNotificationSetup';

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
const WORK_PAGE_SIZE = 10;
const RESERVATION_PAGE_SIZE = 30;

function useOpsCopy() {
  return adminAiOpsCopy[useLanguage().language];
}


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

function formatKst(value: string | number, locale: string) {
  if (!value) return '-';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 10) || '-';
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Seoul',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatTripDate(value: string, copy: ReturnType<typeof useOpsCopy>) {
  if (!value) return copy.dateUnknown;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(copy.locale, { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' }).format(date);
}

function ageLabel(hours: number, copy: ReturnType<typeof useOpsCopy>) {
  if (hours < 1) return copy.ageWithinHour;
  if (hours < 24) return copy.ageHours(hours);
  return copy.ageDays(Math.floor(hours / 24));
}

function workItemTitle(item: WorkItem, copy: ReturnType<typeof useOpsCopy>) {
  const isOutboundEmailRetry = item.type === 'automation'
    && item.workItemId === 'automation:email_retry'
    && item.sourceSystem === 'email_retry'
    && item.sourceRecordId === 'email_retry';
  if (!isOutboundEmailRetry) return item.title;
  // automationWorkItems supplies this suffix; preserve its count without recalculating it.
  const countSuffix = item.title.match(/^고객 이메일( · \d+건)$/)?.[1];
  return countSuffix ? `${copy.outboundEmailRetry}${countSuffix}` : item.title;
}

function reservationStatusLabel(status: string, copy: ReturnType<typeof useOpsCopy>) {
  const normalized = status.toLowerCase();
  const labels: Record<string, string> = copy.reservationLabels;
  return labels[normalized] || status || copy.statusUnknown;
}

function dispatchLabel(status: string, copy: ReturnType<typeof useOpsCopy>) {
  const normalized = status.toLowerCase();
  if (normalized === 'accepted') return copy.dispatchAccepted;
  if (normalized === 'not_required') return copy.dispatchNotRequired;
  if (normalized === 'rejected') return copy.dispatchRejected;
  return copy.dispatchUnknown;
}

function isExternal(url: string) {
  return /^https?:\/\//.test(url);
}

function SectionJumpBar({ items }: { items: { id: string; label: string }[] }) {
  const copy = useOpsCopy();
  return (
    <section className="rounded-3xl border border-white/10 bg-[#181b22] p-3 sm:p-4">
      <p className="sr-only">{copy.jumpTitle}</p>
      <nav
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label={copy.jumpLabel}
      >
        {items.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-slate-200 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
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
  failed,
}: {
  mode: 'server' | 'preview';
  lastFetchedAt: number | null;
  syncing: boolean;
  isPreview: boolean;
  failed: boolean;
}) {
  const copy = useOpsCopy();
  const updated = lastFetchedAt && Number.isFinite(lastFetchedAt) ? copy.updatedAt(formatKst(lastFetchedAt, copy.locale)) : copy.refreshPending;
  if (mode === 'preview' && lastFetchedAt == null) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-400">
        {copy.previewData}
      </div>
    );
  }

  return (
    <div role="status" className="rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-100">
      <p className="font-bold">{isPreview ? copy.previewMode : copy.serverMode}</p>
      <p className={`mt-0.5 text-xs ${failed ? 'text-rose-200' : 'text-slate-300'}`}>
        {syncing ? copy.refreshing : failed ? copy.refreshFailed : lastFetchedAt ? copy.refreshComplete : copy.refreshPending} · {updated}
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
  const copy = useOpsCopy();
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
      <p className="mt-2 text-2xl font-black text-white">{value}<span className="ml-0.5 text-sm font-semibold text-slate-300">{copy.countUnit}</span></p>
      <p className="mt-1 text-[11px] leading-5 text-slate-400">{detail}</p>
    </div>
  );
}

function WorkQueue({ items, sectionId }: { items: WorkItem[]; sectionId?: string }) {
  const copy = useOpsCopy();
  const [visibleCount, setVisibleCount] = useState(WORK_PAGE_SIZE);
  const remaining = Math.max(0, items.length - visibleCount);
  return (
    <section id={sectionId} className="min-w-0 scroll-mt-28 rounded-3xl border border-white/10 bg-[#181b22] p-4 sm:p-5" aria-labelledby="work-queue-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="work-queue-title" className="text-base font-extrabold text-white">{copy.workTitle}</h2>
          <p className="mt-1 text-xs text-slate-400">{copy.workDetail}</p>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-slate-200">
          {copy.count(items.length)}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="mt-4 flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-400/25 bg-emerald-400/[0.05] px-4 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-emerald-100">{copy.workEmpty}</p>
          <p className="mt-1 text-xs text-slate-400">{copy.workEmptyDetail}</p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {items.slice(0, visibleCount).map((item) => {
            const meta = PRIORITY_META[item.priority];
            return (
              <DeepLink
                key={item.workItemId}
                to={item.deepLink}
                className="group flex min-h-[60px] items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 transition-colors hover:border-violet-300/25 hover:bg-white/[0.05]"
              >
                <span className={`inline-flex shrink-0 items-center rounded-lg border px-2 py-1 text-[10px] font-black ${meta.className}`}>
                  {copy.priorityLabels[item.priority]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-100">{workItemTitle(item, copy)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                    <span>{item.nextAction}</span>
                    {item.ageHours > 0 && <span>· {ageLabel(item.ageHours, copy)}</span>}
                    {item.eventDate && <span>· {formatTripDate(item.eventDate, copy)}</span>}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5 group-hover:text-violet-200" aria-hidden="true" />
              </DeepLink>
            );
          })}
          {items.length > WORK_PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <p role="status" className="text-xs text-slate-300">{copy.shown(Math.min(visibleCount, items.length), items.length)}</p>
              <button type="button" disabled={remaining === 0}
                onClick={() => setVisibleCount((count) => count + WORK_PAGE_SIZE)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-violet-300/25 px-4 text-sm font-bold text-violet-200 hover:bg-white/[0.05] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
                {remaining ? copy.moreWork(Math.min(WORK_PAGE_SIZE, remaining)) : copy.allShown}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function AutomationPanel({ items, sectionId }: { items: AutomationItem[]; sectionId?: string }) {
  const copy = useOpsCopy();
  return (
    <section id={sectionId} className="scroll-mt-28 rounded-3xl border border-white/10 bg-[#181b22] p-4 sm:p-5" aria-labelledby="automation-title">
      <div>
        <h2 id="automation-title" className="text-base font-extrabold text-white">{copy.automationTitle}</h2>
        <p className="mt-1 text-xs text-slate-400">{copy.automationDetail}</p>
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
                  <span className="text-sm font-bold text-slate-100">{item.key === 'email_retry' ? copy.outboundEmailRetry : item.label}</span>
                  <span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.className}`}>{copy.automationLabels[item.status]}</span>
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
  const copy = useOpsCopy();
  const location = useLocation();
  const navigate = useNavigate();
  const requestedFilter = new URLSearchParams(location.search).get('period');
  const filter: ReservationFilter = requestedFilter === 'today' || requestedFilter === 'all' ? requestedFilter : 'week';
  const [visibleCount, setVisibleCount] = useState(RESERVATION_PAGE_SIZE);
  const setFilter = (next: ReservationFilter) => {
    const search = new URLSearchParams(location.search);
    search.set('period', next);
    setVisibleCount(RESERVATION_PAGE_SIZE);
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true, preventScrollReset: true });
  };
  const start = kstDayStart();
  const visible = useMemo(() => {
    // Preserve the existing server range: today plus the following seven KST days.
    const end = filter === 'today' ? start + 24 * 60 * 60 * 1000 : start + 8 * 24 * 60 * 60 * 1000;
    if (filter === 'all') return reservations;
    return reservations.filter((item) => item.tripAtMs >= start && item.tripAtMs < end);
  }, [filter, reservations, start]);
  const remaining = Math.max(0, visible.length - visibleCount);

  const filters: { key: ReservationFilter; label: string }[] = [
    { key: 'today', label: copy.today },
    { key: 'week', label: copy.week },
    { key: 'all', label: copy.allRecent },
  ];

  return (
    <section id={sectionId} className="min-w-0 scroll-mt-28 rounded-3xl border border-white/10 bg-[#181b22] p-4 sm:p-5" aria-labelledby="reservations-title">
      <div className="flex flex-col gap-3">
        <div>
          <h2 id="reservations-title" className="text-base font-extrabold text-white">{copy.reservationsTitle}</h2>
          <p className="mt-1 text-xs text-slate-400">{copy.reservationsDetail}</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-white/10 bg-[#111318] p-1" role="group" aria-label={copy.reservationFilterLabel}>
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`min-h-[44px] min-w-[44px] rounded-lg px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${
                filter === item.key ? 'bg-violet-500/25 text-white' : 'text-slate-400 hover:text-white'
              }`}
              aria-pressed={filter === item.key}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {filter === 'week' && <p className="mt-2 text-xs text-slate-300">{copy.weekDescription}</p>}

      {visible.length === 0 ? (
        <div className="mt-4 flex min-h-28 items-center justify-center rounded-2xl border border-dashed border-white/10 px-4 text-center text-sm text-slate-400">
          {copy.reservationsEmpty}
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {visible.slice(0, visibleCount).map((item) => (
            <DeepLink
              key={item.workItemId}
              to={item.deepLink}
              className="group grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 transition-colors hover:border-violet-300/25 hover:bg-white/[0.05]"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-black ${SOURCE_CLASSES[item.sourceSystem]}`}>
                    {item.sourceLabel}
                  </span>
                  <span className="truncate text-sm font-bold text-slate-100">{item.label}</span>
                  {item.isTest && <span className="shrink-0 text-[10px] font-bold text-amber-200">{copy.test}</span>}
                </span>
                <span className="mt-1 block truncate font-mono text-[11px] text-slate-400">{shortId(item.bookingRef)}</span>
              </span>
              <span className="justify-self-end text-right">
                <span className="block text-xs font-bold text-slate-200">{formatTripDate(item.tripAt, copy)}</span>
                <span className="mt-0.5 block text-[10px] text-slate-400">{copy.tripDate}</span>
              </span>
              <span className="col-span-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-bold text-slate-200">
                  {reservationStatusLabel(item.reservationStatus, copy)}
                </span>
                {item.sourceSystem === 'bookings' && (
                  <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${
                    item.dispatchStatus === 'accepted'
                      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                      : 'border-white/10 bg-white/[0.04] text-slate-400'
                  }`}>
                    {dispatchLabel(item.dispatchStatus, copy)}
                  </span>
                )}
                {item.actionRequired && (
                  <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${PRIORITY_META[item.priority].className}`}>
                    {item.nextAction}
                  </span>
                )}
              </span>
            </DeepLink>
          ))}
          {visible.length > RESERVATION_PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <p role="status" className="text-xs text-slate-300">{copy.shown(Math.min(visibleCount, visible.length), visible.length)}</p>
              <button type="button" disabled={remaining === 0}
                onClick={() => setVisibleCount((count) => count + RESERVATION_PAGE_SIZE)}
                className="min-h-[44px] min-w-[44px] rounded-xl border border-violet-300/25 px-4 text-sm font-bold text-violet-200 hover:bg-white/[0.05] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
                {remaining ? copy.moreReservations(Math.min(RESERVATION_PAGE_SIZE, remaining)) : copy.allShown}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function InboxSummary({ summary, sectionId }: { summary: OpsSummary; sectionId?: string }) {
  const copy = useOpsCopy();
  const entries = [
    { label: copy.webInquiries, count: summary.openInquiries, to: '/admin/claims', icon: Inbox },
    { label: copy.csInquiries, count: summary.openCs, to: '/admin/ops?tab=review', icon: Stethoscope },
    { label: copy.paymentReviews, count: summary.paymentReviews, to: '/admin/payment-reviews', icon: ShieldAlert },
  ];
  return (
    <section id={sectionId} className="grid scroll-mt-28 gap-2 sm:grid-cols-3" aria-label={copy.inboxLabel}>
      {entries.map((entry) => (
        <DeepLink
          key={entry.label}
          to={entry.to}
          className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-white/10 bg-[#181b22] px-4 py-3 hover:border-violet-300/25 hover:bg-white/[0.05]"
        >
          <entry.icon className="h-4 w-4 shrink-0 text-violet-200" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-slate-400">{entry.label}</span>
            <span className="mt-0.5 block text-base font-black text-white">{copy.count(entry.count)}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
        </DeepLink>
      ))}
    </section>
  );
}

function SourceHealth({ data, sectionId }: { data: OpsCenterData; sectionId?: string }) {
  const copy = useOpsCopy();
  return (
    <details id={sectionId} className="scroll-mt-28 rounded-2xl border border-white/10 bg-[#181b22] p-3.5 text-sm">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-sm font-bold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
        <span className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-violet-200" aria-hidden="true" />
          {copy.sourcesTitle}
        </span>
        <span className="text-xs font-medium text-slate-400">
          {data.partialErrors.length > 0 ? copy.sourceFailures(data.partialErrors.length) : copy.allSourcesResponded}
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
              {source.ok ? copy.sourceCount(source.count, source.possiblyTruncated) : copy.sourceFailed}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-400">
        {copy.sourceDetail(data.window.perSourceLimit, data.deduplication.removedMirrorCount)}
      </p>
    </details>
  );
}

interface AdminAiOpsCenterProps {
  previewData?: OpsCenterData;
  /** DEV fixture only; cannot override errors in the production request path. */
  previewFailure?: string;
}

export default function AdminAiOpsCenter({ previewData, previewFailure }: AdminAiOpsCenterProps = {}) {
  const { language, changeLanguage } = useLanguage();
  const copy = useOpsCopy();
  usePageMeta({ title: copy.pageTitle, description: copy.pageDescription });
  const { user } = useAuth();
  const [fetchedData, setData] = useState<OpsCenterData | null>(null);
  const data = previewData || fetchedData;
  const [loading, setLoading] = useState(false);
  const [requestError, setError] = useState<string | null>(null);
  const error = previewData ? previewFailure || null : requestError;
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
        throw new Error(payload.error || 'ops-load-failed');
      }
      if (isMountedRef.current) {
        setData(payload.data);
        setLastFetchedAt(Date.parse(payload.data.generatedAt));
      }
    } catch (loadError) {
      if (isMountedRef.current) {
        setError(loadError instanceof Error ? loadError.message || 'ops-load-failed' : 'ops-load-failed');
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

  const timestamp = previewData ? Date.parse(previewData.generatedAt) : lastFetchedAt;
  const visibleTimestamp = timestamp && Number.isFinite(timestamp) ? timestamp : null;
  const mode: 'server' | 'preview' = serverMode ? 'server' : 'preview';

  const visibleWorkItems = useMemo(() => data ? data.workItems.filter((item) => item.actionRequired) : [], [data]);

  return (
    <div className="min-h-screen bg-[#111318] text-slate-100" translate="no">
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#111318]/95 backdrop-blur">
        <div className="mx-auto flex min-h-[64px] w-full max-w-7xl items-center gap-2 px-3 py-2 sm:gap-3 sm:px-6 lg:px-8">
          <Link
            to="/admin"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            aria-label={copy.adminHome}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/20 text-violet-200 sm:flex">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-base font-black text-white sm:text-lg">{copy.title}</h1>
              <p className="truncate text-xs text-slate-400">{copy.subtitle}</p>
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { void load(); }}
              disabled={loading}
              aria-label={copy.refresh}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-bold text-slate-200 hover:bg-white/[0.08] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span className="hidden sm:inline">{copy.refresh}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:px-8">
        <RefreshBadge mode={mode} lastFetchedAt={visibleTimestamp} syncing={loading} isPreview={!serverMode} failed={Boolean(error)} />
        {error && (
          <div role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-400/10 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-rose-100">{data ? copy.staleTitle : copy.loadErrorTitle}</p>
                {data && <p className="mt-1 text-xs text-slate-200">{copy.staleDetail(visibleTimestamp ? formatKst(visibleTimestamp, copy.locale) : '-')}</p>}
                <p className="mt-1 break-words text-xs text-slate-300">{error === 'ops-load-failed' ? copy.loadError : error}</p>
                <button
                  type="button"
                  onClick={() => { void load(); }}
                  disabled={loading}
                  className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-rose-300/25 bg-rose-300/10 px-4 text-sm font-bold text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> {copy.retry}
                </button>
              </div>
            </div>
          </div>
        )}

        {loading && !data && (
          <div role="status" aria-live="polite" className="flex min-h-64 items-center justify-center rounded-3xl border border-white/10 bg-[#181b22]">
            <div className="text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-violet-300" aria-hidden="true" />
              <p className="mt-3 text-sm text-slate-300">{copy.loading}</p>
            </div>
          </div>
        )}

        {data && (
          <>
            {data.partialErrors.length > 0 && (
              <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.08] px-3.5 py-3 text-xs leading-5 text-amber-100">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p><b>{copy.partialErrorTitle}</b> {copy.partialErrorDetail}</p>
              </div>
            )}

            <SectionJumpBar
              items={[
                { id: 'ops-summary', label: copy.summary },
                { id: 'ops-queue', label: copy.urgentWork },
                { id: 'ops-reservation', label: copy.reservations },
                { id: 'ops-inbox', label: copy.inquiries },
                { id: 'ops-automation', label: copy.automation },
                { id: 'ops-source', label: copy.connections },
                { id: 'ops-settings', label: copy.settings },
              ]}
            />

            <section id="ops-summary" className="grid scroll-mt-28 grid-cols-2 gap-2 sm:grid-cols-4" aria-label={copy.summaryLabel}>
              <SummaryCard
                label={copy.actionRequired}
                value={data.summary.actionRequired}
                detail={copy.urgentCount(data.summary.urgent)}
                tone="rose"
                icon={AlertCircle}
              />
              <SummaryCard
                label={copy.todayReservations}
                value={data.summary.todayReservations}
                detail={copy.upcomingCount(data.summary.upcoming7d)}
                tone="violet"
                icon={CalendarDays}
              />
              <SummaryCard
                label={copy.unansweredInquiries}
                value={data.summary.openInquiries + data.summary.openCs}
                detail={copy.inquiryCounts(data.summary.openInquiries, data.summary.openCs)}
                tone="sky"
                icon={Inbox}
              />
              <SummaryCard
                label={copy.automationAttention}
                value={data.summary.automationAttention}
                detail={copy.automationAttentionDetail}
                tone="amber"
                icon={TriangleAlert}
              />
            </section>

            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <WorkQueue items={visibleWorkItems} sectionId="ops-queue" />
              <ReservationsPanel reservations={data.reservations} sectionId="ops-reservation" />
            </div>

            <InboxSummary summary={data.summary} sectionId="ops-inbox" />
            <AutomationPanel items={data.automation} sectionId="ops-automation" />
            <SourceHealth data={data} sectionId="ops-source" />

            <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-[11px] text-slate-500">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {copy.readOnly}
            </p>
          </>
        )}
        {serverMode && <OwnerNotificationSetup />}
        <details id="ops-settings" className="scroll-mt-28 rounded-2xl border border-white/10 bg-[#181b22] p-3.5">
          <summary className="flex min-h-[44px] cursor-pointer items-center rounded-lg text-sm font-bold text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
            {copy.setupTitle}
          </summary>
          <label className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-200">
            {copy.language}
            <select value={language} onChange={(event) => changeLanguage(event.target.value as Language)}
              className="min-h-[44px] min-w-[44px] rounded-lg border border-white/20 bg-[#111318] px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">
              <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option>
            </select>
          </label>
          <div className="mt-3"><OwnerControllerSetupPanel language={language} /></div>
        </details>
      </main>
    </div>
  );
}
