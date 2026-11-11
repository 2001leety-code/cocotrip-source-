// @vitest-environment jsdom
import React from 'react';
import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  setup: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
  clear: vi.fn(),
}));

// Complete replacement before the modal import: the real module initializes Firebase.
vi.mock('@/lib/firebase-auth', () => ({
  setUpRecaptchaVerifier: auth.setup,
  signInWithPhone: auth.send,
  verifyPhoneCode: auth.verify,
}));
// A missed auth mock must fail before any Firebase SDK can initialize.
vi.mock('firebase/app', () => { throw new Error('Real Firebase app import is forbidden'); });
vi.mock('firebase/auth', () => { throw new Error('Real Firebase auth import is forbidden'); });
vi.mock('firebase/firestore', () => { throw new Error('Real Firestore import is forbidden'); });
vi.mock('firebase/storage', () => { throw new Error('Real Firebase storage import is forbidden'); });

import { PhoneSignInModal } from '../../src/components/PhoneSignInModal';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const confirmation = { verificationId: 'synthetic-confirmation' };
const phoneInput = () => screen.getByLabelText('Phone number');
const codeInput = () => screen.getByLabelText('Verification code (6 digits)');
const sendButton = () => screen.getByRole('button', { name: 'Send SMS code' });
const verifyButton = () => screen.getByRole('button', { name: 'Sign in' });
const closeButton = () => screen.getByRole('button', { name: 'Close' });
const backdrop = () => screen.getByRole('heading', { name: 'Sign in with phone' }).parentElement!.parentElement!;

function openModal() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();
  const props = { language: 'en' as const, onClose, onSuccess };
  return { ...render(<PhoneSignInModal {...props} />), props, onClose, onSuccess };
}

function enterPhone(number = '2025550123') {
  fireEvent.change(phoneInput(), { target: { value: number } });
}

async function enterCodeStep() {
  auth.send.mockResolvedValueOnce(confirmation);
  enterPhone();
  await act(async () => { fireEvent.click(sendButton()); });
  fireEvent.change(codeInput(), { target: { value: '123456' } });
}

