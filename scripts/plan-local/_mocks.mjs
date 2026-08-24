/**
 * _mocks.mjs — 로컬 플랜 하네스용 ESM 모듈 인터셉트 + mock adminDb.
 *
 * prod 파이프라인 모듈을 한 줄도 수정하지 않고, run.mjs 가 호출하는 경로에서만
 * 외부 의존(Firestore / ODsay / Naver / Gemini)을 차단하기 위한 도구.
 *
 * 인터셉트 대상 (module.register — Node v20.6+ 비동기 loader 훅):
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

import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AXIOS_MOCK_URL = pathToFileURL(join(__dirname, '_axios-mock.mjs')).href;
const FIRESTORE_ADMIN_MOCK_URL = pathToFileURL(join(__dirname, '_firestore-admin-mock.mjs')).href;
const TRANSIT_PROVIDER_MOCK_URL = pathToFileURL(join(__dirname, '_transit-provider-mock.mjs')).href;
const LOADER_URL = pathToFileURL(join(__dirname, '_loader.mjs')).href;

// ── 전역 mock 상태 (리다이렉트된 로컬 mock 모듈이 globalThis 로 접근) ─────────
// loader thread 자체에는 상태를 두지 않고 application realm 의 mock 파일에서만 읽는다.
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

let _installed = false;

/**
 * 세 boundary 모듈을 mock 으로 치환. 반드시 prod 모듈 import 전에 호출.
 * loader 는 대상 모듈을 같은 application realm 의 로컬 mock 파일로 돌린다.
 * 따라서 mock adminDb 와 fixture blocks 는 globalThis 를 그대로 공유한다.
 */
export function installMocks() {
  if (_installed) return;

  register(LOADER_URL, import.meta.url, {
    data: {
      axiosMockUrl: AXIOS_MOCK_URL,
      firestoreAdminMockUrl: FIRESTORE_ADMIN_MOCK_URL,
      transitProviderMockUrl: TRANSIT_PROVIDER_MOCK_URL,
    },
  });
  _installed = true;
}
