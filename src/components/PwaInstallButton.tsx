import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, X, Smartphone, Trash2, Share } from 'lucide-react';
import type { Translations } from '@/i18n';

interface PwaInstallButtonProps {
  t: Translations;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaInstallButton({ t }: PwaInstallButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  const m = t.pwaInstall || {};

  useEffect(() => {
    // 이미 PWA로 실행 중이면 숨기기
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // iOS 감지
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

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
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setIsInstalled(true);
      setDeferredPrompt(null);
    }
    setShowModal(false);
  };

  return (
    <>
      {/* 다운로드 아이콘 버튼 */}
      <button
        onClick={() => setShowModal(true)}
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
            <div className="px-6 pb-5 space-y-2">
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
