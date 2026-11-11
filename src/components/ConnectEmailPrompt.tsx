/**
 * ConnectEmailPrompt — 이메일 없는 회원(전화 가입·이메일 없는 LINE)에게 구글 계정 연결을 권하는 상단 안내.
 * App 수준 1회 마운트. 익명·비로그인·이메일 보유 회원에겐 아무것도 그리지 않는다.
 * 닫으면 그 세션 동안 숨김(sessionStorage). 쿠폰 사용 지점이 `requestEmailConnection()` 을 보내면 다시 뜬다.
 * 연결 성공 → 새로고침 없이 현재 화면 유지. linkGoogleAccount 가 프로필 갱신 이벤트를 보내 useAuth 사용처가
 *   새 email 로 다시 그려지고, 이 배너는 짧은 완료 문구 뒤 사라진다.
 * 위치: 헤더(h-14/md:h-16) 바로 아래 상단 띠 — 하단 쿠키 배너·모바일 하단 고정 결제 버튼과 겹치지 않게.
 * 스타일은 CookieBanner 와 같은 editorial(ec-*) 토큰.
 */
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { linkGoogleAccount, signInWithGoogle, signOutUser } from '@/lib/firebase-auth';
import { CONNECT_EMAIL_EVENT, needsEmailConnection } from '@/lib/connectEmail';

const DISMISS_KEY = 'COCO_CONNECT_EMAIL_DISMISSED';
const CONNECTED_MS = 4000;
type Notice = null | 'connecting' | 'connected' | 'alreadyInUse' | 'popupBlocked' | 'noEmail' | 'failed';

function readDismissed(): boolean {
  try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function ConnectEmailPrompt() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const ce = t.connectEmail;
  const [dismissed, setDismissed] = useState(readDismissed);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const reopen = () => {
      try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* silent */ }
      setDismissed(false);
      setNotice((n) => (n === 'connecting' ? n : null));
    };
    window.addEventListener(CONNECT_EMAIL_EVENT, reopen);
    return () => window.removeEventListener(CONNECT_EMAIL_EVENT, reopen);
  }, []);

  useEffect(() => {
    if (notice !== 'connected') return undefined;
    const id = window.setTimeout(() => setNotice(null), CONNECTED_MS);
    return () => window.clearTimeout(id);
  }, [notice]);

  const dismiss = useCallback(() => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* silent */ }
    setDismissed(true);
    setNotice((n) => (n === 'connecting' ? n : null));
  }, []);

  const connect = useCallback(async () => {
    setNotice('connecting');
    const r = await linkGoogleAccount();
    if (r.ok) setNotice('connected');
    else if (r.code === 'cancelled') setNotice(null);
    else if (r.code === 'already-in-use') setNotice('alreadyInUse');
    else if (r.code === 'popup-blocked') setNotice('popupBlocked');
    else if (r.code === 'no-email') setNotice('noEmail');
    else setNotice('failed');
  }, []);

  // 보조 동작: 지금 계정(쿠폰·일정)을 떠나 이미 가입된 구글 계정으로 들어간다. 병합 없음.
  const signInInstead = useCallback(async () => {
    try {
      await signOutUser();
      await signInWithGoogle();
    } catch {
      setNotice('failed');
    }
  }, []);

  const connected = notice === 'connected';
  if (dismissed || (!connected && !needsEmailConnection(user))) return null;
  const busy = notice === 'connecting';
  const message = notice && notice !== 'connecting' ? ce[notice] : ce.body;

  return (
    <div
      className="ec-root ec-no-print fixed top-[calc(56px+env(safe-area-inset-top))] md:top-16 left-0 right-0 z-[9998] p-3 sm:p-4 pointer-events-none"
      role="region"
      aria-label={ce.region}
      data-testid="connect-email-prompt"
    >
      <div className="pointer-events-auto max-w-2xl mx-auto bg-ec-raised border border-ec-line rounded-ec-md shadow-ec-overlay p-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] sm:text-[14px] leading-relaxed text-ec-ink-2" role="status" aria-live="polite">{message}</p>
            {!connected && (
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button type="button" onClick={connect} disabled={busy} className="ec-btn ec-btn-primary ec-btn-sm min-h-[44px]">
                  {busy ? ce.connecting : notice === 'alreadyInUse' ? ce.connectOther : ce.connect}
                </button>
                {notice === 'alreadyInUse' && (
                  <button type="button" onClick={signInInstead} className="ec-btn ec-btn-quiet ec-btn-sm min-h-[44px]">
                    {ce.signInGoogle}
                  </button>
                )}
              </div>
            )}
            {notice === 'alreadyInUse' && (
              <p className="mt-2 text-[12px] leading-relaxed text-ec-ink-3">{ce.signInWarning}</p>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={ce.dismiss}
            className="min-w-[44px] min-h-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-ec-sm text-ec-ink-3 transition-colors duration-ec-base ease-ec-standard hover:text-ec-ink hover:bg-ec-page"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
