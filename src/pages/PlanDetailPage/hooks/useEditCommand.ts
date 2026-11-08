// Fable command pattern adapted to a per-tab registry; reload never replays a request.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { canonicalJson } from '@/lib/planEditCanonical.js';
export type EditCtx = { uid: string; planId: string; fingerprint: string; revision: number } | null;
export type EditState = 'idle' | 'sending' | 'uncertain' | 'awaitingSnapshot';
type Body = { planId: string; requestId: string; expectedFingerprint: string; operation: unknown };
type Pending = { uid: string; planId: string; intentKey: string; serialized: string; requestId: string;
  ambiguous: boolean; phase: Exclude<EditState,'idle'>; revision: number | null; acceptedNotified: boolean };
type Accepted = (operation: unknown, uid: string, planId: string) => void;
const entries = new Map<string, Pending>();
const listeners = new Set<() => void>();
let version = 0;
const keyOf = (uid: string, planId: string) => JSON.stringify([uid, planId]);
function changed() { version++; listeners.forEach(notify => notify()); }
function subscribe(notify: () => void) { listeners.add(notify); return () => { listeners.delete(notify); }; }
const snapshot = () => version;
const failure = (code: string) => Object.assign(new Error('edit_failed'), { code });
const matches = (p: Pending, c: EditCtx, uid: string | null) =>
  !!c && c.uid === p.uid && c.planId === p.planId && uid === p.uid;
export function useEditCommand(
  context: EditCtx, getCurrentUid: () => string | null, send: (body: Body, signal?: AbortSignal) => Promise<Response>,
  onAccepted?: Accepted,
) {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const mounted = useRef(false);
  const ctxRef = useRef<EditCtx>(null);
  const sendRef = useRef(send);
  const uidRef = useRef(getCurrentUid);
  const acceptedRef = useRef(onAccepted);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => {
    ctxRef.current = context; sendRef.current = send; uidRef.current = getCurrentUid; acceptedRef.current = onAccepted;
  });
  const entry = context ? entries.get(keyOf(context.uid, context.planId)) : undefined;
  const state: EditState = entry?.phase || 'idle';
  useEffect(() => {
    const p = entry;
    if (!p || p.phase !== 'awaitingSnapshot') return;
    queueMicrotask(() => {
      const c = ctxRef.current, key = keyOf(p.uid,p.planId);
      if (!mounted.current || entries.get(key) !== p || p.phase !== 'awaitingSnapshot' ||
          !c || !matches(p,c,uidRef.current())) return;
      if (!p.acceptedNotified) {
        p.acceptedNotified = true;
        // A refresh failure must never turn an accepted edit into a failed save.
        try { acceptedRef.current?.((JSON.parse(p.serialized) as Body).operation,p.uid,p.planId); }
        catch { /* Existing owner snapshot still carries the saved edit. */ }
      }
      if (p.revision !== null && c.revision >= p.revision) { entries.delete(key); changed(); }
    });
  }, [context, entry, state]);
  async function run(p: Pending, fresh = false) {
    const key = keyOf(p.uid,p.planId);
    if (!mounted.current || (!fresh && p.phase === 'sending')) throw failure('busy');
    if (!matches(p,ctxRef.current,uidRef.current())) throw failure('mismatch');
    p.phase = 'sending'; entries.set(key,p); changed();
    let response: Response, value: unknown;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await sendRef.current(JSON.parse(p.serialized) as Body, controller.signal);
          return {response,value:await response.json() as unknown};
        })(),
        new Promise<never>((_resolve,reject) => {
          timer=setTimeout(() => { controller.abort(); reject(failure('timeout')); },45000);
        }),
      ]);
      response=result.response;value=result.value;
    }
    catch {
      if(entries.get(key)===p){p.ambiguous=true;p.phase='uncertain';changed();}
      throw failure('uncertain');
    } finally { if(timer)clearTimeout(timer); }
    if(entries.get(key)!==p)throw failure('superseded');
    const data=value && typeof value==='object' ? value as Record<string,unknown> : {};
    if(!response.ok && !p.ambiguous && data.outcome==='not_applied' && data.requestId===p.requestId &&
       (response.status===400 || response.status===409 || response.status===422)){
      entries.delete(key);changed();throw failure('not_applied');
    }
    const revision=data.editRevision;
    if(!response.ok || data.ok!==true || data.requestId!==p.requestId ||
       typeof revision!=='number' || !Number.isSafeInteger(revision) || revision<1 ||
       typeof data.fingerprint!=='string' || !/^[a-f0-9]{64}$/.test(data.fingerprint)){
      p.ambiguous=true;p.phase='uncertain';changed();throw failure('uncertain');
    }
    p.revision=revision;p.phase='awaitingSnapshot';changed();
  }
  async function execute(operation: unknown) {
    const c=ctxRef.current;
    if(!mounted.current || !c || uidRef.current()!==c.uid)throw failure('mismatch');
    const intentKey=canonicalJson(operation), current=entries.get(keyOf(c.uid,c.planId));
    if(current){
      if(current.intentKey===intentKey)return run(current);
      throw failure('pending');
    }
    const requestId=crypto.randomUUID();
    const serialized=JSON.stringify({planId:c.planId,requestId,expectedFingerprint:c.fingerprint,operation:JSON.parse(intentKey)});
    return run({uid:c.uid,planId:c.planId,intentKey,serialized,requestId,ambiguous:false,
      phase:'sending',revision:null,acceptedNotified:false},true);
  }
  async function retry() {
    const c=ctxRef.current;
    if(!c)throw failure('mismatch');
    const p=entries.get(keyOf(c.uid,c.planId));
    if(!p)throw failure('nothing');
    return run(p);
  }
  return {execute,retry,state,canEdit:state==='idle' && !!context};
}
