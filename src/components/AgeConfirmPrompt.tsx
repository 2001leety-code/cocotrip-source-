/**
 * AgeConfirmPrompt — 회원에게 "만 14세 이상입니다"를 한 번 확인받는다(2026-11-21 처리방침).
 * App 수준 1회 마운트. 로그인 함수(구글·LINE·애플·전화)는 건드리지 않고, 로그인이 끝난 뒤 users/{uid} 를 읽어
 * `ageOver14ConfirmedAt` 이 없으면 띄운다. 기존 회원도 한 번 묻는다.
 * - 확인 → POST /api/age-confirm(Admin SDK 로 저장). 저장되면 이 기기에 표시해 다시 읽지 않는다.
 * - "만 14세 미만" → 로그아웃만 한다(계정 삭제 없음: 어른이 잘못 눌러도 되돌릴 수 있게).
 * - users/{uid} 가 아직 없으면(가입 직후) 잠시 뒤 다시 읽는다 — 가입 기본값 저장보다 먼저 쓰지 않는다.
 * - 읽기·저장 실패는 로그인 흐름을 막지 않는다(다음에 다시 묻는다).
 */
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { authFetch } from '@/lib/authFetch';
import { signOutUser } from '@/lib/firebase-auth';

const OK_KEY_PREFIX = 'COCO_AGE14_OK:';
const DOC_RETRY_MS = 2000;
const DOC_RETRY_MAX = 6;
const SAVE_RETRY_MS = 1500;

function readOk(uid: string): boolean {
  try { return localStorage.getItem(OK_KEY_PREFIX + uid) === '1'; } catch { return false; }
}
function markOk(uid: string): void {
  try { localStorage.setItem(OK_KEY_PREFIX + uid, '1'); } catch { /* 저장 못 해도 서버 기록이 진실 */ }
}
const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export function AgeConfirmPrompt() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const ag = t.ageGate;
  const [askUid, setAskUid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [under14Notice, setUnder14Notice] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const uid = user && !user.isAnonymous ? user.uid : null;

  // 창은 askUid === 지금 uid 일 때만 열린다 → 계정이 바뀌면 예전 값은 저절로 무시된다(effect 안에서 지우지 않음).
  useEffect(() => {
    if (!uid || readOk(uid)) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    let tries = 0;
    const check = async () => {
      try {
        const [{ doc, getDoc }, { db }] = await Promise.all([import('firebase/firestore'), import('@/lib/firebase')]);
        const snap = await getDoc(doc(db, 'users', uid));
        if (cancelled) return;
        if (!snap.exists()) {
          if (++tries < DOC_RETRY_MAX) timer = window.setTimeout(check, DOC_RETRY_MS);
          return;
        }
        const at = (snap.data() || {}).ageOver14ConfirmedAt;
        if (typeof at === 'string' && at) { markOk(uid); return; }
        setError(false);
        setAskUid(uid);
      } catch {
        /* 읽기 실패 = 이번엔 묻지 않는다(로그인 흐름 무영향). 다음 로그인 때 다시 읽는다. */
      }
    };
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [uid]);

  const open = !!askUid && askUid === uid;
  useEffect(() => { if (open) confirmRef.current?.focus(); }, [open]);

  const confirm = async () => {
    if (!askUid) return;
    setBusy(true);
    setError(false);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await authFetch('/api/age-confirm', { method: 'POST' });
        if (r.ok) {
          markOk(askUid);
          setAskUid(null);
          setBusy(false);
          return;
        }
        if (r.status !== 409) break; // 409 = 가입 문서가 아직 없음 → 잠시 뒤 다시
      } catch { /* 네트워크 — 다시 시도 */ }
      await wait(SAVE_RETRY_MS);
    }
    setError(true);
    setBusy(false);
  };

  const declare14Under = async () => {
    setBusy(true);
    try { await signOutUser(); } catch { /* silent */ }
    setAskUid(null);
    setBusy(false);
    setUnder14Notice(true);
  };

  if (under14Notice && !uid) {
    return (
      <div
        className="ec-root ec-no-print fixed top-[calc(56px+env(safe-area-inset-top))] md:top-16 left-0 right-0 z-[10002] p-3 sm:p-4 pointer-events-none"
        role="region"
        aria-label={ag.title}
        data-testid="age-under14-notice"
      >
        <div className="pointer-events-auto max-w-2xl mx-auto bg-ec-raised border border-ec-line rounded-ec-md shadow-ec-overlay p-4 flex items-start gap-3">
          <p className="flex-1 text-[13px] sm:text-[14px] leading-relaxed text-ec-ink-2" role="status">{ag.under14Notice}</p>
          <button
            type="button"
            onClick={() => setUnder14Notice(false)}
            aria-label={ag.close}
            className="min-w-[44px] min-h-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-ec-sm text-ec-ink-3 hover:text-ec-ink hover:bg-ec-page"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  if (!open) return null;

  return (
    <div
      className="ec-root ec-no-print fixed inset-0 z-[10002] flex items-center justify-center p-4"
      style={{ background: 'rgba(20, 20, 26, 0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-confirm-title"
      aria-describedby="age-confirm-body"
      data-testid="age-confirm-prompt"
    >
      <div className="w-full max-w-md rounded-ec-md border border-ec-line bg-ec-raised shadow-ec-overlay p-6">
        <h2 id="age-confirm-title" className="ec-h3">{ag.title}</h2>
        <p id="age-confirm-body" className="ec-body-sm mt-2 text-ec-ink-2">{ag.body}</p>
        {error && <p className="mt-3 text-[13px] text-ec-critical" role="alert">{ag.error}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button ref={confirmRef} type="button" onClick={confirm} disabled={busy} className="ec-btn ec-btn-primary min-h-[44px]">
            {busy ? ag.saving : ag.confirm}
          </button>
          <button type="button" onClick={declare14Under} disabled={busy} className="ec-btn ec-btn-quiet min-h-[44px]">
            {ag.under14}
          </button>
        </div>
      </div>
    </div>
  );
}
