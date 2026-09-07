export interface OwnerNotificationSnapshot {
  permission: NotificationPermission | 'unsupported';
  account: 'loading' | 'signed_out' | 'signed_in';
  configured: boolean;
  registered: boolean;
}

export interface OwnerNotificationAdapter {
  /** Account identity, used only in memory to share a pending enrollment across remounts. */
  key: string;
  read: () => Promise<OwnerNotificationSnapshot>;
  enroll: () => Promise<boolean>;
}

export const OWNER_NOTIFICATION_READ_TIMEOUT_MS = 8_000;

/** Only read checks may time out. A pending browser/server write must keep its lock. */
export async function readOwnerNotificationState(adapter: OwnerNotificationAdapter) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      adapter.read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('notification-read-timeout')), OWNER_NOTIFICATION_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const pendingEnrollments = new Map<string, Promise<boolean>>();

export function pendingOwnerEnrollment(key: string) {
  return pendingEnrollments.get(key);
}

export function enrollOwnerDevice(adapter: OwnerNotificationAdapter) {
  const existing = pendingEnrollments.get(adapter.key);
  if (existing) return existing;
  // Invoke inside the click handler, without an awaited preflight before the permission prompt.
  let operation: Promise<boolean>;
  try { operation = adapter.enroll(); } catch (error) { operation = Promise.reject(error); }
  pendingEnrollments.set(adapter.key, operation);
  const clear = () => {
    if (pendingEnrollments.get(adapter.key) === operation) pendingEnrollments.delete(adapter.key);
  };
  void operation.then(clear, clear);
  return operation;
}
