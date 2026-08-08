/**
 * createPaypalOrder — 주문 스냅샷 fail-closed **행위** 테스트 (P1-B, 2026-07-15).
 *
 * 왜 필요한가: 기존 bughunt-capture-snapshot.test.ts 는 소스 문자열/순서만 검사한다
 * ("핸들러는 부작용 import 多 → 소스 구조 가드"). 그건 handler 가 실제로 안전하게 응답하는지
 * 증명하지 못한다 — 문자열은 있는데 동작은 다를 수 있다.
 *
 * 여기서는 payment-p0-crossflow-gate.test.ts 의 handler mock 패턴을 재사용해 **핸들러를 실제로
 * 실행**하고 응답 코드/바디를 관찰한다.
 *
 * 검증 대상 불변식: 주문 스냅샷(paypal_order_snapshots/{orderID})은 결제 provenance 의 **유일한
 * 근거**다 — paymentGate 가 "이 주문이 정말 AI 플래너용이고 금액·통화가 맞는가" 를 오직 여기서
 * 확인한다. 따라서 스냅샷 쓰기가 실패하면 **주문 ID 를 클라이언트에 주면 안 된다**. 주면 고객이
 * 결제한 뒤 provenance 가 없어 상품을 영구히 못 받는다(격리 해제 경로도 없다).
 * 캡처되지 않은 PayPal 주문은 무해하게 만료되므로, 돈이 움직이기 전에 막는 게 정답이다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbHolder: { db: unknown } = { db: null };
const snapshotWrites: Array<{ path: string; data: Record<string, unknown> }> = [];
let slotLockCalls = 0;

vi.mock('../../api/_shared/firebase-admin.js', () => ({ initAdminDb: () => dbHolder.db }));
vi.mock('../../api/_shared/paypal.js', () => ({
  getPaypalAccessToken: async () => ({ accessToken: 'tok', baseUrl: 'https://api.sandbox.paypal.com' }),
  resolveIsSandbox: () => true,
}));
// partial mock — 전체 mock 이면 핸들러가 새 export 를 import 하는 순간 그 접근이 throw 하고,
// outer catch 의 500 으로 삼켜져 부정형 단언만 있는 테스트가 초록으로 남는다
// (payment-p0-crossflow-gate 에서 실제로 발생한 허수). 부작용 함수만 명시적으로 덮는다.
vi.mock('../../api/_shared/slot-capacity.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/_shared/slot-capacity.js')>()),
  acquireSlotLock: async () => { slotLockCalls += 1; return { ok: true }; },
}));
// 환율 모듈은 실 API 3곳(exchangerate-api / frankfurter / naver)을 순차 시도한다.
// 이 파일의 관심사는 스냅샷 fail-closed 지 환율 조회가 아니다 → 고정해 결정론으로 만든다.
// (mock 안 하면 fetch 호출 수가 환율 소스 폴백에 따라 흔들려 "capture 안 부른다" 단언이 흐려진다.)
vi.mock('../../api/_exchange-rate.js', () => ({ getUsdToKrwRaw: async () => 1400 }));

const { default: createPaypalOrder } = await import('../../api/createPaypalOrder.js');

const ORDER_ID = '5O190127TN364715T';

/** snapshot writer 가 있는 정상 db. throwOnSet=true 면 .set() 이 터진다. */
function makeDb(opts: { throwOnSet?: boolean } = {}) {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>) => {
          if (opts.throwOnSet) throw new Error('FIRESTORE_INTERNAL: quota exceeded on project cocotrip-prod');
          snapshotWrites.push({ path: `${name}/${id}`, data });
        },
        get: async () => ({ exists: false, data: () => ({}) }),
      }),
    }),
  };
}

function mockRes() {
  const out = { statusCode: 0, body: '' as string, headers: {} as Record<string, string> };
  return {
    out,
    writeHead(code: number, headers: Record<string, string>) { out.statusCode = code; out.headers = headers; },
    end(body?: string) { out.body = body || ''; },
  };
}

/** AI 플래너 = 디지털 상품이라 예약 마감 검증을 타지 않는다 → 최단 경로. */
function aiPlannerReq() {
  return {
    method: 'POST',
    headers: {},
    body: { productType: 'ai_planner_full', passengers: 1 },
  };
}

async function callHandler(req: unknown) {
  const res = mockRes();
  await createPaypalOrder(req, res);
  return res.out;
}

