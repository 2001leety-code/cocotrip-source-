// usePushSubscription — Web Push 권한 요청 + Service Worker subscribe + Firestore 저장.
// Cocotrip plan-ready 알림용. iOS 16.4+ 는 PWA 홈 화면 추가 후에만 동작.
import { useState, useCallback } from 'react';
import { doc, setDoc, deleteDoc, getDoc, getDocFromServer, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './useAuth';
import {
  getConfiguredVapidPublicKey,
  getPushSubscriptionApplicationServerKeyBytes,
  isSameVapidPublicKey,
  toArrayBuffer,
} from '@/lib/pushSubscriptionKey';

type PushState = 'unsupported' | 'denied' | 'default' | 'granted';

function initialPushState(): PushState {
  if (typeof window === 'undefined') return 'default';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PushState;
}

export function usePushSubscription() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>(initialPushState);
  const [busy, setBusy] = useState(false);

  const enable = useCallback(async (): Promise<boolean> => {
    if (state === 'unsupported' || !user?.uid) return false;
    const configured = getConfiguredVapidPublicKey();
    if (!configured) {
      console.error('[push] VITE_VAPID_PUBLIC_KEY not set');
      return false;
    }
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setState(perm as PushState);
      if (perm !== 'granted') return false;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toArrayBuffer(configured.bytes) });
      } else {
        const existingKey = getPushSubscriptionApplicationServerKeyBytes(sub.options?.applicationServerKey);
        if (!existingKey) return false;
        if (!isSameVapidPublicKey(existingKey, configured.bytes)) {
          if (await sub.unsubscribe() !== true) return false;
          sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toArrayBuffer(configured.bytes) });
        }
      }
      const subJson = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const endpoint = subJson.endpoint || '';
      const subId = btoa(endpoint).slice(-32);
      await setDoc(doc(db, 'push_subscriptions', `${user.uid}_${subId}`), {
        uid: user.uid, endpoint, keys: subJson.keys || {}, vapidPublicKey: configured.value,
        userAgent: navigator.userAgent, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      return true;
    } catch {
      console.error('[push] enable failed');
      return false;
    } finally { setBusy(false); }
  }, [state, user]);

  const disable = useCallback(async (): Promise<boolean> => {
    if (!user?.uid) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const subId = btoa((sub.toJSON() as { endpoint?: string }).endpoint || '').slice(-32);
        await deleteDoc(doc(db, 'push_subscriptions', `${user.uid}_${subId}`));
        await sub.unsubscribe();
      }
      return true;
    } catch (err) {
      console.error('[push] disable failed', err);
      return false;
    } finally { setBusy(false); }
  }, [user]);

  const isEnabled = useCallback(async (options?: { serverOnly?: boolean }): Promise<boolean> => {
    const configured = getConfiguredVapidPublicKey();
    if (!configured) return false;
    const permission = typeof Notification !== 'undefined' ? Notification.permission : state;
    if (permission !== 'granted' || !user?.uid) return false;
    const reg = options?.serverOnly ? await navigator.serviceWorker.getRegistration() : await navigator.serviceWorker.ready;
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    const existingKey = getPushSubscriptionApplicationServerKeyBytes(sub.options?.applicationServerKey);
    if (!existingKey || !isSameVapidPublicKey(existingKey, configured.bytes)) return false;
    const subId = btoa((sub.toJSON() as { endpoint?: string }).endpoint || '').slice(-32);
    const reference = doc(db, 'push_subscriptions', `${user.uid}_${subId}`);
    const snap = options?.serverOnly ? await getDocFromServer(reference) : await getDoc(reference);
    return snap.exists();
  }, [state, user]);

  return { state, busy, enable, disable, isEnabled };
}