beforeEach(() => {
  vi.resetAllMocks();
  auth.setup.mockReturnValue({ clear: auth.clear });
  auth.send.mockImplementation(() => { throw new Error('Unexpected synthetic SMS attempt'); });
  auth.verify.mockImplementation(() => { throw new Error('Unexpected synthetic verification attempt'); });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this component test'); }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PhoneSignInModal lifecycle with synthetic auth only', () => {
  it.each(['button', 'backdrop'])('closes once through the idle %s and rejects actions before unmount', (target) => {
    const view = openModal();
    enterPhone();
    const close = target === 'button' ? closeButton() : backdrop();
    fireEvent.click(close);
    fireEvent.click(close);
    fireEvent.click(sendButton());
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(auth.send).not.toHaveBeenCalled();
    view.unmount();
    expect(auth.clear).toHaveBeenCalledTimes(1);
  });

  it('closes through the backdrop while SMS is pending and ignores the late SMS result', async () => {
    const pending = deferred<typeof confirmation>();
    auth.send.mockReturnValueOnce(pending.promise);
    const view = openModal();
    enterPhone();
    fireEvent.click(sendButton());
    expect(phoneInput()).toBeDisabled();
    expect(closeButton()).toBeDisabled(); // same as main: the busy button stays disabled, the backdrop does not
    fireEvent.click(backdrop());
    fireEvent.click(backdrop());
    expect(view.onClose).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(confirmation); });
    expect(screen.queryByLabelText('Verification code (6 digits)')).not.toBeInTheDocument();
    fireEvent.click(backdrop());
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSuccess).not.toHaveBeenCalled();
  });

  it('closes through the backdrop while verification is pending and ignores the late verification', async () => {
    const pending = deferred<void>();
    const view = openModal();
    await enterCodeStep();
    auth.verify.mockReturnValueOnce(pending.promise);
    fireEvent.click(verifyButton());
    expect(codeInput()).toBeDisabled();
    expect(closeButton()).toBeDisabled();
    const back = screen.getByRole('button', { name: '← Change number' });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument();
    fireEvent.click(backdrop());
    expect(view.onClose).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(); });
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('a never-settling SMS send does not trap the user: one outside click closes once', () => {
    auth.send.mockReturnValueOnce(new Promise(() => {}));
    const view = openModal();
    enterPhone();
    const send = sendButton();
    fireEvent.click(send);
    expect(auth.send).toHaveBeenCalledTimes(1);
    fireEvent.click(backdrop());
    expect(view.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(backdrop());
    fireEvent.click(send);
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(auth.send).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'])('ignores a late SMS %s after unmount and reopen', async (outcome) => {
    const pending = deferred<typeof confirmation>();
    auth.send.mockReturnValueOnce(pending.promise);
    const view = openModal();
    enterPhone();
    fireEvent.click(sendButton());
    view.rerender(<></>);
    expect(auth.clear).toHaveBeenCalledTimes(1);
    view.rerender(<PhoneSignInModal {...view.props} />);
    await act(async () => {
      if (outcome === 'resolve') pending.resolve(confirmation);
      else pending.reject(new Error('stale SMS failure'));
    });
    expect(phoneInput()).toHaveValue('');
    expect(phoneInput()).toBeEnabled();
    expect(screen.queryByLabelText('Verification code (6 digits)')).not.toBeInTheDocument();
    expect(screen.queryByText('stale SMS failure')).not.toBeInTheDocument();
    expect(view.onClose).not.toHaveBeenCalled();
    expect(view.onSuccess).not.toHaveBeenCalled();
    const next = deferred<typeof confirmation>();
    auth.send.mockReturnValueOnce(next.promise);
    enterPhone('2025550199');
    fireEvent.click(sendButton());
    await act(async () => { next.resolve({ verificationId: 'new-confirmation' }); });
    expect(codeInput()).toBeEnabled();
  });

  it.each(['resolve', 'reject'])('ignores a late verification %s after unmount and reopen', async (outcome) => {
    const pending = deferred<void>();
    const view = openModal();
    await enterCodeStep();
    auth.verify.mockReturnValueOnce(pending.promise);
    fireEvent.click(verifyButton());
    view.rerender(<></>);
    expect(auth.clear).toHaveBeenCalledTimes(1);
    view.rerender(<PhoneSignInModal {...view.props} />);
    await act(async () => {
      if (outcome === 'resolve') pending.resolve();
      else pending.reject(new Error('stale verification failure'));
    });
    expect(phoneInput()).toHaveValue('');
    expect(phoneInput()).toBeEnabled();
    expect(screen.queryByText('stale verification failure')).not.toBeInTheDocument();
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    await enterCodeStep();
    auth.verify.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(verifyButton()); });
    expect(view.onSuccess).toHaveBeenCalledTimes(1);
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('a same-tick send + outside click closes once and the late SMS is ignored', async () => {
    const sms = deferred<typeof confirmation>();
    auth.send.mockReturnValue(sms.promise);
    const view = openModal();
    enterPhone();
    const send = sendButton();
    act(() => { fireEvent.click(send); fireEvent.click(backdrop()); fireEvent.click(backdrop()); fireEvent.click(send); });
    expect(auth.send).toHaveBeenCalledTimes(1);
    expect(view.onClose).toHaveBeenCalledTimes(1);
    await act(async () => { sms.resolve(confirmation); });
    expect(screen.queryByLabelText('Verification code (6 digits)')).not.toBeInTheDocument();
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks same-tick duplicate attempts and emits completion only once', async () => {
    const sms = deferred<typeof confirmation>();
    const verify = deferred<void>();
    auth.send.mockReturnValue(sms.promise);
    auth.verify.mockReturnValue(verify.promise);
    const view = openModal();
    enterPhone();
    const send = sendButton();
    act(() => { fireEvent.click(send); fireEvent.click(send); });
    expect(auth.send).toHaveBeenCalledTimes(1);
    expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => { sms.resolve(confirmation); });
    fireEvent.change(codeInput(), { target: { value: '123456' } });
    const submit = verifyButton();
    act(() => { fireEvent.click(submit); fireEvent.click(submit); });
    expect(auth.verify).toHaveBeenCalledTimes(1);
    expect(view.onClose).not.toHaveBeenCalled();
    await act(async () => { verify.resolve(); });
    fireEvent.click(submit);
    fireEvent.click(backdrop());
    expect(view.onSuccess).toHaveBeenCalledTimes(1);
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes once after successful verification when onSuccess is omitted', async () => {
    const onClose = vi.fn();
    render(<PhoneSignInModal language="en" onClose={onClose} />);
    await enterCodeStep();
    auth.verify.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(verifyButton()); });
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call stale onClose after onSuccess synchronously unmounts the modal', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    function Parent() {
      const [open, setOpen] = React.useState(true);
      return open ? (
        <PhoneSignInModal
          language="en"
          onClose={onClose}
          onSuccess={() => {
            onSuccess();
            flushSync(() => setOpen(false));
          }}
        />
      ) : <p>Signed in</p>;
    }
    render(<Parent />);
    await enterCodeStep();
    auth.verify.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(verifyButton()); });
    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(auth.clear).toHaveBeenCalledTimes(1);
  });

  it('uses the active StrictMode session and clears distinct verifier instances once each', async () => {
    const firstVerifier = { clear: vi.fn() };
    const activeVerifier = { clear: vi.fn() };
    auth.setup.mockReturnValueOnce(firstVerifier).mockReturnValueOnce(activeVerifier);
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const view = render(
      <React.StrictMode>
        <PhoneSignInModal language="en" onClose={onClose} onSuccess={onSuccess} />
      </React.StrictMode>,
    );
    expect(auth.setup).toHaveBeenCalledTimes(2);
    expect(firstVerifier.clear).toHaveBeenCalledTimes(1);
    expect(activeVerifier.clear).not.toHaveBeenCalled();
    await enterCodeStep();
    expect(auth.send).toHaveBeenCalledWith('+12025550123', activeVerifier);
    auth.verify.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(verifyButton()); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(firstVerifier.clear).toHaveBeenCalledTimes(1);
    expect(activeVerifier.clear).toHaveBeenCalledTimes(1);
  });

  it('releases a failed SMS attempt for retry and clears its error', async () => {
    const pending = deferred<typeof confirmation>();
    auth.send.mockReturnValueOnce(pending.promise);
    openModal();
    enterPhone();
    fireEvent.click(sendButton());
    await act(async () => { pending.reject(new Error('synthetic SMS failure')); });
    expect(screen.getByText('synthetic SMS failure')).toBeInTheDocument();
    expect(sendButton()).toBeEnabled();
    auth.send.mockResolvedValueOnce(confirmation);
    await act(async () => { fireEvent.click(sendButton()); });
    expect(codeInput()).toBeEnabled();
    expect(screen.queryByText('synthetic SMS failure')).not.toBeInTheDocument();
  });

  it('releases a failed verification for retry without premature completion', async () => {
    const pending = deferred<void>();
    const view = openModal();
    await enterCodeStep();
    auth.verify.mockReturnValueOnce(pending.promise);
    fireEvent.click(verifyButton());
    await act(async () => { pending.reject(new Error('synthetic verification failure')); });
    expect(screen.getByText('synthetic verification failure')).toBeInTheDocument();
    expect(verifyButton()).toBeEnabled();
    expect(view.onSuccess).not.toHaveBeenCalled();
    expect(view.onClose).not.toHaveBeenCalled();
    auth.verify.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(verifyButton()); });
    expect(view.onSuccess).toHaveBeenCalledTimes(1);
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('resets code and error on number change and verifies only the new confirmation', async () => {
    const view = openModal();
    await enterCodeStep();
    auth.verify.mockRejectedValueOnce(new Error('old code failure'));
    await act(async () => { fireEvent.click(verifyButton()); });
    fireEvent.click(screen.getByRole('button', { name: '← Change number' }));
    expect(phoneInput()).toHaveValue('2025550123');
    expect(screen.queryByText('old code failure')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: '82' } });
    enterPhone('010-1234-5678');
    const next = { verificationId: 'new-number-confirmation' };
    auth.send.mockResolvedValueOnce(next);
    await act(async () => { fireEvent.click(sendButton()); });
    expect(auth.send).toHaveBeenLastCalledWith('+821012345678', expect.objectContaining({ clear: auth.clear }));
    expect(codeInput()).toHaveValue('');
    expect(verifyButton()).toBeDisabled();
    fireEvent.change(codeInput(), { target: { value: '654321' } });
    auth.verify.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(verifyButton()); });
    expect(auth.verify).toHaveBeenLastCalledWith(next, '654321');
    expect(view.onSuccess).toHaveBeenCalledTimes(1);
  });
});
