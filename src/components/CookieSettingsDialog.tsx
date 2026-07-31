/**
 * 쿠키·분석 설정 패널 (2026-07-30, P1-1).
 *
 * 🔴 고친 문제: 배너에는 "동의" 와 "닫기" 밖에 없었고, 한 번 선택하면 **다시 바꿀 방법이 없었다**.
 *   `revoked` 상태는 코드에만 존재하고 화면에서 도달할 수 없었다 — 즉 "동의 철회" 는 구현돼
 *   있지만 사용자는 쓸 수 없는 기능이었다.
 *
 * 여기서 고르는 값이 곧 `lib/consent` 의 상태다:
 *   accepted  → GA4·PostHog 전송
 *   dismissed → 수집 안 함
 *   revoked   → 수집 중단 + `ga-disable-*` 활성 + 저장된 UTM 삭제(lib/analytics)
 *
 * 이 컴포넌트는 `CookieSettings` 가 **필요할 때만** 불러온다(첫 페인트 예산 보호).
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { readConsent, setConsent, type ConsentChoice, type ConsentState } from '@/lib/consent';

type Labels = Record<string, string>;

const OPTIONS: ReadonlyArray<{ value: ConsentChoice; labelKey: string; hintKey: string }> = [
  { value: 'accepted', labelKey: 'optAccepted', hintKey: 'optAcceptedHint' },
  { value: 'dismissed', labelKey: 'optDismissed', hintKey: 'optDismissedHint' },
  { value: 'revoked', labelKey: 'optRevoked', hintKey: 'optRevokedHint' },
];

export default function CookieSettingsDialog({ labels, onClose }: { labels: Labels; onClose: () => void }) {
  const [current, setCurrent] = useState<ConsentState>(() => readConsent());
  const [saved, setSaved] = useState(false);

  // Esc 로 닫기 — 모달 안에 갇히지 않게.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function choose(value: ConsentChoice) {
    setConsent(value);          // 저장 + 같은 탭 구독자(GA4·PostHog·UTM)에게 즉시 통지
    setCurrent(value);
    setSaved(true);
  }

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={labels.settingsTitle}
      onClick={onClose}
    >
      <div
        data-testid="cookie-settings-dialog"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#1a1b2e] p-4 shadow-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-sm font-bold text-white sm:text-base">{labels.settingsTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={labels.settingsClose}
            className="-mr-1 -mt-1 flex min-h-[44px] min-w-[44px] items-center justify-center text-white/70 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-3 text-xs leading-relaxed text-white/70">{labels.settingsBody}</p>

        <div className="space-y-2">
          {OPTIONS.map((o) => {
            const active = current === o.value;
            return (
              <button
                key={o.value}
                type="button"
                data-testid={`cookie-consent-${o.value}`}
                aria-pressed={active}
                onClick={() => choose(o.value)}
                className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  active
                    ? 'border-[#B668FC]/60 bg-[#B668FC]/12'
                    : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-white">{labels[o.labelKey]}</span>
                  {active && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#B668FC]">
                      {labels.settingsCurrent}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-white/55">
                  {labels[o.hintKey]}
                </span>
              </button>
            );
          })}
        </div>

        {saved && (
          <p data-testid="cookie-settings-saved" className="mt-3 text-center text-[11px] text-emerald-300">
            {labels.settingsSaved}
          </p>
        )}
      </div>
    </div>
  );
}
