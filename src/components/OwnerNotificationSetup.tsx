import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import type { OwnerNotificationAdapter, OwnerNotificationSnapshot } from '@/lib/ownerNotificationSetup';
import { OwnerNotificationPanel } from './OwnerNotificationPanel';
import { createOwnerDeviceTestAdapter } from '@/lib/ownerDeviceTest';
import { OwnerDeviceTestPanel } from './OwnerDeviceTestPanel';

/** Production-only adapter. It keeps the existing per-user push registration and auth contract. */
export function OwnerNotificationSetup() {
  const { user, loading } = useAuth();
  const { language } = useLanguage();
  const push = usePushSubscription();
  const actions = useRef(push);
  useEffect(() => { actions.current = push; }, [push]);
  const uid = user?.uid || '';
  const deviceTest = useMemo(() => user && !loading ? createOwnerDeviceTestAdapter(user) : null, [user, loading]);
  const adapter = useMemo<OwnerNotificationAdapter>(() => ({
    key: `owner:${uid}`,
    read: async () => {
      const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator
        && 'PushManager' in window && 'Notification' in window;
      const snapshot: OwnerNotificationSnapshot = {
        permission: supported ? Notification.permission : 'unsupported',
        account: loading ? 'loading' : uid ? 'signed_in' : 'signed_out',
        configured: Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY),
        registered: false,
      };
      if (!supported || loading || !uid || !snapshot.configured || snapshot.permission === 'denied') return snapshot;
      // This is a read-only wait. The panel gives it a deadline before enabling any registration action.
      await navigator.serviceWorker.ready;
      if (snapshot.permission === 'granted') {
        snapshot.registered = await actions.current.isEnabled({ serverOnly: true });
      }
      return snapshot;
    },
    enroll: () => actions.current.enable(),
  }), [uid, loading]);

  return <>
    <OwnerNotificationPanel key={adapter.key} adapter={adapter} language={language} />
    {deviceTest && <OwnerDeviceTestPanel key={adapter.key} adapter={deviceTest} language={language} />}
  </>;
}
