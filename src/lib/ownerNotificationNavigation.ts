const OWNER_CONTROLLER_PATH = '/admin/ai-center';

interface OwnerNotificationWindow {
  url: string;
  focus?: () => Promise<unknown>;
}

export interface OwnerNotificationClients {
  matchAll: (options: { type: 'window'; includeUncontrolled: boolean }) => Promise<ReadonlyArray<OwnerNotificationWindow>>;
  openWindow?: (url: string) => Promise<unknown>;
}

function ownerControllerUrl(value: unknown, origin: string, relativeAllowed: boolean): URL | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = relativeAllowed ? new URL(value, `${origin}/`) : new URL(value);
    if (url.origin !== origin || url.pathname !== OWNER_CONTROLLER_PATH || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Consumes only owner-controller clicks. Other targets retain the existing customer flow.
 * No navigate capability is accepted: an alert must not replace a draft or payment screen.
 */
export async function focusOwnerControllerForNotification(
  target: unknown,
  origin: string,
  clients: OwnerNotificationClients,
): Promise<boolean> {
  if (!ownerControllerUrl(target, origin, true)) return false;

  let windows: ReadonlyArray<OwnerNotificationWindow> = [];
  try {
    windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  } catch { /* If enumeration fails, open a controller instead of replacing an unknown page. */ }

  for (const client of windows) {
    if (!ownerControllerUrl(client.url, origin, false) || !client.focus) continue;
    try {
      // Keep this window's current query, fragment and in-progress state untouched.
      await client.focus();
      return true;
    } catch { /* Try another controller window, then a new controller. */ }
  }

  if (clients.openWindow) await clients.openWindow(new URL(OWNER_CONTROLLER_PATH, `${origin}/`).href);
  return true;
}
