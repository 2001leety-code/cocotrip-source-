import type { ReactNode } from 'react';
import { EcEmpty, EcError, EcLoading } from '@/components/ui/states';

export type PlanDocumentStateKind = 'loading' | 'empty' | 'error' | 'not-found' | 'permission' | 'session' | 'partial';

interface PlanDocumentStateProps {
  kind: PlanDocumentStateKind;
  ui: Record<string, string>;
  onRetry?: () => void;
  action?: ReactNode;
  secondary?: ReactNode;
  busy?: boolean;
  title?: string;
  body?: string;
}

export function PlanDocumentState({
  kind,
  ui,
  onRetry,
  action,
  secondary,
  busy = false,
  title,
  body,
}: PlanDocumentStateProps) {
  const testId = `plan-detail-${kind}`;

  if (kind === 'loading') {
    return (
      <main data-testid={testId} className="ec-container py-12 md:py-20">
        <div className="ec-card">
          <EcLoading label={ui.loadingPlan} lines={7} />
        </div>
      </main>
    );
  }

  if (kind === 'partial') {
    return (
      <aside data-testid={testId} className="ec-card" role="status" aria-live="polite" aria-busy={busy || undefined}>
        <p className="ec-eyebrow text-ec-brand">{title || ui.documentPartial}</p>
        <p className="ec-body-sm mt-2">{body || ui.partialPlanBody}</p>
        {busy && <EcLoading label={ui.partialPlanBody} lines={2} className="mt-5" />}
        {action && <div className="mt-5">{action}</div>}
      </aside>
    );
  }

  if (kind === 'empty' || kind === 'not-found') {
    return (
      <main data-testid={testId} className="ec-container py-12 md:py-20">
        <EcEmpty
          title={title || (kind === 'not-found' ? ui.planNotFound : ui.emptyPlanTitle)}
          body={body || (kind === 'not-found' ? ui.planNotFoundDesc : ui.emptyPlanBody)}
          action={action}
        />
      </main>
    );
  }

  const defaultTitle = kind === 'permission'
    ? ui.accessDenied
    : kind === 'session'
      ? ui.sessionExpiredTitle
      : ui.planErrorTitle;
  const defaultBody = kind === 'permission'
    ? ui.accessDeniedDesc
    : kind === 'session'
      ? ui.sessionExpiredBody
      : ui.planErrorDesc;

  return (
    <main data-testid={testId} className="ec-container py-12 md:py-20">
      <EcError
        title={title || defaultTitle}
        body={body || defaultBody}
        retryLabel={onRetry ? ui.refreshPage : undefined}
        onRetry={onRetry}
        secondary={action || secondary ? <>{action}{secondary}</> : undefined}
      />
    </main>
  );
}
