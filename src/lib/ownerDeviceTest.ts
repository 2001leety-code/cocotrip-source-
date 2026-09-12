export type OwnerDeviceTestResult = { code: string; ready?: boolean; providerAccepted?: boolean; deliveryVerified?: false };
export interface OwnerDeviceTestAdapter {
  check: () => Promise<OwnerDeviceTestResult>;
  send: () => Promise<OwnerDeviceTestResult>;
}

/** No permission prompts, registration writes, automatic sends or arbitrary destination inputs. */
export function createOwnerDeviceTestAdapter(account: { uid: string; getIdToken: () => Promise<string> }): OwnerDeviceTestAdapter {
  let checkedSubscription = '';
  let requestId = '';
  async function request(action: 'check' | 'send'): Promise<OwnerDeviceTestResult> {
    if (action === 'check') checkedSubscription = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted'
        || !('serviceWorker' in navigator)) return { code: 'DEVICE_NOT_READY' };
      const work = async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription?.endpoint) return { code: 'DEVICE_NOT_READY' };
        const subscriptionId = `${account.uid}_${btoa(subscription.endpoint).slice(-32)}`;
        if (action === 'send' && subscriptionId !== checkedSubscription) return { code: 'DEVICE_CHANGED' };
        const token = await account.getIdToken();
        if (controller.signal.aborted) throw new Error('expired');
        if (action === 'send' && !requestId) requestId = crypto.randomUUID();
        const response = await fetch('/api/admin-owner-notification-test', {
          method: 'POST', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, subscriptionId, ...(action === 'send' ? { requestId, confirmed: true } : {}) }),
        });
        const result = await response.json();
        if (controller.signal.aborted) throw new Error('expired');
        if (!result || typeof result !== 'object') throw new Error('invalid-response');
        const data = result.ok === true && response.ok ? result.data : { code: result.code };
        if (!data || typeof data.code !== 'string') throw new Error('invalid-response');
        const ready = action === 'check' && data.ready === true && data.code === 'READY';
        if (action === 'check') checkedSubscription = ready ? subscriptionId : '';
        return { code: data.code, ready,
          providerAccepted: data.code === 'PROVIDER_ACCEPTED' && data.providerAccepted === true, deliveryVerified: false as const };
      };
      return await Promise.race([work(), new Promise<OwnerDeviceTestResult>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve({ code: action === 'send' ? 'OUTCOME_UNKNOWN' : 'CHECK_FAILED' }); }, 10_000);
      })]);
    } catch { return { code: action === 'send' ? 'OUTCOME_UNKNOWN' : 'CHECK_FAILED' }; }
    finally { clearTimeout(timer); }
  }
  return { check: () => request('check'), send: () => request('send') };
}
