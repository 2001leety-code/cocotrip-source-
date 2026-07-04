/**
 * _mocks.mjs — 로컬 플랜 하네스용 ESM 모듈 인터셉트 + mock adminDb.
 *
 * prod 파이프라인 모듈을 한 줄도 수정하지 않고, run.mjs 가 호출하는 경로에서만
 * 외부 의존(Firestore / ODsay / Naver / Gemini)을 차단하기 위한 도구.
 *
 * 인터셉트 대상 (module.registerHooks — Node v22.15+ 동기 in-thread 훅):
 *   1. api/_ai_core/firestoreAdmin.js      → initAdminDb() = mock adminDb (전역 fixture blocks 기반)
 *   2. api/_shared/firebase-admin.js       → 위 모듈이 re-export 하는 원본도 동일 mock (이중 안전망)
 *   3. api/_transit_provider.js            → searchTransit() = 항상 null (live ODsay/TMAP 호출 0)
 *
 * mock adminDb 는 두 가지 Firestore 접근을 지원한다 (RouteAgent transitCache + fetchAvailableBlocks):
 *   - collection('zone_courses').where('city','==',x).where('status','==','published').get()
 *       → 전역 GLOBAL_BLOCKS 중 city 일치 + status published 인 doc 목록 (snapshot)
 *   - collection('zone_courses').doc(zoneId).get()
 *       → 전역 GLOBAL_BLOCKS 중 id===zoneId 인 doc ({ exists, data() }) — transitCache 의 transit_matrix 조회용
 *
 * 그 외 collection/write 접근은 no-op stub 로 graceful 처리 (Firestore write 안 함).
 *
 * 사용:
 *   import { installMocks, setBlocks } from './_mocks.mjs';  // installMocks 는 import 전에 호출돼야 효과
 *   실제로는 run.mjs 가 child 로 register 한 뒤 동적 import 한다 (아래 main 부 참고).
 */

import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AXIOS_MOCK_URL = pathToFileURL(join(__dirname, '_axios-mock.mjs')).href;

// ── 전역 mock 상태 (인터셉트된 모듈이 globalThis 로 접근) ──────────────────────
// registerHooks 로 주입한 소스는 같은 thread/realm 에서 실행되므로 globalThis 공유 가능.
globalThis.__PLAN_LOCAL_BLOCKS__ = globalThis.__PLAN_LOCAL_BLOCKS__ || [];

/** 전역 fixture 블록 설정 (record/run 이 fixtures 로드 후 호출). */
export function setBlocks(blocks) {
  globalThis.__PLAN_LOCAL_BLOCKS__ = Array.isArray(blocks) ? blocks : [];
}

/** mock adminDb 가 보는 현재 블록들. */
export function getBlocks() {
  return globalThis.__PLAN_LOCAL_BLOCKS__ || [];
}

// ── mock Firestore 스냅샷/문서 구현 (소스 문자열로도, 직접 import 로도 재사용) ──
function makeMockAdminDb() {
  const blocksRef = () => globalThis.__PLAN_LOCAL_BLOCKS__ || [];

  // fetchAvailableBlocks 는 status=='published' 로 필터하므로, 블록에 status 가 없으면
  // published 로 간주 (fixture 단순화). 실제 seed 도 published 만 올라간다.
  const isPublished = (b) => (b.status == null ? true : b.status === 'published');

  function makeQuery(filters) {
    return {
      where(field, _op, value) {
        return makeQuery([...filters, { field, value }]);
      },
      async get() {
        const matched = blocksRef().filter((b) => {
          for (const f of filters) {
            if (f.field === 'status') {
              if (!isPublished(b)) return false;
              if (f.value && f.value !== 'published') return false;
              continue;
            }
            const bv = b[f.field];
            // city 비교는 대소문자 무시 (fetchAvailableBlocks 가 toLowerCase 한 city 전달)
            if (String(bv).toLowerCase() !== String(f.value).toLowerCase()) return false;
          }
          return true;
        });
        return {
          empty: matched.length === 0,
          size: matched.length,
          docs: matched.map((b) => ({ id: b.id, exists: true, data: () => b })),
          forEach(cb) { matched.forEach((b) => cb({ id: b.id, exists: true, data: () => b })); },
        };
      },
    };
  }

  return {
    collection(name) {
      if (name === 'zone_courses') {
        return {
          where(field, op, val) { return makeQuery([]).where(field, op, val); },
          async get() { return makeQuery([]).get(); },
          async add() { return { id: 'mock' }; },
          doc(id) {
            return {
              async get() {
                const b = blocksRef().find((x) => x.id === id);
                return { exists: !!b, id, data: () => b || null };
              },
              // write no-op (하네스는 Firestore 기록 안 함)
              async set() { return {}; },
              async update() { return {}; },
            };
          },
        };
      }
      // 그 외 컬렉션 = no-op stub (avoidClause / telegram-throttle 등이 접근해도 graceful)
      return {
        where() { return this; },
        orderBy() { return this; },
        limit() { return this; },
        async get() { return { empty: true, size: 0, docs: [], forEach() {} }; },
        async add() { return { id: 'mock' }; },
        doc() {
          return {
            async get() { return { exists: false, data: () => null }; },
            async set() { return {}; },
            async update() { return {}; },
          };
        },
      };
    },
    // telegram-throttle 등이 트랜잭션 시도 — no-op (fail-open).
    async runTransaction(fn) { return fn({ get: async () => ({ exists: false, data: () => null }), set() {}, update() {} }); },
  };
}

