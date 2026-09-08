import { describe, expect, it, vi } from 'vitest';
import { focusOwnerControllerForNotification } from '@/lib/ownerNotificationNavigation';

const ORIGIN = 'https://cocotripkr.com';
const CONTROLLER = `${ORIGIN}/admin/ai-center`;

function fakeWindow(url: string) {
  return { url, focus: vi.fn(async () => undefined), navigate: vi.fn(async () => undefined) };
}

function fakeClients(windows: ReturnType<typeof fakeWindow>[] = []) {
  return { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => null) };
}

describe('Owner notification navigation', () => {
  it.each([
    '/admin/ai-center',
    CONTROLLER,
    '/admin/ai-center?period=all#ops-queue',
    `${CONTROLLER}?redirect=https://outside.invalid/#ops-queue`,
  ])('opens only the canonical controller when no controller exists: %s', async (target) => {
    const payment = fakeWindow(`${ORIGIN}/my-plans?checkout=active`);
    const admin = fakeWindow(`${ORIGIN}/admin`);
    const clients = fakeClients([payment, admin]);
    expect(await focusOwnerControllerForNotification(target, ORIGIN, clients)).toBe(true);
    expect(clients.matchAll).toHaveBeenCalledExactlyOnceWith({ type: 'window', includeUncontrolled: true });
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(CONTROLLER);
    expect(payment.focus).not.toHaveBeenCalled();
    expect(payment.navigate).not.toHaveBeenCalled();
    expect(admin.focus).not.toHaveBeenCalled();
    expect(admin.navigate).not.toHaveBeenCalled();
  });

  it('focuses an existing controller without changing its filters, fragment or draft state', async () => {
    const other = fakeWindow(`${ORIGIN}/ai-planner?draft=active`);
    const controller = fakeWindow(`${CONTROLLER}?period=all&custom=keep#ops-reservation`);
    const originalUrl = controller.url;
    const clients = fakeClients([other, controller]);
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
    expect(controller.focus).toHaveBeenCalledOnce();
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(controller.url).toBe(originalUrl);
    expect(other.focus).not.toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it.each([
    'https://outside.invalid/admin/ai-center',
    'https://cocotripkr.com.outside.invalid/admin/ai-center',
    'https://cocotripkr.com@outside.invalid/admin/ai-center',
    'https://user:password@cocotripkr.com/admin/ai-center',
    'http://cocotripkr.com/admin/ai-center',
    'https://cocotripkr.com:444/admin/ai-center',
    `${CONTROLLER}/`,
    `${CONTROLLER}-other`,
    `${CONTROLLER}/draft`,
    `${ORIGIN}/admin/preview-ai-center`,
    `${ORIGIN}/admin/ai%2Dcenter`,
    `${ORIGIN}/admin/ai-center%2F`,
    '/admin/ai-center',
    'not a URL',
  ])('does not mistake a different or malformed window for the controller: %s', async (url) => {
    const other = fakeWindow(url);
    const clients = fakeClients([other]);
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
    expect(other.focus).not.toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(CONTROLLER);
  });

  it.each([
    '/my-plans', '/admin', '/admin/calendar', '/admin/ai-center-other', '/admin/ai-center/',
    '/admin/ai-center/draft', '/admin/ai%2Dcenter',
    'https://outside.invalid/admin/ai-center', '//outside.invalid/admin/ai-center',
    'https://cocotripkr.com@outside.invalid/admin/ai-center',
    'https://user:password@cocotripkr.com/admin/ai-center',
    'http://cocotripkr.com/admin/ai-center', 'javascript:alert(1)', null, undefined, 42, {},
  ])('leaves non-controller targets to the existing customer handler: %j', async (target) => {
    const controller = fakeWindow(CONTROLLER);
    const clients = fakeClients([controller]);
    expect(await focusOwnerControllerForNotification(target, ORIGIN, clients)).toBe(false);
    expect(clients.matchAll).not.toHaveBeenCalled();
    expect(controller.focus).not.toHaveBeenCalled();
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('tries another controller if the first one cannot be focused', async () => {
    const first = fakeWindow(`${CONTROLLER}?period=today`);
    first.focus.mockRejectedValue(new Error('window closed'));
    const second = fakeWindow(`${CONTROLLER}?period=all`);
    const clients = fakeClients([first, second]);
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
    expect(first.focus).toHaveBeenCalledOnce();
    expect(second.focus).toHaveBeenCalledOnce();
    expect(first.navigate).not.toHaveBeenCalled();
    expect(second.navigate).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a new controller when all existing controller focus calls fail', async () => {
    const controller = fakeWindow(CONTROLLER);
    controller.focus.mockRejectedValue(new Error('window closed'));
    const other = fakeWindow(`${ORIGIN}/charter?draft=keep`);
    const clients = fakeClients([controller, other]);
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(CONTROLLER);
    expect(controller.navigate).not.toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
    expect(other.focus).not.toHaveBeenCalled();
  });

  it('opens a new controller if window enumeration fails', async () => {
    const clients = fakeClients();
    clients.matchAll.mockRejectedValue(new Error('enumeration unavailable'));
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(CONTROLLER);
  });

  it('skips a matching window without focus support', async () => {
    const clients = { matchAll: vi.fn(async () => [{ url: CONTROLLER }]), openWindow: vi.fn(async () => null) };
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
    expect(clients.openWindow).toHaveBeenCalledExactlyOnceWith(CONTROLLER);
  });

  it('does not fall through to customer navigation when openWindow is unavailable', async () => {
    const clients = { matchAll: vi.fn(async () => []) };
    expect(await focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).toBe(true);
  });

  it('does not hide openWindow failure or replace an unrelated window afterward', async () => {
    const other = fakeWindow(`${ORIGIN}/checkout`);
    const clients = fakeClients([other]);
    clients.openWindow.mockRejectedValue(new Error('opening unavailable'));
    await expect(focusOwnerControllerForNotification('/admin/ai-center', ORIGIN, clients)).rejects.toThrow('opening unavailable');
    expect(other.focus).not.toHaveBeenCalled();
    expect(other.navigate).not.toHaveBeenCalled();
  });
});
