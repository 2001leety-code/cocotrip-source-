// Registration requests activation; our live guard alone authorizes reload.
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useLanguage } from '@/hooks/useLanguage';
import { usePwaUpdateGuard } from '@/hooks/usePwaUpdateGuard';
import type { PwaUpdateState } from '@/lib/pwaUpdateGuard';
import { RefreshCw, X } from 'lucide-react';

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.matchMedia?.('(display-mode: standalone)').matches
    || (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}
const COPY = {
  ko: { protected: '작성·결제를 마친 뒤 업데이트하세요.', failed: '업데이트를 적용하지 못했습니다. 다시 시도해 주세요.', updating: '적용 중', dismiss: '업데이트 안내 닫기' },
  en: { protected: 'Finish editing or paying before updating.', failed: 'The update could not be applied. Please try again.', updating: 'Updating', dismiss: 'Dismiss update notice' },
  ja: { protected: '入力やお支払いを終えてから更新してください。', failed: '更新を適用できませんでした。もう一度お試しください。', updating: '更新中', dismiss: '更新のお知らせを閉じる' },
  zh: { protected: '请完成填写或付款后再更新。', failed: '无法应用更新，请重试。', updating: '更新中', dismiss: '关闭更新提示' },
};
export function PWAUpdatePromptView({ needRefresh, state, standalone, onUpdate }: {
  needRefresh: boolean; state: PwaUpdateState; standalone: boolean; onUpdate: () => void;
}) {
  const { t, language } = useLanguage();
  const copy = COPY[language] || COPY.en;
  const [dismissed, setDismissed] = useState(false);
  // X hides the notice for five minutes; it does not unregister the update.
  useEffect(() => {
    if (!dismissed) return;
    const timer = setTimeout(() => setDismissed(false), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [dismissed]);
  // Existing policy: notices are for installed apps, not ordinary browser tabs.
  if (!standalone || (!needRefresh && !state.ready) || dismissed || state.reloaded) return null;
  if (!state.deferred) return null;
  const message = (t.pwa as { updateAvailable?: string })?.updateAvailable || '새 버전이 있습니다';
  const refreshLabel = (t.pwa as { refresh?: string })?.refresh || '새 버전 업데이트';
  return (
    <div className="fixed left-1/2 -translate-x-1/2 z-[10000] w-[calc(100%-32px)] max-w-md border border-purple-400/40 bg-slate-900 px-4 py-3 rounded-2xl shadow-2xl flex items-start gap-3"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)' }}
      role="status" aria-live="polite">
      <RefreshCw className="mt-1 w-4 h-4 text-white shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">{message}</p>
        <p className="mt-1 text-xs text-white">{state.reason === 'failed' || state.reason === 'expired' ? copy.failed : copy.protected}</p>
        <button onClick={onUpdate} disabled={state.busy}
          className="mt-2 min-h-[44px] px-3 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
          {state.busy ? copy.updating : refreshLabel}
        </button>
      </div>
      <button onClick={() => setDismissed(true)} aria-label={copy.dismiss}
        className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md hover:bg-white/15 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
export function PWAUpdatePrompt() {
  const { guard, state } = usePwaUpdateGuard();
  const [standalone] = useState(isStandalone);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onNeedReload: guard.onNeedReload,
    onRegistered(r) { if (r) console.log('[PWA] SW registered:', r.scope); },
    onRegisterError() { console.warn('[PWA] SW registration failed'); },
  });
  useEffect(() => { if (needRefresh) return guard.scheduleAutomatic(updateServiceWorker); }, [guard, needRefresh, updateServiceWorker]);
  return <PWAUpdatePromptView needRefresh={needRefresh} state={state} standalone={standalone}
    onUpdate={() => { void guard.requestManual(updateServiceWorker); }} />;
}