// run.mjs (메인 스레드)에서 직접 쓸 수 있게 export — 인터셉트 소스도 이 형태를 재현.
export { makeMockAdminDb };

// ── module.registerHooks — 세 모듈의 소스를 mock 구현으로 치환 ─────────────────
const FIRESTORE_ADMIN_MOCK_SRC = `
function makeMockAdminDb() {
  const blocksRef = () => globalThis.__PLAN_LOCAL_BLOCKS__ || [];
  const isPublished = (b) => (b.status == null ? true : b.status === 'published');
  function makeQuery(filters) {
    return {
      where(field, _op, value) { return makeQuery([...filters, { field, value }]); },
      async get() {
        const matched = blocksRef().filter((b) => {
          for (const f of filters) {
            if (f.field === 'status') {
              if (!isPublished(b)) return false;
              if (f.value && f.value !== 'published') return false;
              continue;
            }
            const bv = b[f.field];
            if (String(bv).toLowerCase() !== String(f.value).toLowerCase()) return false;
          }
          return true;
        });
        return {
          empty: matched.length === 0,
          size: matched.length,
          docs: matched.map((b) => ({ id: b.id, exists: true, data: () => b })),
          forEach(cb) { matched.forEach((b) => cb({ id: b.id, exists: true, data: () => b })); },
        };
      },
    };
  }
  return {
    collection(name) {
      if (name === 'zone_courses') {
        return {
          where(field, op, val) { return makeQuery([]).where(field, op, val); },
          async get() { return makeQuery([]).get(); },
          async add() { return { id: 'mock' }; },
          doc(id) {
            return {
              async get() {
                const b = blocksRef().find((x) => x.id === id);
                return { exists: !!b, id, data: () => b || null };
              },
              async set() { return {}; },
              async update() { return {}; },
            };
          },
        };
      }
      return {
        where() { return this; }, orderBy() { return this; }, limit() { return this; },
        async get() { return { empty: true, size: 0, docs: [], forEach() {} }; },
        async add() { return { id: 'mock' }; },
        doc() { return { async get() { return { exists: false, data: () => null }; }, async set() { return {}; }, async update() { return {}; } }; },
      };
    },
    async runTransaction(fn) { return fn({ get: async () => ({ exists: false, data: () => null }), set() {}, update() {} }); },
  };
}
let _db = null;
export function initAdminDb() { if (!_db) _db = makeMockAdminDb(); return _db; }
export default initAdminDb;
`;

const TRANSIT_PROVIDER_MOCK_SRC = `
export function getTransitProvider() { return 'odsay'; }
// 하네스: live 호출 0 보장 — 항상 null (캐시 hit 은 transitCache 가 먼저 처리).
export async function searchTransit() { return null; }
`;

let _installed = false;

/**
 * 세 boundary 모듈을 mock 으로 치환. 반드시 prod 모듈 import 전에 호출.
 * registerHooks 는 동기 in-thread → globalThis 공유 OK.
 */
export function installMocks() {
  if (_installed) return;
  _installed = true;

  const matchers = [
    { test: /[\\/]api[\\/]_ai_core[\\/]firestoreAdmin\.js$/, src: FIRESTORE_ADMIN_MOCK_SRC },
    { test: /[\\/]api[\\/]_shared[\\/]firebase-admin\.js$/, src: FIRESTORE_ADMIN_MOCK_SRC },
    { test: /[\\/]api[\\/]_transit_provider\.js$/, src: TRANSIT_PROVIDER_MOCK_SRC },
  ];

  registerHooks({
    resolve(specifier, context, nextResolve) {
      // bare 'axios' (RouteAgent / 외부 HTTP) → 하네스 axios mock 으로 리다이렉트.
      //   RouteAgent 의 Naver geocoding 을 fixture 좌표로 충족 (오프라인 동선/캐시 transit 활성).
      if (specifier === 'axios') {
        return { url: AXIOS_MOCK_URL, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      for (const m of matchers) {
        if (m.test.test(url)) {
          return { format: 'module', shortCircuit: true, source: m.src };
        }
      }
      return nextLoad(url, context);
    },
  });
}
