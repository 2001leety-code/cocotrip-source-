import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, Smartphone, Trash2, Share, Bell, BellOff } from 'lucide-react';
import type { Translations } from '@/i18n';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { useAuth } from '@/hooks/useAuth';

interface PwaInstallButtonProps {
  t: Translations;
  /** 이 버튼이 설치를 담당하는 앱의 scope — '/'(코코트립, 기본) 또는 '/mood'(MOOD).
   *  같은 origin 에 PWA 가 2개(코코트립·MOOD)라, "앱으로 실행 중 = 숨김" 판정을
   *  '지금 실행된 앱이 이 버튼의 앱인가'로 정교화 (2026-07-05 — 코코트립 앱 안에서
   *  /mood 를 볼 때도 MOOD 설치 안내가 떠야 함). */
  appScope?: string;
  /** 다른 앱(standalone) 안에서 열렸을 때 보여줄 전용 설치 안내 문구. */
  browserOpenHint?: string;
}

/** 이번 실행이 어느 앱으로 켜졌는지 — main.tsx 가 첫 진입 경로를 기록. */
function launchPath(): string {
  try {
    return sessionStorage.getItem('pwa_launch_path') || window.location.pathname;
  } catch {
    return window.location.pathname;
  }
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaInstallButton({ t, appScope = '/', browserOpenHint }: PwaInstallButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInApp, setIsInApp] = useState(false); // 카톡·인스타 등 인앱 브라우저 — PWA 설치 이벤트 안 뜸
  const [inOtherApp, setInOtherApp] = useState(false); // 다른 PWA(예: 코코트립 앱) 안에서 열림 — 프롬프트 불가, 브라우저 안내
  const [showManual, setShowManual] = useState(false); // 설치 프롬프트 없을 때 수동 안내 노출
  const push = usePushSubscription();
  const { user } = useAuth();
  const [pushOn, setPushOn] = useState(false);

  // 모달 열 때 현재 push 상태 확인
  useEffect(() => {
    if (showModal && push.state === 'granted') {
      push.isEnabled().then(setPushOn);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, push.state]);

  const m = t.pwaInstall || {};

  useEffect(() => {
    // PWA(standalone)로 실행 중일 때 — "어느 앱으로 켜졌는지"까지 확인 (2026-07-05).
    // 첫 진입 경로가 /mood 면 MOOD 앱, 아니면 코코트립 앱 실행. 이 버튼의 앱이면 숨기고,
    // 다른 앱 안(예: 코코트립 앱에서 /mood 열람)이면 계속 노출해 전용 앱 설치를 안내.
    if (window.matchMedia('(display-mode: standalone)').matches) {
      const launchedMood = launchPath().startsWith('/mood');
      const buttonIsMood = appScope.startsWith('/mood');
      if (launchedMood === buttonIsMood) {
        setIsInstalled(true);
        return;
      }
      setInOtherApp(true); // standalone 안에선 설치 프롬프트 불가 — 브라우저로 열기 안내
    }

    // iOS 감지
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    // 인앱 브라우저(카톡·인스타·라인·페북 등) — 여기선 PWA 설치 이벤트가 원천적으로 안 떠서 수동 안내 필요.
    setIsInApp(/KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER\(inapp/i.test(navigator.userAgent));

    // index.html 에서 React 마운트 전에 미리 잡아둔 프롬프트가 있으면 사용 (이벤트 놓침 방지).
    const early = (window as unknown as { __deferredInstallPrompt?: BeforeInstallPromptEvent }).__deferredInstallPrompt;
    if (early) setDeferredPrompt(early);

    // Android/Chrome: beforeinstallprompt 캡처
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // 설치 완료 감지
    window.addEventListener('appinstalled', () => setIsInstalled(true));

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // 이미 설치했으면 버튼 숨기기
  if (isInstalled) return null;

  const handleInstall = async () => {
    const prompt = deferredPrompt
      || (window as unknown as { __deferredInstallPrompt?: BeforeInstallPromptEvent }).__deferredInstallPrompt;
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setIsInstalled(true);
      setDeferredPrompt(null);
      (window as unknown as { __deferredInstallPrompt?: BeforeInstallPromptEvent | null }).__deferredInstallPrompt = null;
      setShowModal(false);
    } else {
      // 프롬프트 없음(이벤트 미발화 / 이미 무시 / 미지원) → 모달 닫지 말고 수동 안내 노출.
      setShowManual(true);
    }
  };

  return (
    <>
      {/* 다운로드 아이콘 버튼 */}
      <button
        onClick={() => { setShowModal(true); setShowManual(false); }}
        className="p-1.5 rounded-lg transition-all duration-200 text-white/55 hover:text-white/80 hover:bg-white/[0.06] ml-1"
        title={m.modalTitle || 'Add to Home Screen'}
      >
        <Download className="w-4 h-4" />
      </button>

      {/* 안내 모달 (Portal로 body에 렌더) */}
      {showModal && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}
        >
          {/* 백드롭 */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowModal(false)} />

          {/* 모달 컨텐츠 */}
          <div
            className="relative w-full max-w-sm mx-3 mb-3 sm:mb-0 rounded-2xl overflow-hidden animate-[slideUp_0.3s_ease-out]"
            style={{
              background: 'linear-gradient(180deg, #12152a 0%, #0a0d1a 100%)',
              border: '1px solid rgba(182,104,252,0.2)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(182,104,252,0.1)',
            }}
          >
            <style>{`@keyframes slideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>

            {/* 닫기 */}
            <button
              onClick={() => setShowModal(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg text-white/55 hover:text-white/60 hover:bg-white/[0.06] transition-all z-10"
            >
              <X className="w-4 h-4" />
            </button>

            {/* 아이콘 + 타이틀 */}
            <div className="pt-7 pb-4 px-6 text-center">
              <div
                className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #B668FC, #FF6B9D)', boxShadow: '0 4px 20px rgba(182,104,252,0.3)' }}
              >
                <Smartphone className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-[18px] font-black text-white">
                {m.modalTitle || 'Add CocoTrip Shortcut'}
              </h3>
              <p className="text-[13px] text-white/55 mt-1.5 leading-relaxed">
                {m.modalDesc || 'Add a shortcut to your home screen for quick access like an app.'}
              </p>
            </div>

            {/* 안내 항목들 */}
            <div className="px-6 pb-3 space-y-2">
              {[
                { icon: Smartphone, text: m.featureNoInstall || 'No separate app install required' },
                { icon: Trash2, text: m.featureNoStorage || 'Does not take up storage space' },
                { icon: Share, text: m.featureShortcut || 'It\'s just a website shortcut' },
                { icon: X, text: m.featureDelete || 'Can be removed anytime' },
              ].map((item, i) => {
                const Icon = item.icon;
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]">
                    <Icon className="w-4 h-4 text-purple-400/70 shrink-0" />
                    <span className="text-[12px] text-white/50 font-medium">{item.text}</span>
                  </div>
                );
              })}
            </div>

            {/* 알림 받기 토글 — push 지원 환경에서만 노출 */}
            {push.state !== 'unsupported' && (
              <div className="px-6 pb-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (pushOn) { const ok = await push.disable(); if (ok) setPushOn(false); }
                    else { const ok = await push.enable(); if (ok) setPushOn(true); }
                  }}
                  disabled={push.busy || push.state === 'denied' || !user}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all disabled:opacity-50"
                  style={{
                    background: pushOn ? 'rgba(124,92,252,0.12)' : 'rgba(255,255,255,0.04)',
                    border: pushOn ? '1px solid rgba(124,92,252,0.35)' : '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    {pushOn ? <Bell className="w-4 h-4 text-[#B668FC]" /> : <BellOff className="w-4 h-4 text-white/55" />}
                    <div className="text-left">
                      <p className="text-[13px] font-bold text-white">
                        {pushOn ? (m.pushEnabledTitle || 'Notifications on') : (m.pushTitle || 'Get notified')}
                      </p>
                      <p className="text-[10px] text-white/55 leading-tight">
                        {!user
                          ? (m.pushSignInRequired || 'Sign in to receive notifications')
                          : push.state === 'denied'
                          ? (m.pushDenied || 'Blocked by browser — enable in site settings')
                          : (m.pushSub || 'Plan ready, booking updates, refunds')}
                      </p>
                    </div>
                  </div>
                  <div className={`w-9 h-5 rounded-full transition-colors ${pushOn ? 'bg-[#B668FC]' : 'bg-white/10'}`}>
                    <div
                      className="w-4 h-4 rounded-full bg-white shadow transition-transform mt-0.5"
                      style={{ transform: pushOn ? 'translateX(18px)' : 'translateX(2px)' }}
                    />
                  </div>
                </button>
                {isIOS && !isInstalled && (
                  <p className="text-[10px] text-amber-300/80 mt-2 text-center">
                    {m.pushIosHint || 'On iPhone: add to Home Screen first, then enable notifications inside the app'}
                  </p>
                )}
              </div>
            )}

            {/* CTA 버튼 */}
            <div className="px-6 pb-6 space-y-2">
              {isIOS ? (
                /* iOS: 수동 안내 */
                <div className="px-4 py-3.5 rounded-xl text-center" style={{ background: 'rgba(182,104,252,0.08)', border: '1px solid rgba(182,104,252,0.15)' }}>
                  <p className="text-[12px] text-white/60 leading-relaxed">
                    {m.iosGuide || 'Tap the Share button at the bottom of Safari, then select "Add to Home Screen"'}
                  </p>
                  <div className="flex items-center justify-center gap-2 mt-2">
                    <Share className="w-4 h-4 text-purple-400" />
                    <span className="text-[13px] font-bold text-purple-400">→</span>
                    <span className="text-[12px] font-bold text-purple-300">
                      {m.iosAddBtn || '"Add to Home Screen"'}
                    </span>
                  </div>
                </div>
              ) : inOtherApp ? (
                /* 다른 PWA(코코트립 앱 등) 안 — 프롬프트 불가 → 브라우저로 열어 설치 안내 */
                <div className="px-4 py-3.5 rounded-xl text-center" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <p className="text-[12px] text-white/70 leading-relaxed">
                    {browserOpenHint || (m as { otherAppHint?: string }).otherAppHint
                      || 'You are inside another app. Open this page in Chrome, then use menu (⋮) → "Add to Home screen" to install it as its own app.'}
                  </p>
                </div>
              ) : isInApp ? (
                /* 인앱 브라우저(카톡·인스타 등) — PWA 설치 불가 → 외부 브라우저로 열기 안내 */
                <div className="px-4 py-3.5 rounded-xl text-center" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <p className="text-[12px] text-white/70 leading-relaxed">
                    {(m as { inAppHint?: string }).inAppHint || 'In-app browsers (KakaoTalk, Instagram, etc.) cannot install apps. Open the menu and choose "Open in external browser" (Chrome / Samsung Internet), then try again.'}
                  </p>
                </div>
              ) : showManual ? (
                /* 설치 프롬프트 미발화 — 수동 안내 */
                <div className="px-4 py-3.5 rounded-xl text-center" style={{ background: 'rgba(182,104,252,0.08)', border: '1px solid rgba(182,104,252,0.15)' }}>
                  <p className="text-[12px] text-white/70 leading-relaxed">
                    {(m as { manualHint?: string }).manualHint || 'Open your browser menu and tap "Add to Home screen" or "Install app".'}
                  </p>
                </div>
              ) : (
                /* Android/Chrome: 자동 설치 */
                <button
                  onClick={handleInstall}
                  className="w-full py-3.5 rounded-xl text-[14px] font-bold text-white transition-all duration-300 hover:scale-[1.02] active:scale-95"
                  style={{
                    background: 'linear-gradient(135deg, #B668FC, #FF6B9D)',
                    boxShadow: '0 4px 20px rgba(182,104,252,0.3)',
                  }}
                >
                  {m.addBtn || 'Add to Home Screen'}
                </button>
              )}

              <button
                onClick={() => setShowModal(false)}
                className="w-full py-2.5 text-[13px] font-medium text-white/55 hover:text-white/55 transition-colors"
              >
                {m.closeBtn || 'Not now'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
