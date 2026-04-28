/**
 * Web Notifications wrapper.
 *
 * AI plan generation takes 30-90 seconds (Gemini call + DB matcher + transit).
 * If the user switches tabs or locks their phone during the wait, they miss
 * the moment the plan is ready. Web Notifications fire an OS-level banner so
 * they get pulled back.
 *
 * Two notification scenarios:
 *   - granted + tab backgrounded → fire OS notification + haptic success
 *   - granted + tab foreground   → skip OS notif (they see the page already)
 *   - denied / unsupported       → noop, the page-level UI still shows the result
 *
 * iOS Safari only delivers Notifications when the site is added to the home
 * screen (iOS 16.4+ web push). For non-PWA iOS users this silently no-ops,
 * which is correct — they just won't get the OS notif.
 *
 * Permission request happens at submit time, not on page load — asking
 * before the user has shown intent is rude and most browsers throttle it.
 */

const SUPPORTED = typeof window !== 'undefined' && 'Notification' in window;

export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function notifyPermission(): NotifyPermission {
  if (!SUPPORTED) return 'unsupported';
  return Notification.permission;
}

/**
 * Request permission. Safe to call multiple times — browser remembers the
 * answer after first prompt. Returns the resolved permission state.
 */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (!SUPPORTED) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

interface NotifyOpts {
  title: string;
  body?: string;
  icon?: string;
  /** When true, only fires if document is hidden (tab backgrounded). */
  onlyIfHidden?: boolean;
  /** Auto-close after N ms. Default 8000. */
  timeoutMs?: number;
  onClick?: () => void;
}

/**
 * Fire a notification. Returns true if shown, false if skipped (denied,
 * unsupported, or onlyIfHidden + tab is foreground).
 */
export function notify(opts: NotifyOpts): boolean {
  if (!SUPPORTED) return false;
  if (Notification.permission !== 'granted') return false;
  if (opts.onlyIfHidden && !document.hidden) return false;

  try {
    const n = new Notification(opts.title, {
      body: opts.body,
      icon: opts.icon || '/icons/icon-192.png',
      badge: opts.icon || '/icons/icon-192.png',
      tag: 'cocotrip-plan',  // collapses duplicates
    });
    if (opts.onClick) {
      n.onclick = () => {
        window.focus();
        opts.onClick?.();
        n.close();
      };
    }
    const t = opts.timeoutMs == null ? 8000 : opts.timeoutMs;
    if (t > 0) setTimeout(() => n.close(), t);
    return true;
  } catch {
    return false;
  }
}
