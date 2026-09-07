import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, Download, RefreshCw, Smartphone } from 'lucide-react';
import type { Language } from '@/i18n';
import { ownerControllerSetupCopy } from './ownerControllerSetupCopy';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface DeferredInstallPromptWindow {
  __deferredInstallPrompt?: BeforeInstallPromptEvent | null;
}

function launchPath() {
  if (typeof window === 'undefined') return '';
  try {
    return sessionStorage.getItem('pwa_launch_path') || window.location.pathname;
  } catch {
    return window.location.pathname;
  }
}

function isStandalone() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(display-mode: standalone)').matches;
}

function isOwnerStandalone() {
  const ownerPath = launchPath().startsWith('/admin/ai-center') || launchPath().startsWith('/admin/preview-ai-center');
  return ownerPath && isStandalone();
}

function toSafeLower(value: string) {
  return String(value || '').toLowerCase();
}

export function OwnerControllerSetupPanel({ children, language = 'ko' }: { children?: ReactNode; language?: Language }) {
  const copy = ownerControllerSetupCopy[language];
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    if (typeof window === 'undefined') return null;
    return (window as unknown as DeferredInstallPromptWindow).__deferredInstallPrompt || null;
  });
  const [isInOtherPwa] = useState(() => isStandalone() && !isOwnerStandalone());
  const [isInstalled, setIsInstalled] = useState(isOwnerStandalone);
  const [isIos] = useState(() => typeof window !== 'undefined'
    && /iphone|ipad|ipod/i.test(toSafeLower(window.navigator.userAgent)));
  const [manualHint, setManualHint] = useState(false);
  const [status, setStatus] = useState<'ready' | 'installed' | 'declined' | 'failed'>('ready');
  const [isInstalling, setIsInstalling] = useState(false);
  const installing = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (isOwnerStandalone()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setManualHint(false);
      setStatus('ready');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const handleInstall = async () => {
    if (installing.current || isInstalled) return;
    if (!deferredPrompt) {
      setManualHint(true);
      return;
    }
    const prompt = deferredPrompt;
    installing.current = true;
    setIsInstalling(true);
    setManualHint(false);
    setStatus('ready');
    // The browser prompt can only be used once. Do not leave it available to a remount.
    const windowState = window as unknown as DeferredInstallPromptWindow;
    if (windowState.__deferredInstallPrompt === prompt) windowState.__deferredInstallPrompt = null;
    setDeferredPrompt(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (!mounted.current) return;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setStatus('installed');
      } else {
        setStatus('declined');
        setManualHint(true);
      }
    } catch {
      if (mounted.current) {
        setStatus('failed');
        setManualHint(true);
      }
    } finally {
      installing.current = false;
      if (mounted.current) setIsInstalling(false);
    }
  };

  const hasPrompt = Boolean(deferredPrompt);

  if (isInstalled) {
    return (
      <div className="space-y-2">
      <section className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] px-3 py-2">
        <p role="status" className="text-xs font-black text-emerald-100">{status === 'installed' ? copy.installAccepted : copy.installed}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/20 px-3 text-xs font-black text-white hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {copy.reload}
        </button>
      </section>
      {children}
      </div>
    );
  }

  return (
    <div className="space-y-2">
    <section className="rounded-3xl border border-emerald-300/20 bg-emerald-400/[0.06] p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-black text-white">{copy.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {copy.updateLine}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-300">
            {copy.installDetail}
          </p>
        </div>
        <span className="rounded-full border border-emerald-200/30 bg-emerald-200/10 px-2.5 py-1 text-[10px] font-black text-emerald-100">
          /admin/ai-center
        </span>
      </div>

      <div className="mt-3 space-y-2 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
          <p className="flex items-center gap-2 text-xs font-black text-slate-200">
            <Smartphone className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {copy.updateTitle}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {copy.updateDetail}
          </p>
          <button
            type="button"
            disabled={isInstalling}
            onClick={() => {
              if (window && 'location' in window) {
                window.location.reload();
              }
            }}
            className="mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/20 px-3 text-xs font-black text-white transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-50"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {copy.manualRefresh}
          </button>
        </div>

        {isInOtherPwa ? (
          <div className="space-y-2">
            <p className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-black text-amber-100">
              {copy.otherApp}
            </p>
            <p className="text-xs leading-5 text-slate-300">
              {copy.otherAppDetail}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {isInstalling && <p role="status" className="text-xs leading-5 text-slate-200">{copy.installing}</p>}
            {status === 'declined' && <p role="status" className="text-xs leading-5 text-amber-100">{copy.declined}</p>}
            {status === 'failed' && <p role="alert" className="text-xs leading-5 text-amber-100">{copy.failed}</p>}
            {manualHint ? (
              <p className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-xs leading-5 text-amber-100">
                <AlertCircle className="mr-1.5 h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
                {isIos
                  ? copy.iosManual
                  : copy.browserManual}
              </p>
            ) : null}
            <button
              type="button"
              onClick={handleInstall}
              disabled={isInstalled || isInstalling}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-emerald-400/90 px-4 text-sm font-black text-[#0f1320] transition-all hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-50"
              title={hasPrompt ? copy.install : copy.manualTitle}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {isInstalling ? copy.installing : hasPrompt ? copy.install : copy.showGuide}
            </button>
          </div>
        )}
      </div>
    </section>
    {children}
    </div>
  );
}
