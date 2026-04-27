// usePushSubscription — Web Push 권한 요청 + Service Worker subscribe + Firestore 저장.
// Cocotrip plan-ready 알림용. iOS 16.4+ 는 PWA 홈 화면 추가 후에만 동작.
import { useEffect, useState, useCallback } from 'react';
import { doc, setDoc, deleteDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './useAuth';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

type PushState = 'unsupported' | 'denied' | 'default' | 'granted';

/** Base64 URL → Uint8Array (web-push VAPID 키 변환). */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function usePushSubscription() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>('default');
  const [busy, setBusy] = useState(false);

  // 초기 권한 상태 확인
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported');
      return;
    }
    setState(Notification.permission as PushState);
  }, []);

  /** 권한 요청 + subscription 저장. 이미 granted면 subscription만 갱신/저장. */
  const enable = useCallback(async (): Promise<boolean> => {
    if (state === 'unsupported' || !user?.uid) return false;
    if (!VAPID_PUBLIC_KEY) {
      console.error('[push] VITE_VAPID_PUBLIC_KEY not set');
      return false;
    }
    setBusy(true);
    try {
      // 권한 요청 (이미 granted면 즉시 반환)
      const perm = await Notification.requestPermission();
      setState(perm as PushState);
      if (perm !== 'granted') return false;

      // SW가 등록 안 됐으면 대기
      const reg = await navigator.serviceWorker.ready;

      // 기존 subscription 재사용 또는 새로 발급
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        // applicationServerKey는 BufferSource 타입 (ArrayBuffer 기반).
        // 새 ArrayBuffer로 복사해서 SharedArrayBuffer 호환성 이슈 회피.
        const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        const buf = new ArrayBuffer(key.byteLength);
        new Uint8Array(buf).set(key);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: buf,
        });
      }

      // Firestore에 저장 — uid + endpoint 기반 키 (한 사용자가 여러 디바이스 가능)
      const subJson = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const endpoint = subJson.endpoint || '';
      const subId = btoa(endpoint).slice(-32);  // Firestore doc id 길이 제한 회피
      await setDoc(doc(db, 'push_subscriptions', `${user.uid}_${subId}`), {
        uid: user.uid,
        endpoint,
        keys: subJson.keys || {},
        userAgent: navigator.userAgent,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (err) {
      console.error('[push] enable failed', err);
      return false;
    } finally {
      setBusy(false);
    }
  }, [state, user]);

  /** 알림 끄기 — Firestore subscription 삭제 + SW unsubscribe. */
  const disable = useCallback(async (): Promise<boolean> => {
    if (!user?.uid) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const subJson = sub.toJSON() as { endpoint?: string };
        const subId = btoa(subJson.endpoint || '').slice(-32);
        await deleteDoc(doc(db, 'push_subscriptions', `${user.uid}_${subId}`));
        await sub.unsubscribe();
      }
      return true;
    } catch (err) {
      console.error('[push] disable failed', err);
      return false;
    } finally {
      setBusy(false);
    }
  }, [user]);

  /** 현재 사용자가 subscription 등록돼 있는지 확인. */
  const isEnabled = useCallback(async (): Promise<boolean> => {
    if (state !== 'granted' || !user?.uid) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const subId = btoa((sub.toJSON() as { endpoint?: string }).endpoint || '').slice(-32);
    const snap = await getDoc(doc(db, 'push_subscriptions', `${user.uid}_${subId}`));
    return snap.exists();
  }, [state, user]);

  return { state, busy, enable, disable, isEnabled };
}
