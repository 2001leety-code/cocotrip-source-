import type { ReactNode } from 'react';
import { AlertCircle, Check, Inbox } from 'lucide-react';

/**
 * The four states every screen ends up needing: loading, empty, error, done.
 *
 * Korea Editorial Concierge (2026-08-10). Today each page invents its own —
 * eleven different spinners, empty screens that dead-end with no action, errors
 * that print a stack. These are the shared shapes; callers adopt them as their
 * page is converted.
 *
 * Scope note: nothing here is wired into the payment, refund or booking-gate
 * flows. Those screens carry money semantics and are changed only in a PR that
 * is reviewed for money safety (see the `cocotrip-money-safety` rules).
 *
 * All four are presentational — no data fetching, no routing, no side effects.
 */

/* ── Loading ────────────────────────────────────────────────────────────── */

/** A single skeleton bar. Sized by the caller so the placeholder matches the
 *  real content's box — a skeleton that does not match causes a layout jump. */
export function EcSkeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-ec-xs bg-ec-sunken ${className}`}
    />
  );
}

/**
 * Loading region. `label` is what a screen reader announces; keep it specific
 * ("Loading your plans"), never "Loading".
 */
export function EcLoading({
  label,
  lines = 3,
  className = '',
}: {
  label: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <EcSkeleton className="h-6 w-1/2" />
      <span className="mt-4 block space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <EcSkeleton key={i} className={`h-4 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
        ))}
      </span>
    </div>
  );
}

/* ── Shared frame for the three terminal states ─────────────────────────── */

function StateFrame({
  icon,
  tone,
  title,
  body,
  actions,
  live,
}: {
  icon: ReactNode;
  tone: string;
  title: string;
  body?: string;
  actions?: ReactNode;
  live?: 'polite' | 'assertive';
}) {
  return (
    <div
      role={live ? 'status' : undefined}
      aria-live={live}
      className="ec-root flex min-h-[240px] flex-col items-start justify-center px-6 py-10 text-left"
    >
      <span className={tone} aria-hidden>{icon}</span>
      <h2 className="ec-h3 mt-4">{title}</h2>
      {body && <p className="ec-body-sm ec-measure mt-2">{body}</p>}
      {actions && <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}

/* ── Empty ──────────────────────────────────────────────────────────────── */

/**
 * Nothing here yet. An empty screen is an invitation, so it always offers the
 * action that fills it — never a dead end.
 */
export function EcEmpty({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <StateFrame
      icon={<Inbox className="h-7 w-7" />}
      tone="text-ec-ink-3"
      title={title}
      body={body}
      actions={action}
    />
  );
}

/* ── Error ──────────────────────────────────────────────────────────────── */

/**
 * Something failed. Say what happened and what to do about it, in the
 * interface's voice. Never a stack trace, never a bare status code, never
 * without a way forward.
 */
export function EcError({
  title,
  body,
  retryLabel,
  onRetry,
  secondary,
}: {
  title: string;
  body?: string;
  retryLabel?: string;
  onRetry?: () => void;
  secondary?: ReactNode;
}) {
  return (
    <StateFrame
      icon={<AlertCircle className="h-7 w-7" />}
      tone="text-ec-critical"
      title={title}
      body={body}
      live="assertive"
      actions={
        <>
          {onRetry && retryLabel && (
            <button type="button" onClick={onRetry} className="ec-btn ec-btn-secondary">
              {retryLabel}
            </button>
          )}
          {secondary}
        </>
      }
    />
  );
}

/* ── Done ───────────────────────────────────────────────────────────────── */

/**
 * Finished. The heading repeats the verb the user pressed ("Publish" →
 * "Published") so the flow reads as one continuous action.
 */
export function EcDone({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <StateFrame
      icon={<Check className="h-7 w-7" />}
      tone="text-ec-success"
      title={title}
      body={body}
      live="polite"
      actions={action}
    />
  );
}
