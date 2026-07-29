/**
 * 경쟁 조건 테스트용 가짜 Firestore (2026-07-29).
 *
 * 🔴 왜 필요한가: 지금까지 웹훅·멱등 테스트는 **소스 문자열 검사**뿐이었다.
 *   "transaction 안에 있는가" 는 문자열로 확인되지만, **두 실행이 동시에 들어왔을 때
 *   최종 금액이 맞는가** 는 확인되지 않는다. 돈 계산은 그게 전부다.
 *
 * 그래서 실제 Firestore 의 낙관적 동시성을 흉내낸다:
 *   - transaction 안에서 읽은 문서의 버전을 기억한다.
 *   - commit 시점에 그 문서가 다른 실행에 의해 바뀌어 있으면 **transaction 을 처음부터 재실행**한다.
 *   - 재실행 시 최신 값을 다시 읽으므로, 누적 계산이 유실되지 않아야 정상이다.
 *
 * 테스트가 원하는 순서를 강제할 수 있도록 `__beforeCommit` 훅을 둔다.
 * 두 transaction 이 **둘 다 읽기를 끝낸 뒤** 커밋하도록 게이트를 걸면
 * 실제 경쟁을 결정적으로 재현할 수 있다(무작위 타이밍에 기대지 않는다).
 *
 * 지원 범위는 이 레포가 실제로 쓰는 것만:
 *   collection().doc().get/set/update/delete, collection().where().get(),
 *   runTransaction(tx.get/set/update/delete), FieldValue.serverTimestamp/increment/delete
 */

const SERVER_TIMESTAMP = { __sentinel: 'serverTimestamp' };
const DELETE_SENTINEL = { __sentinel: 'delete' };

export const FieldValue = {
  serverTimestamp: () => SERVER_TIMESTAMP,
  delete: () => DELETE_SENTINEL,
  increment: (n) => ({ __sentinel: 'increment', by: n }),
};

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
  && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

const clone = (v) => {
  if (Array.isArray(v)) return v.map(clone);
  if (isPlainObject(v)) {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = clone(val);
    return out;
  }
  return v;
};

/** Firestore set(merge:true) 는 중첩 map 을 **재귀 병합**한다. 배열은 통째 교체. */
function mergeInto(target, patch, nowMs) {
  for (const [k, raw] of Object.entries(patch)) {
    const v = raw;
    if (v === DELETE_SENTINEL) { delete target[k]; continue; }
    if (v === SERVER_TIMESTAMP) { target[k] = nowMs; continue; }
    if (isPlainObject(v) && v.__sentinel === 'increment') {
      target[k] = (Number(target[k]) || 0) + Number(v.by || 0);
      continue;
    }
    if (isPlainObject(v)) {
      if (!isPlainObject(target[k])) target[k] = {};
      mergeInto(target[k], v, nowMs);
      continue;
    }
    target[k] = clone(v);
  }
  return target;
}

/** update() 는 'a.b' 점 표기 경로를 지원한다(set 은 안 한다). */
function applyUpdate(target, patch, nowMs) {
  for (const [path, raw] of Object.entries(patch)) {
    if (!path.includes('.')) { mergeInto(target, { [path]: raw }, nowMs); continue; }
    const parts = path.split('.');
    let cur = target;
    for (const p of parts.slice(0, -1)) {
      if (!isPlainObject(cur[p])) cur[p] = {};
      cur = cur[p];
    }
    mergeInto(cur, { [parts.at(-1)]: raw }, nowMs);
  }
  return target;
}

class NotFound extends Error {
  constructor(path) {
    super(`NOT_FOUND: no document to update: ${path}`);
    this.code = 5;
  }
}

