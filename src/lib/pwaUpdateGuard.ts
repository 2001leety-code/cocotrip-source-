// One reload gate for both our request and another window's update.
export const AUTO_UPDATE_WINDOW_MS = 10_000;
export const AUTO_UPDATE_IDLE_MS = 1_200;
export const UPDATE_REQUEST_TIMEOUT_MS = 10_000;
export type UpdateBlockReason = 'interaction' | 'editing' | 'payment' | 'background' | 'expired' | 'failed' | null;
export type PwaUpdateState = { deferred: boolean; busy: boolean; ready: boolean; reloaded: boolean; reason: UpdateBlockReason };
export const INITIAL_UPDATE_STATE: PwaUpdateState = { deferred: false, busy: false, ready: false, reloaded: false, reason: null };

export function hasFocusedEditable(doc: Document): boolean {
  const element = doc.activeElement;
  if (!element) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || (element as HTMLElement).isContentEditable === true;
}
export function isPaymentLikelyInProgress(doc: Document): boolean {
  return doc.activeElement?.tagName === 'IFRAME' || !!doc.querySelector('iframe[src*="paypal"], iframe[name*="paypal"]');
}
type UpdateFunction = (reloadPage?: boolean) => Promise<void>;
type Options = {
  now: () => number; editable: () => boolean; payment: () => boolean; visible: () => boolean;
  reload: () => void; publish: (state: PwaUpdateState) => void;
  schedule: (callback: () => void, delay: number) => () => void;
};
export function createPwaUpdateGuard(options: Options) {
  const loadedAt = options.now();
  let state = { ...INITIAL_UPDATE_STATE };
  let mounted = false;
  let hasMounted = false;
  let interaction = 0;
  let autoAttempted = false;
  let request: { kind: 'auto' | 'manual'; interaction: number; deadline: number } | null = null;
  let cancelRequest: (() => void) | null = null;
  let cancelAuto: (() => void) | null = null;
  function publish(patch: Partial<PwaUpdateState>) {
    state = { ...state, ...patch };
    if (mounted) options.publish(state);
  }
  function finishRequest() { cancelRequest?.(); cancelRequest = null; request = null; }
  function currentBlock(): UpdateBlockReason {
    if (options.payment()) return 'payment';
    if (options.editable()) return 'editing';
    if (!options.visible()) return 'background';
    return null;
  }
  function defer(reason: UpdateBlockReason) { finishRequest(); publish({ deferred: true, busy: false, reason }); }
  function reloadIfAllowed() {
    if (!mounted || state.reloaded || !state.ready || !request) return;
    const reason = currentBlock()
      || (interaction !== request.interaction ? 'interaction' : null)
      || (options.now() >= request.deadline ? 'expired' : null)
      || (request.kind === 'auto' && interaction > 0 ? 'interaction' : null);
    if (reason) { defer(reason); return; }
    finishRequest();
    // Claim before reload: duplicate controlling events cannot reload twice.
    publish({ busy: false, reloaded: true, reason: null });
    options.reload();
  }
  async function start(kind: 'auto' | 'manual', update: UpdateFunction) {
    if (!mounted || state.reloaded || request) return;
    const reason = currentBlock() || (kind === 'auto' && interaction > 0 ? 'interaction' : null);
    if (reason) { defer(reason); return; }
    request = { kind, interaction, deadline: kind === 'auto' ? loadedAt + AUTO_UPDATE_WINDOW_MS + AUTO_UPDATE_IDLE_MS : options.now() + UPDATE_REQUEST_TIMEOUT_MS };
    if (options.now() >= request.deadline) { defer('expired'); return; }
    const ownRequest = request;
    publish({ busy: true, reason: null });
    if (state.ready) { reloadIfAllowed(); return; }
    cancelRequest = options.schedule(() => { if (request === ownRequest) defer('expired'); }, Math.max(0, request.deadline - options.now()));
    try {
      // Activation is not reload authorization. onNeedReload checks again later.
      await update(true);
    } catch { if (mounted && request === ownRequest) defer('failed'); }
  }
  return {
    mount() { mounted = true; hasMounted = true; options.publish(state); },
    unmount() {
      mounted = false; cancelAuto?.(); cancelAuto = null; finishRequest(); state = { ...state, busy: false };
    },
    markInteraction() { interaction += 1; },
    onNeedReload() {
      if (state.reloaded) return;
      // Registration starts during render. Keep readiness that arrives before
      // the first effect, without publishing/reloading an unmounted component.
      // Once actually unmounted, late callbacks must remain ignored.
      if (!mounted) {
        if (!hasMounted) state = { ...state, ready: true, deferred: true };
        return;
      }
      publish({ ready: true });
      if (request) reloadIfAllowed();
      else publish({ deferred: true, reason: currentBlock() || 'interaction' });
    },
    scheduleAutomatic(update: UpdateFunction) {
      if (!mounted || autoAttempted || state.reloaded || request) return () => {};
      if (options.now() - loadedAt >= AUTO_UPDATE_WINDOW_MS) { publish({ deferred: true }); return () => {}; }
      cancelAuto?.();
      const cancel = options.schedule(() => { cancelAuto = null; autoAttempted = true; void start('auto', update); }, AUTO_UPDATE_IDLE_MS);
      cancelAuto = cancel;
      return cancel;
    },
    requestManual(update: UpdateFunction) { cancelAuto?.(); cancelAuto = null; autoAttempted = true; return start('manual', update); },
  };
}
export type PwaUpdateGuard = ReturnType<typeof createPwaUpdateGuard>;
