import { useEffect, useState } from 'react';
import { AlertCircle, Download, RefreshCw, Smartphone } from 'lucide-react';

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

function isOwnerStandalone() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const ownerPath = launchPath().startsWith('/admin/ai-center') || launchPath().startsWith('/admin/preview-ai-center');
  return ownerPath && window.matchMedia('(display-mode: standalone)').matches;
}

function toSafeLower(value: string) {
  return String(value || '').toLowerCase();
}

export function OwnerControllerSetupPanel() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInOtherPwa, setIsInOtherPwa] = useState(false);
  const [isInstalled, setIsInstalled] = useState(isOwnerStandalone);
  const [isIos, setIsIos] = useState(false);
  const [manualHint, setManualHint] = useState(false);
  const [status, setStatus] = useState<'ready' | 'installed' | 'declined'>('ready');

  useEffect(() => {
    const runningOwnerPath = launchPath().startsWith('/admin/ai-center') || launchPath().startsWith('/admin/preview-ai-center');
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    if (standalone) {
      if (runningOwnerPath) {
        setIsInstalled(true);
        return;
      }
      setIsInOtherPwa(true);
    }

    setIsIos(/iphone|ipad|ipod/i.test(toSafeLower(window.navigator.userAgent)));
    setStatus('ready');

    const windowState = window as unknown as DeferredInstallPromptWindow;
    const early = windowState.__deferredInstallPrompt;
    if (early) setDeferredPrompt(early);

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setManualHint(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) {
      setManualHint(true);
      return;
    }
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setStatus('installed');
      } else {
        setStatus('declined');
      }
    } finally {
      const windowState = window as unknown as DeferredInstallPromptWindow;
      windowState.__deferredInstallPrompt = null;
      setDeferredPrompt(null);
    }
  };

  const hasPrompt = Boolean(deferredPrompt);
  const updateLine = status === 'declined'
    ? '설치가 취소되었습니다. 필요하면 뒤로 가서 다시 시도해 주세요.'
    : '웹 앱은 배포 후 PWA 업데이트 토스트 또는 새로고침으로 최신 버전을 반영합니다.';

  if (isInstalled) {
    return (
      <section className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.06] px-3 py-2">
        <p className="text-xs font-black text-emerald-100">Control 설치됨 · 최신 확인</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/20 px-3 text-xs font-black text-white hover:bg-white/[0.08]"
        >
          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          새로고침
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-3xl border border-emerald-300/20 bg-emerald-400/[0.06] p-3.5 sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-black text-white">오너 컨트롤러 설치</h2>
          <p className="mt-1 text-[11px] text-slate-400">
            {updateLine}
          </p>
          <p className="mt-2 text-[11px] text-slate-300">
            기기에서 바로 열리려면 Chrome으로 설치하세요. 설치 후 변경사항은 앱 내 업데이트 알림 + 새 배포 반영으로 유지됩니다.
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
            자동 업데이트
          </p>
          <p className="mt-1 text-[11px] leading-5 text-slate-300">
            쿠키/계정/작업 상태가 안전한 경로에서는 자동 반영이 동작하며, 수동 확인은 아래 버튼을 눌러 새로고침하세요.
          </p>
          <button
            type="button"
            onClick={() => {
              if (window && 'location' in window) {
                window.location.reload();
              }
            }}
            className="mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/20 px-3 text-xs font-black text-white transition-colors hover:bg-white/[0.08]"
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            웹 버전 수동 확인
          </button>
        </div>

        {isInOtherPwa ? (
          <div className="space-y-2">
            <p className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 text-xs font-black text-amber-100">
              다른 앱에서 열고 있음 — 브라우저에서 열고 설치하세요
            </p>
            <p className="text-[11px] text-slate-300">
              Chrome(또는 삼성 인터넷)로 /admin/ai-center를 열어 설치 버튼을 확인하세요.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {manualHint ? (
              <p className="inline-flex min-h-[44px] min-w-[44px] items-center rounded-lg border border-white/10 bg-white/[0.05] px-3 text-[11px] text-amber-100">
                <AlertCircle className="mr-1.5 h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
                {isIos
                  ? 'iPhone은 공유 버튼 > “홈 화면에 추가”로 설치하세요.'
                  : '브라우저 메뉴(⋮) > “홈 화면에 추가” 또는 “앱 설치”로 설치하세요.'}
              </p>
            ) : null}
            <button
              type="button"
              onClick={handleInstall}
              disabled={isInstalled}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-emerald-400/90 px-4 text-sm font-black text-[#0f1320] transition-all hover:bg-emerald-300 disabled:opacity-50"
              title={hasPrompt ? 'CocoTrip Control 설치' : '수동 설치 안내'}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden="true" />
              {hasPrompt ? 'CocoTrip Control 설치' : '설치 안내 보기'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