beforeEach(() => {
  snapshotWrites.length = 0;
  slotLockCalls = 0;
  dbHolder.db = makeDb();
  global.fetch = vi.fn(async () => ({
    ok: true, status: 201,
    json: async () => ({ id: ORDER_ID, status: 'CREATED' }),
  })) as never;
});

describe('createPaypalOrder — 스냅샷 성공 시 정상 주문', () => {
  it('PayPal create 성공 + 스냅샷 set 성공 → 200 + orderID 반환', async () => {
    const out = await callHandler(aiPlannerReq());
    expect(out.statusCode).toBe(200);
    const json = JSON.parse(out.body);
    expect(json.ok).toBe(true);
    expect(json.data.orderID).toBe(ORDER_ID);
    // 스냅샷이 실제로 provenance 필드를 담아 쓰였다.
    expect(snapshotWrites).toHaveLength(1);
    expect(snapshotWrites[0].path).toBe(`paypal_order_snapshots/${ORDER_ID}`);
    expect(snapshotWrites[0].data.productType).toBe('ai_planner_full');
    expect(snapshotWrites[0].data.expectedUSD).toBeTruthy();
    // 통화 명시 저장 — gate 가 legacy 기본값 추정에 의존하지 않게.
    expect(snapshotWrites[0].data.expectedCurrency).toBe('USD');
  });
});

describe('🔴 createPaypalOrder — 스냅샷 실패 = fail-closed', () => {
  it('스냅샷 set 이 throw → 500 SNAPSHOT_FAILED, orderID 미반환', async () => {
    dbHolder.db = makeDb({ throwOnSet: true });
    const out = await callHandler(aiPlannerReq());
    expect(out.statusCode).toBe(500);
    const json = JSON.parse(out.body);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('SNAPSHOT_FAILED');
    // 🔴 핵심: order ID 가 어떤 형태로도 새어나가면 안 된다. 나가면 고객이 결제하고 provenance 없이 남는다.
    expect(out.body).not.toContain(ORDER_ID);
    expect(json.data).toBeUndefined();
  });

  it('Admin DB unavailable (initAdminDb → null) → 동일하게 fail-closed', async () => {
    dbHolder.db = null;
    const out = await callHandler(aiPlannerReq());
    expect(out.statusCode).toBe(500);
    expect(JSON.parse(out.body).code).toBe('SNAPSHOT_FAILED');
    expect(out.body).not.toContain(ORDER_ID);
  });

  it('🔴 실패 응답에 Firestore 내부 오류·프로젝트명·env·secret 미노출', async () => {
    dbHolder.db = makeDb({ throwOnSet: true });
    const out = await callHandler(aiPlannerReq());
    // mock 이 던진 메시지에는 'FIRESTORE_INTERNAL' 과 'cocotrip-prod' 가 들어있다 — 새면 안 된다.
    expect(out.body).not.toContain('FIRESTORE_INTERNAL');
    expect(out.body).not.toContain('cocotrip-prod');
    expect(out.body).not.toContain('quota exceeded');
    expect(out.body).not.toMatch(/FIREBASE_|PAYPAL_|GEMINI_|_SECRET|_KEY/);
    // 사용자에겐 재시도 안내만.
    expect(JSON.parse(out.body).error).toMatch(/retry/i);
  });

  it('🔴 스냅샷 실패 뒤 capture 호출이나 booking 후속처리가 발생하지 않음', async () => {
    dbHolder.db = makeDb({ throwOnSet: true });
    await callHandler(aiPlannerReq());
    // fetch 는 PayPal order create 1회뿐 — capture(/capture) 로 이어지면 안 된다.
    const calls = (global.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0][0])).toContain('/v2/checkout/orders');
    expect(String(calls[0][0])).not.toContain('/capture');
    // 스냅샷 외 다른 컬렉션 write 0 (booking/slot 기록 없음).
    expect(snapshotWrites).toHaveLength(0);
  });

  it('AI 플래너는 slot pre-lock 을 쓰지 않는다 (임시 hold 잔존 없음)', async () => {
    dbHolder.db = makeDb({ throwOnSet: true });
    await callHandler(aiPlannerReq());
    // 디지털 상품이라 좌석 개념이 없다 → 스냅샷 실패가 hold 를 남기지 않는다.
    // ⚠️ 좌석 상품(tour/charter)의 pre-lock ↔ 스냅샷 실패 상호작용은 이 파일에서 미검증이다.
    //   해당 경로는 별도 가격/좌석 셋업이 필요해 여기서 다루지 않았다 — 미검증으로 보고한다.
    expect(slotLockCalls).toBe(0);
  });
});