export function createFakeFirestore(seed = {}, options = {}) {
  /** path -> { data, version } */
  const store = new Map();
  let clock = options.startMs || 1_800_000_000_000;
  const stats = { commits: 0, retries: 0, transactions: 0, reads: 0, writes: 0 };

  for (const [path, data] of Object.entries(seed)) {
    store.set(path, { data: clone(data), version: 1 });
  }

  const now = () => { clock += 1; return clock; };

  const snapshotOf = (path) => {
    const rec = store.get(path);
    return {
      id: path.split('/').pop(),
      // 실제 Firestore 처럼 snapshot.ref 가 doc API 다 (get/set/update/collection 사용 가능).
      // docApi 는 아래에서 const 로 정의되므로 getter 로 늦게 평가한다.
      get ref() { return docApi(path); },
      exists: Boolean(rec),
      data: () => (rec ? clone(rec.data) : undefined),
    };
  };

  const commitWrite = (path, op) => {
    const rec = store.get(path);
    if (op.kind === 'delete') { store.delete(path); return; }
    if (op.kind === 'update' && !rec) throw new NotFound(path);
    if (op.kind === 'set' && !op.merge) {
      store.set(path, { data: mergeInto({}, op.data, now()), version: (rec?.version || 0) + 1 });
      return;
    }
    const base = rec ? clone(rec.data) : {};
    const next = op.kind === 'update'
      ? applyUpdate(base, op.data, now())
      : mergeInto(base, op.data, now());
    store.set(path, { data: next, version: (rec?.version || 0) + 1 });
    stats.writes += 1;
  };

  const docApi = (path) => ({
    path,
    id: path.split('/').pop(),
    collection: (name) => collectionApi(`${path}/${name}`),
    async get() { stats.reads += 1; return snapshotOf(path); },
    async set(data, opts) { commitWrite(path, { kind: 'set', data, merge: Boolean(opts?.merge) }); },
    async update(data) { commitWrite(path, { kind: 'update', data }); },
    async delete() { commitWrite(path, { kind: 'delete' }); },
  });

  const collectionApi = (col, filters = []) => ({
    doc: (id) => docApi(`${col}/${id}`),
    where: (field, op, value) => {
      if (op !== '==') throw new Error(`fake-firestore: unsupported operator ${op}`);
      return collectionApi(col, [...filters, { field, value }]);
    },
    limit(n) {
      const self = collectionApi(col, filters);
      const orig = self.get;
      self.get = async () => {
        const r = await orig();
        const docs = r.docs.slice(0, n);
        return { empty: docs.length === 0, size: docs.length, docs };
      };
      return self;
    },
    async get() {
      stats.reads += 1;
      const docs = [...store.entries()]
        .filter(([p]) => p.startsWith(`${col}/`))
        // Firestore equality 쿼리는 명시 정렬이 없으면 __name__ ASC 로 나온다.
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .filter(([, rec]) => filters.every((f) => rec.data?.[f.field] === f.value))
        .map(([p]) => snapshotOf(p));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });

  const db = {
    collection: (name) => collectionApi(name),

    /** 테스트가 커밋 직전에 끼어들 수 있는 훅. (attempt, label) 을 받는다. */
    __beforeCommit: null,
    __stats: stats,
    __dump: () => Object.fromEntries([...store.entries()].map(([p, r]) => [p, clone(r.data)])),
    __get: (path) => (store.has(path) ? clone(store.get(path).data) : undefined),
    __set: (path, data) => store.set(path, { data: clone(data), version: (store.get(path)?.version || 0) + 1 }),
    /** "그 사이 다른 작업이 값을 바꿨다" 를 만들 때 쓴다. 값이 undefined 면 필드 삭제. */
    __patch: (path, patch) => {
      const cur = store.get(path);
      const next = cur ? clone(cur.data) : {};
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = clone(v);
      }
      store.set(path, { data: next, version: (cur?.version || 0) + 1 });
    },
    __delete: (path) => store.delete(path),
    __version: (path) => store.get(path)?.version || 0,

    async runTransaction(fn, opts = {}) {
      stats.transactions += 1;
      const maxAttempts = opts.maxAttempts || 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const readVersions = new Map();
        const pending = [];
        const tx = {
          async get(refOrQuery) {
            if (typeof refOrQuery?.get === 'function' && !refOrQuery.path) {
              return refOrQuery.get(); // 쿼리 — 버전 추적 대상 아님(실제 Firestore 도 문서 단위)
            }
            const p = refOrQuery.path;
            readVersions.set(p, store.get(p)?.version || 0);
            stats.reads += 1;
            return snapshotOf(p);
          },
          set(ref, data, o) { pending.push([ref.path, { kind: 'set', data, merge: Boolean(o?.merge) }]); },
          update(ref, data) { pending.push([ref.path, { kind: 'update', data }]); },
          delete(ref) { pending.push([ref.path, { kind: 'delete' }]); },
        };

        const result = await fn(tx);

        if (typeof db.__beforeCommit === 'function') {
          await db.__beforeCommit({ attempt, label: opts.label });
        }

        // 낙관적 검증 — 읽은 문서가 그새 바뀌었으면 처음부터 다시.
        let conflict = false;
        for (const [p, v] of readVersions) {
          if ((store.get(p)?.version || 0) !== v) { conflict = true; break; }
        }
        if (conflict) {
          stats.retries += 1;
          if (attempt === maxAttempts) throw new Error('ABORTED: too much contention');
          continue;
        }
        for (const [p, op] of pending) commitWrite(p, op);
        stats.commits += 1;
        return result;
      }
      throw new Error('ABORTED: too much contention');
    },
  };
  return db;
}

/** N 개가 도착할 때까지 전부 대기시키는 게이트 — 경쟁을 결정적으로 재현한다. */
export function makeBarrier(count) {
  let arrived = 0;
  let release;
  const open = new Promise((r) => { release = r; });
  return {
    async wait() {
      arrived += 1;
      if (arrived >= count) release();
      await open;
    },
    get arrived() { return arrived; },
  };
}
