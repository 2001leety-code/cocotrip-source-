/**
 * version 기반 낙관적 동시성 fake Firestore (2026-07-15, 결제 P0 원자 발급용).
 *
 * `bughunt-confirm-race.test.ts` 의 fake 를 원형으로 하되 세 가지를 고쳤다:
 *   1. `tx.set` / `tx.delete` 지원 (원본은 tx.get/tx.update 2개뿐 → tx.set 쓰면 TypeError).
 *   2. `docRef.set` 이 version 을 **올린다** (원본은 안 올려서 set 으로 바뀐 문서를 읽은
 *      트랜잭션이 충돌을 감지하지 못했다 = 가짜 안전).
 *   3. 트랜잭션 밖 `get`/`set` 이 **await 경계에서 양보**한다 → 비원자 read-then-set 구현이
 *      실제로 interleave 되어 테스트가 그것을 잡아낸다(vacuous 방지).
 *
 * ## 왜 이 fake 여야 하나
 * 이 레포엔 emulator 도 @firebase/rules-unit-testing 도 없다(in-memory fake 가 관행).
 * 하지만 상태 없는 mock(`tx.get` 이 항상 exists:false)으로는 경합을 **모사조차** 못 한다 —
 * 그런 mock 으로 "동시성 테스트" 를 짜면 제품이 get+set 으로 되돌아가도 초록불이다.
 * 이 fake 의 핵심 계약: **읽은 문서의 version 이 commit 시점에 바뀌었으면 콜백을 재실행한다.**
 * 그것이 실제 Firestore 트랜잭션의 serializable 보장이고, 그래야 뮤테이션(#1 claim tx →
 * read-then-set)이 실제로 실패한다.
 *
 * ## 실물과 다른 점 (의도적 — 알고 쓸 것)
 * - 컬렉션 쿼리(where/orderBy/limit) 미지원. 실제 Firestore 도 tx 안 쿼리를 제약하므로,
 *   tx 안에서 쿼리하는 제품 코드는 이 fake 로 검증하면 안 된다(=애초에 쓰면 안 된다).
 * - Firestore 는 tx 안 모든 read 가 write 보다 먼저여야 한다. 이 fake 는 강제하지 않는다.
 * - 재시도 상한 5회. 경합자가 많으면 'too many retries' 가 날 수 있다 — 그때는 제품이 아니라
 *   이 상한을 의심할 것.
 */

type Entry = { data: Record<string, unknown>; version: number };
export type WriteLog = { op: 'set' | 'update' | 'delete'; path: string; data?: unknown; inTx: boolean };

export type FakeDb = {
  collection: (name: string) => { doc: (id: string) => DocRef };
  runTransaction: <T>(cb: (tx: FakeTx) => Promise<T>) => Promise<T>;
  _reads: string[];
  _writes: WriteLog[];
  _txAttempts: number;
  _peek: (path: string) => Record<string, unknown> | undefined;
  _seed: (path: string, data: Record<string, unknown>) => void;
  _failNextTx: (times: number, message?: string) => void;
};

type DocRef = {
  __path: string;
  get: () => Promise<Snap>;
  set: (data: Record<string, unknown>) => Promise<void>;
  update: (patch: Record<string, unknown>) => Promise<void>;
};

type Snap = { exists: boolean; data: () => Record<string, unknown> | undefined };

type FakeTx = {
  get: (ref: DocRef) => Promise<Snap>;
  set: (ref: DocRef, data: Record<string, unknown>) => void;
  update: (ref: DocRef, patch: Record<string, unknown>) => void;
  delete: (ref: DocRef) => void;
};

/** 다른 비동기 흐름에 실행권을 넘긴다 — 이게 있어야 Promise.all 경합이 실제로 interleave 한다. */
const yieldTick = () => new Promise<void>((r) => setImmediate(r));

export function makeFakeDb(initial: Record<string, Record<string, unknown>> = {}): FakeDb {
  const store = new Map<string, Entry>();
  for (const [path, data] of Object.entries(initial)) store.set(path, { data: { ...data }, version: 0 });

  const reads: string[] = [];
  const writes: WriteLog[] = [];
  let txAttempts = 0;
  let failTxTimes = 0;
  let failTxMessage = 'firestore unavailable';

  const snapOf = (e: Entry | undefined): Snap => ({
    exists: !!e,
    data: () => (e ? { ...e.data } : undefined),
  });

  function docRef(path: string): DocRef {
    return {
      __path: path,
      async get() {
        await yieldTick(); // 비원자 read-then-set 이 여기서 갈라진다
        reads.push(path);
        return snapOf(store.get(path));
      },
      async set(data) {
        await yieldTick();
        writes.push({ op: 'set', path, data, inTx: false });
        const e = store.get(path);
        // 원본 fake 와 달리 version 을 올린다 — 안 올리면 set 을 감지 못해 가짜 안전이 된다.
        store.set(path, { data: { ...data }, version: e ? e.version + 1 : 0 });
      },
      async update(patch) {
        await yieldTick();
        const e = store.get(path);
        if (!e) throw new Error(`update on missing doc: ${path}`);
        writes.push({ op: 'update', path, data: patch, inTx: false });
        e.data = { ...e.data, ...patch };
        e.version += 1;
      },
    };
  }

  return {
    collection: (name: string) => ({ doc: (id: string) => docRef(`${name}/${id}`) }),

    async runTransaction<T>(cb: (tx: FakeTx) => Promise<T>): Promise<T> {
      if (failTxTimes > 0) {
        failTxTimes -= 1;
        throw new Error(failTxMessage);
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        txAttempts += 1;
        const readVersions = new Map<string, number>();
        const staged: WriteLog[] = [];
        const tx: FakeTx = {
          async get(ref) {
            await yieldTick();
            reads.push(ref.__path);
            const e = store.get(ref.__path);
            readVersions.set(ref.__path, e ? e.version : -1);
            return snapOf(e);
          },
          set(ref, data) { staged.push({ op: 'set', path: ref.__path, data, inTx: true }); },
          update(ref, patch) { staged.push({ op: 'update', path: ref.__path, data: patch, inTx: true }); },
          delete(ref) { staged.push({ op: 'delete', path: ref.__path, inTx: true }); },
        };

        const result = await cb(tx);

        // commit — 읽은 모든 문서의 version 이 그대로일 때만 staged write 를 적용한다.
        let conflict = false;
        for (const [path, ver] of readVersions) {
          const e = store.get(path);
          if ((e ? e.version : -1) !== ver) { conflict = true; break; }
        }
        if (conflict) { await yieldTick(); continue; }

        for (const w of staged) {
          const e = store.get(w.path);
          if (w.op === 'delete') { store.delete(w.path); }
          else if (w.op === 'set') { store.set(w.path, { data: { ...(w.data as object) }, version: e ? e.version + 1 : 0 }); }
          else { if (!e) throw new Error(`update on missing doc: ${w.path}`); e.data = { ...e.data, ...(w.data as object) }; e.version += 1; }
          writes.push(w);
        }
        return result;
      }
      throw new Error('runTransaction: too many retries');
    },

    _reads: reads,
    _writes: writes,
    get _txAttempts() { return txAttempts; },
    _peek: (path: string) => { const e = store.get(path); return e ? { ...e.data } : undefined; },
    _seed: (path: string, data: Record<string, unknown>) => { store.set(path, { data: { ...data }, version: 0 }); },
    _failNextTx: (times: number, message?: string) => { failTxTimes = times; if (message) failTxMessage = message; },
  } as FakeDb;
}
