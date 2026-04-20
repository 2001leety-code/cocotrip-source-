# 🪙💳 D3 Phase 2+3 — 코인→쿠폰 교환 + 결제 연동 + 기존 버그 픽스

**작성일**: 2026-04-20 KST
**프로젝트**: CocoTrip (planning-with-ai-a0801)
**선행**: D3 Phase 1 완료 (`docs/HANDOFF-loyalty-phase1.md`)
**범위**:
- (A) **Phase 2** — MyPage에서 Trip Coins를 쿠폰으로 교환
- (B) **Phase 3** — 결제 시 쿠폰 자동 적용 + 소진 처리 (대부분 인프라 재사용)
- (C) **Bug fixes** — `applyPromoCode.js` 로직 오류 + 쿠폰 isUsed 누락
**난이도**: 🟡 중간 — Phase 2는 신규, Phase 3은 기존 코드 수정 위주. LOCKED region의 PayPal SDK/createOrder/onApprove 핵심부는 **건드리지 않음**.

---

## 0. 사전 조사 결과 (AG는 이 섹션 먼저 읽을 것)

### 0.1 좋은 소식 — Phase 3 인프라가 이미 존재

`src/components/PayPalBookingButton.tsx`에:
- **프로모 코드 입력 UI** 이미 구현 (L367-403)
- **할인 적용 로직** 이미 구현 (L62-100, L102 `effectiveKRW`, L257 `discountedPrice` 전달)
- **Firestore 쿠폰 지원** `applyPromoCode.js` L29-79에서 `users/{uid}/coupons` 조회

→ **Phase 3의 UI/결제 파이프라인은 추가 구현 필요 없음**. 쿠폰만 발급하면 기존 입력창에 코드 붙여넣어서 할인 작동.

### 0.2 나쁜 소식 — 기존 코드에 **버그 2건**

**Bug #1**: `api/applyPromoCode.js` L62-64
```javascript
const discount = coupon.type === 'fixed'
  ? coupon.value / (originalPrice || 1)   // ❌ originalPrice가 함수 스코프 밖!
  : coupon.value / 100;
```
`verifyFirestoreCoupon(userId, code)` 함수 내부에 `originalPrice` 변수가 정의돼 있지 않음. 런타임에 `ReferenceError` 또는 상위 스코프 오염. Phase 2에서 fixed $5/$10 쿠폰 발급 시 이 함수를 반드시 타게 되므로 **반드시 픽스**.

**Bug #2**: 결제 성공 후 쿠폰 `isUsed: true` 처리 없음
- `api/capturePaypalOrder.js` L43, 70 — `couponApplied`를 받긴 하지만 단순 로그용으로 `booking-processor.js`에 전달만.
- `api/booking-processor.js` L99, 138 — 구글시트 로그용으로만 사용.
- **어디서도 Firestore `users/{uid}/coupons/{couponId}` 문서의 `isUsed`를 true로 업데이트하지 않음**.
- 현재 상태: 사용자가 WELCOME5 쿠폰 1개 받아도 **몇 번이고 재사용 가능**. (아직 개인 쿠폰 발급 기능이 본격 가동되지 않아 노출 안 됐을 뿐.)

→ Phase 2에서 교환 기능 켜기 전에 Bug #2를 반드시 픽스. 안 하면 코인 교환한 쿠폰을 무한 재사용하는 포인트 농장 생성.

---

## 1. Phase 2 — 코인→쿠폰 교환

### 1.1 UX 설계

MyPage에 교환 UI. **기존 `coupons` 탭을 확장**하는 방식 권장 (새 탭 말고):

```
[Coupons 탭]
  ┌─ 🎁 Redeem Trip Coins ─────────────────┐
  │  Your balance: 1,455 coins             │
  │                                         │
  │  [ 500 coins → $5 OFF ]  (valid 90 days)│
  │  [ 1,000 coins → $10 OFF ]              │
  │  [ 2,000 coins → $25 OFF ] BONUS        │
  └─────────────────────────────────────────┘

  Active coupons (2):
  • SAVE-A3K7Q9  — $10 OFF  (expires May 20, 2026)     [Copy]
  • WELCOME5     — 5% OFF   (expires Dec 31, 2026)     [Copy]
```

교환 버튼 누르면 → confirm 모달 → `redeem-coupon` API 호출 → 성공 시 코드 복사 안내 토스트.

### 1.2 교환 레이트 (고정)

| 코인 | 쿠폰 가치 | 실효 환율 | 보너스 |
|---|---|---|---|
| 500 | $5 OFF | 1:1 ($0.01/coin = $5) | — |
| 1,000 | $10 OFF | 1:1 | — |
| 2,000 | $25 OFF | 1:1.25 | +25% 보너스 |

→ 보너스 레벨을 두어 사용자가 큰 단위 교환하도록 유도. 코인 재고가 쌓이면 이벤트로 3,000/$40 임시 오픈 등 확장 가능.

### 1.3 데이터 스키마 — 쿠폰 문서

기존 `users/{uid}/coupons/{couponId}` 구조 (`useLoyalty.ts` `Coupon` 인터페이스) 그대로 사용:

```javascript
{
  code: 'SAVE-A3K7Q9',          // 6자 랜덤 (crypto.randomBytes)
  type: 'fixed',
  value: 10,                    // USD 단위 ($10)
  currency: 'USD',
  label: 'Trip Coins redemption — $10 OFF',
  minOrderUSD: 0,               // 최소 주문액 없음
  isUsed: false,
  expiresAt: Date.now() + 90 * 24 * 3600 * 1000,  // 90일
  createdAt: Date.now(),
  source: 'coin_redemption',    // 신규 필드 — 교환으로 발급됨 표시
  coinsSpent: 1000,             // 신규 필드 — 원본 코인 수량
}
```

### 1.4 API 신규 액션 — `api/loyalty.js`

기존 파일 하단 (`earn-share` 뒤)에 추가:

```javascript
// ════════════════════════════════════════════════════════
// ACTION: redeem-coupon — 코인 → 쿠폰 교환
// ════════════════════════════════════════════════════════
if (action === 'redeem-coupon') {
  const { coins } = body;

  // 교환 레이트 테이블 (서버 신뢰 소스 — 클라이언트 값 신뢰 X)
  const REDEMPTION_TABLE = {
    500:  { usdValue: 5,  label: 'Trip Coins redemption — $5 OFF'  },
    1000: { usdValue: 10, label: 'Trip Coins redemption — $10 OFF' },
    2000: { usdValue: 25, label: 'Trip Coins redemption — $25 OFF (Bonus)' },
  };

  const plan = REDEMPTION_TABLE[coins];
  if (!plan) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid redemption tier' }));
  }

  // 쿠폰 코드 생성 (6자, crypto 기반)
  const { randomBytes } = await import('crypto');
  const code = 'SAVE-' + randomBytes(3).toString('hex').toUpperCase();

  const result = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) throw new Error('User not found');

    const currentCoins = userSnap.data().tripCoins || 0;
    if (currentCoins < coins) throw new Error('Insufficient Trip Coins');

    const newBalance = currentCoins - coins;

    // 1) 유저 코인 차감
    tx.update(userRef, { tripCoins: newBalance });

    // 2) 쿠폰 문서 생성
    const couponRef = db.collection('users').doc(userId).collection('coupons').doc();
    const now = Date.now();
    const expiresAt = now + 90 * 24 * 3600 * 1000;

    tx.set(couponRef, {
      code,
      type: 'fixed',
      value: plan.usdValue,
      currency: 'USD',
      label: plan.label,
      minOrderUSD: 0,
      isUsed: false,
      expiresAt,
      createdAt: now,
      source: 'coin_redemption',
      coinsSpent: coins,
    });

    // 3) 포인트 이력
    const logRef = db.collection('users').doc(userId).collection('pointHistory').doc();
    tx.set(logRef, {
      type: 'spend',
      amount: -coins,
      balance: newBalance,
      description: `Redeemed ${coins} coins → ${plan.label}`,
      createdAt: now,
    });

    return {
      couponId: couponRef.id,
      code,
      value: plan.usdValue,
      expiresAt,
      newBalance,
    };
  });

  console.log('[loyalty] redeem-coupon:', userId, result);
  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ success: true, ...result }));
}
```

> ⚠️ **서버 신뢰 원칙**: 레이트 테이블 (`REDEMPTION_TABLE`)은 **서버에서만** 정의. 클라이언트가 보낸 `usdValue`는 무시. 사용자가 DevTools로 `coins: 100, usdValue: 999` 보내도 차단됨.

### 1.5 클라이언트 — MyPage 교환 UI

`src/pages/MyPage.tsx`의 `coupons` 탭 위쪽에 Redeem 섹션 추가. 핵심 로직:

```tsx
// MyPage 컴포넌트 상단
const { loyalty, coupons, activeCoupons, ... } = useLoyalty();
const [redeeming, setRedeeming] = useState<number | null>(null);

async function handleRedeem(coins: number) {
  if (!user?.uid) return;
  if ((loyalty?.tripCoins ?? 0) < coins) {
    toast.error(t.mypage.insufficientCoins || 'Not enough Trip Coins');
    return;
  }
  if (!confirm(`Redeem ${coins} coins?`)) return;

  setRedeeming(coins);
  try {
    const res = await fetch('/api/loyalty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'redeem-coupon', userId: user.uid, coins }),
    });
    const data = await res.json();
    if (data.success) {
      toast.success(`Coupon ${data.code} ready! ($${data.value} OFF)`);
      // 자동 클립보드 복사
      navigator.clipboard?.writeText(data.code).catch(() => {});
    } else {
      toast.error(data.error || 'Redemption failed');
    }
  } catch {
    toast.error('Network error');
  } finally {
    setRedeeming(null);
  }
}
```

**UI 렌더링** (기존 `coupons` 탭 최상단):

```tsx
{tab === 'coupons' && (
  <div className="space-y-6">
    {/* 교환 섹션 */}
    <div className="rounded-2xl bg-gradient-to-br from-[#FFD700]/8 to-[#7C5CFC]/8 border border-[#FFD700]/20 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-white flex items-center gap-2">
            <Gift className="w-4 h-4 text-[#FFD700]" />
            Redeem Trip Coins
          </h3>
          <p className="text-xs text-white/50 mt-0.5">
            Balance: <span className="text-[#FFD700] font-semibold">{loyalty?.tripCoins ?? 0}</span> coins
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { coins: 500,  value: 5,  bonus: false },
          { coins: 1000, value: 10, bonus: false },
          { coins: 2000, value: 25, bonus: true  },
        ].map(tier => {
          const enabled = (loyalty?.tripCoins ?? 0) >= tier.coins;
          const busy = redeeming === tier.coins;
          return (
            <button
              key={tier.coins}
              onClick={() => handleRedeem(tier.coins)}
              disabled={!enabled || busy}
              className={`relative p-4 rounded-xl border transition-all ${
                enabled
                  ? 'border-[#FFD700]/30 bg-white/[0.04] hover:bg-white/[0.08] hover:border-[#FFD700]/50'
                  : 'border-white/5 bg-white/[0.02] opacity-40 cursor-not-allowed'
              }`}
            >
              {tier.bonus && (
                <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#EA537E] text-white">
                  +25% BONUS
                </span>
              )}
              <div className="text-white/60 text-xs">{tier.coins} coins</div>
              <div className="text-white text-xl font-bold mt-1">${tier.value}</div>
              <div className="text-white/40 text-[10px] mt-0.5">OFF coupon</div>
              {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-xl"><div className="w-5 h-5 border-2 border-[#FFD700] border-t-transparent rounded-full animate-spin" /></div>}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-white/30 mt-3 text-center">
        Valid for 90 days. Enter code at checkout.
      </p>
    </div>

    {/* 기존 활성 쿠폰 리스트 — 기존 UI 유지 */}
    <div className="space-y-2">
      ... (기존 activeCoupons 렌더링)
    </div>
  </div>
)}
```

### 1.6 i18n 문자열 (4개 언어)

`src/i18n/index.ts`의 `mypage` 또는 적절한 네임스페이스에 추가:

```
redeemTitle: ko '트립 코인 교환' / en 'Redeem Trip Coins' / ja 'トリップコイン交換' / zh '兑换Trip Coins'
redeemBalance: 'Balance' 번역
redeemBonus: '+25% BONUS' 번역
redeemSuccess: '쿠폰이 발급되었습니다' 번역
redeemValidity: '90일간 유효. 결제 시 코드 입력.' 번역
insufficientCoins: '코인이 부족합니다' 번역
```

CLAUDE.md §E: 4개 언어 동시 추가 필수.

### 1.7 Firestore Rules 영향

**변경 없음**. 기존 D3 Phase 1에서 설정한 규칙 유지:
- `users/{uid}/coupons/{couponId}` — 본인 read, write: false (서버 전용)
- Admin SDK가 룰 우회하므로 `tx.set(couponRef, ...)` 동작.

배포 불필요.

---

## 2. Phase 3 — 결제 연동 + 쿠폰 소진

### 2.1 Bug #1 픽스 — `api/applyPromoCode.js` L62-74

**현재 (버그)**:
```javascript
async function verifyFirestoreCoupon(userId, code) {
  ...
  const discount = coupon.type === 'fixed'
    ? coupon.value / (originalPrice || 1)   // ❌ originalPrice 미정의
    : coupon.value / 100;

  return { couponDocId, userId, discount, label, type, value, stackable: true };
}
```

**수정 후**:
```javascript
async function verifyFirestoreCoupon(userId, code) {
  ...
  // fixed/percent 둘 다 raw 값 반환 — 할인 계산은 호출 측에서
  return {
    couponDocId: couponDoc.id,
    userId,
    label: coupon.label,
    type: coupon.type,              // 'fixed' | 'percent'
    value: coupon.value,            // fixed: USD 금액 / percent: 퍼센트 숫자(5 = 5%)
    currency: coupon.currency || 'USD',
    stackable: true,
  };
}
```

그리고 handler 단일 코드 분기 (L171-189)를 수정:

```javascript
// 2. Firestore 개인 쿠폰 확인
const fsCoupon = await verifyFirestoreCoupon(userId, upper);
if (fsCoupon) {
  let savedAmount;
  let discountRate;

  if (fsCoupon.type === 'fixed' && fsCoupon.currency === 'USD') {
    // USD 고정 금액 쿠폰 → KRW 환산
    // 환율은 기존 결제 시스템과 동일한 간이 상수 사용 (PayPalBookingButton.tsx L277)
    const KRW_PER_USD = 1350;
    const discountKRW = fsCoupon.value * KRW_PER_USD;
    savedAmount = Math.min(discountKRW, originalPrice);  // 주문액 초과 방지
    discountRate = savedAmount / originalPrice;
  } else if (fsCoupon.type === 'percent') {
    discountRate = fsCoupon.value / 100;
    savedAmount = Math.round(originalPrice * discountRate * 100) / 100;
  } else {
    // 기타 통화/타입 — 무시
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ valid: false, error: 'unsupported_coupon_type' }));
  }

  const discountedPrice = Math.round((originalPrice - savedAmount) * 100) / 100;

  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({
    valid: true,
    code: upper,
    label: fsCoupon.label,
    discountRate,
    originalPrice,
    savedAmount,
    discountedPrice,
    stackable: fsCoupon.stackable,
    couponDocId: fsCoupon.couponDocId,   // 신규 — 소진 처리용으로 클라이언트에 전달
    userId: fsCoupon.userId,
  }));
}
```

복수 코드 분기 (L99-141)도 동일 패턴으로 수정 — `if (fsCoupon && fsCoupon.stackable)` 내부 할인 계산을 새 로직으로 교체.

> ⚠️ **환율 상수 일치**: `PayPalBookingButton.tsx` L277에서 `priceKRW / 1350`을 사용. 동일한 1350으로 맞춰야 UI 표시와 실 할인이 일치.

### 2.2 Bug #2 픽스 — 결제 성공 후 쿠폰 소진

**옵션 A (권장)**: `createPaypalOrder.js`가 `couponDocId` + `userId`를 저장하게 하고, `capturePaypalOrder.js`가 성공 시 `loyalty.js`의 기존 `use-coupon` action 호출.

**옵션 B**: `capturePaypalOrder.js`가 직접 Firestore 업데이트.

옵션 B가 호출 단계 적어서 더 단순. 아래 옵션 B로 진행:

**`createPaypalOrder.js` 수정** — 요청 body에 `couponDocId`, `userId` 추가로 받아서 orderID와 함께 임시 매핑 저장. (세부 위치는 AG가 파일 읽고 결정)

**`capturePaypalOrder.js` 수정** — capture 성공 분기에서:
```javascript
// capture 성공 후 — 쿠폰 소진 처리
const { couponDocId, userId: couponUserId } = body;
if (couponDocId && couponUserId) {
  try {
    const { initializeApp, cert, getApps } = await import('firebase-admin/app');
    const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
    // ... (기존 loyalty.js와 동일한 credential 로딩)
    const db = getFirestore();
    await db.collection('users').doc(couponUserId)
      .collection('coupons').doc(couponDocId)
      .update({ isUsed: true, usedAt: FieldValue.serverTimestamp() });
    console.log('[capture] coupon marked used:', couponDocId);
  } catch (err) {
    // 쿠폰 소진 실패해도 결제는 성공 처리 (사용자 경험)
    console.error('[capture] coupon update failed:', err.message);
  }
}
```

> ⚠️ **트랜잭션 없음 허용**: 결제 capture는 이미 PayPal API 호출로 성공한 뒤이므로, Firestore 업데이트가 실패해도 재시도 불가. 단순 `update` + 실패 로그로 충분. 최악의 경우 드물게 재사용 가능 쿠폰이 남을 수 있으나 빈도 낮음.

### 2.3 `PayPalBookingButton.tsx` 프롭 전달 수정

L77-100 `handleApplyPromo` → 서버 응답에서 받은 `couponDocId` + `userId`를 상태에 저장:

```tsx
const [couponDocId, setCouponDocId] = useState<string | null>(null);
const [couponUserId, setCouponUserId] = useState<string | null>(null);

// handleApplyPromo 내 data.valid 분기
if (data.valid) {
  setDiscountedKRW(data.discountedPrice);
  setSavedAmount(data.savedAmount);
  setPromoApplied(true);
  setCouponDocId(data.couponDocId || null);
  setCouponUserId(data.userId || null);
}
```

L251 `createPaypalOrder` 호출에 추가:
```tsx
body: JSON.stringify({
  productType, passengers, dateStart, dateEnd, language: lang, userEmail,
  ...(promoApplied ? { promoCode, discountedPrice: effectiveKRW } : {}),
  ...(couponDocId ? { couponDocId, couponUserId } : {}),   // 신규
}),
```

L168-184 `capturePaypalOrder` 호출에도 동일하게 `couponDocId`, `couponUserId` 포함.

> ⚠️ **LOCKED region 경계**: `createOrder`/`onApprove` 내부의 PayPal SDK 호출 로직(`window.paypal.Buttons({...})` L164-225)은 **안 건드림**. 우리가 수정하는 건 body payload 생성부만.

---

## 3. 검증 계획

### 3.1 Phase 2 단위 검증 (curl)

```bash
# (1) 정상 교환 (1000 coins → $10 쿠폰)
curl -X POST https://cocotripkr.com/api/loyalty \
  -H "Content-Type: application/json" \
  -d '{"action":"redeem-coupon","userId":"<TEST_UID>","coins":1000}'
# 기대: { success:true, code:"SAVE-XXXXXX", value:10, expiresAt:<ts>, newBalance:<prev-1000> }

# (2) 잔고 부족
curl ... -d '{"action":"redeem-coupon","userId":"<TEST_UID>","coins":10000}'
# 기대: 500 { error: 'Insufficient Trip Coins' }

# (3) 존재하지 않는 tier
curl ... -d '{"action":"redeem-coupon","userId":"<TEST_UID>","coins":777}'
# 기대: 400 { error: 'Invalid redemption tier' }

# (4) 서버 레이트 조작 시도 (클라이언트가 usdValue 보내도 서버 무시)
curl ... -d '{"action":"redeem-coupon","userId":"<TEST_UID>","coins":500,"usdValue":99999}'
# 기대: 성공, value: 5 (서버 테이블 값). usdValue 필드 무시 확인
```

### 3.2 Phase 3 단위 검증 (applyPromoCode 버그 픽스)

```bash
# (5) 신규 발급된 $10 쿠폰 검증
curl -X POST https://cocotripkr.com/api/applyPromoCode \
  -H "Content-Type: application/json" \
  -d '{"code":"SAVE-XXXXXX","originalPrice":13300,"userId":"<TEST_UID>"}'
# 기대: valid:true, savedAmount:13300 (min(13500,13300)=13300), discountedPrice:0
# 1350 KRW × $10 = 13500, 주문액 13300 초과 → cap 13300

# (6) 동일 쿠폰 두 번째 호출 (결제 전)
curl ... (same)
# 기대: valid:true (아직 isUsed false). 결제 완료 후부터 실패해야 함.
```

### 3.3 E2E 결제 플로우 (샌드박스)

테스트 계정 `2001leety@gmail.com`은 `TEST_ACCOUNTS`에 등록돼 있어 **Test Mode: Skip Payment** 버튼 노출됨 (`PayPalBookingButton.tsx` L454). 이거 활용하면 실제 결제 없이 capture 경로만 탐.

**⚠️ Test Mode는 `createPaypalOrder`/`capturePaypalOrder`를 호출하지 않고 바로 `onPaymentSuccess('TEST-...')` 호출함**. 따라서 Test Mode로는 쿠폰 소진 로직 검증이 불가.

→ Phase 3 쿠폰 소진은 **실제 샌드박스 PayPal 결제**로 검증해야 함. `isSandboxAccount` 분기로 sandbox SDK 로드 (L137-141) — 이메일 `2001leety@gmail.com` 쓰고 PayPal 샌드박스 계정으로 실제 결제.

**수동 절차**:
1. 로그인, MyPage → Redeem 500 coins → `SAVE-ABC123` 발급 확인
2. Firebase 콘솔에서 `users/<uid>/coupons/<couponId>` 문서 존재 + `isUsed: false` 확인
3. 플래너 생성, 결제 화면 도달, 코드 `SAVE-ABC123` 입력 → "Discount applied" 표시
4. 환율 표시 확인 — 할인 후 KRW 정상
5. PayPal 샌드박스로 실결제
6. 결제 완료 모달 표시 확인
7. Firebase 콘솔 → 해당 coupon 문서 `isUsed: true, usedAt: <timestamp>` 확인
8. 같은 코드 재입력 → `invalid_code` 오류 (Firestore `where('isUsed','==',false)` 필터로 탈락)
9. MyPage → pointHistory에 "Redeemed 500 coins → $5 OFF" 항목 표시

### 3.4 회귀 검증

- [ ] 기존 `earn-share` 정상 (Phase 1 영향 없는지)
- [ ] 기존 `earn` (투어 완료) 정상
- [ ] 기존 `spend`, `use-coupon` 정상
- [ ] 글로벌 프로모 `EARLY50`, `COCO5` 여전히 작동 (percent 로직 안 깨짐)
- [ ] 기존 `WELCOME5` (신규 가입 보너스)가 있다면 percent 로직으로 fallback 작동
- [ ] Firestore rules 테스트 두 세트 (기본 3 + 강화 10) 여전히 13/13 PASS
- [ ] `tsc --noEmit` + `vite build` 성공

---

## 4. 파일 변경 목록

| 파일 | 변경 내용 |
|---|---|
| `api/loyalty.js` | `redeem-coupon` action 추가 |
| `api/applyPromoCode.js` | Bug #1 픽스 (fixed USD → KRW 변환), `couponDocId`/`userId` 응답에 포함 |
| `api/createPaypalOrder.js` | body에서 `couponDocId`/`couponUserId` 수신 (저장 불필요 — capture에 그대로 전달할 수 있으면 pass-through) |
| `api/capturePaypalOrder.js` | Bug #2 픽스 — capture 성공 후 쿠폰 `isUsed: true` 마킹 |
| `src/components/PayPalBookingButton.tsx` | `couponDocId` 상태 + create/capture body에 추가 (LOCKED 핵심부 안 건드림) |
| `src/pages/MyPage.tsx` | Redeem UI (coupons 탭 확장) |
| `src/i18n/index.ts` | 4개 언어 교환 관련 문자열 |

---

## 5. 커밋 가이드

### 5.1 권장 커밋 분할 (D1 6→1 이슈 재발 방지)

실제로 이번엔 **Phase 2와 Phase 3을 분리**해서 2커밋으로 나누기를 권장:

**Commit 1 — Phase 2 단독** (사용자가 일단 교환만 써볼 수 있게):
```
feat(loyalty): add coin-to-coupon redemption (D3 Phase 2)

- api/loyalty.js: new 'redeem-coupon' action with 3-tier redemption table
  (500/1000/2000 coins → $5/$10/$25 USD coupons, 90-day validity)
- src/pages/MyPage.tsx: Redeem UI in Coupons tab with auto-clipboard-copy
- src/i18n: 4-language strings for redemption flow
- Coupons write through Admin SDK — Firestore rules unchanged
```

**Commit 2 — Phase 3 + Bug fixes**:
```
fix(payments): harden coupon flow — USD→KRW conversion + redemption on capture (D3 Phase 3)

- api/applyPromoCode.js: fix undefined originalPrice reference in verifyFirestoreCoupon;
  convert USD fixed coupons to KRW using same 1350 rate as UI
- api/capturePaypalOrder.js: mark coupon as isUsed after successful PayPal capture
  (previously coupons were infinitely reusable)
- api/createPaypalOrder.js: pass couponDocId/couponUserId through to capture
- src/components/PayPalBookingButton.tsx: forward couponDocId to order/capture
  (LOCKED PayPal SDK region untouched — only body payload)
```

이렇게 하면 Phase 2 배포 후 문제 없으면 Phase 3 배포. 문제 생기면 rollback 단위가 작음.

### 5.2 배포 전 체크리스트

**Phase 2**:
- [ ] `api/loyalty.js` redeem-coupon action 추가
- [ ] MyPage Redeem UI 구현
- [ ] i18n 4개 언어
- [ ] curl §3.1 4케이스 PASS
- [ ] tsc + vite build 성공
- [ ] 배포
- [ ] 프로덕션 500코인 교환 → MyPage 활성 쿠폰에 새 코드 표시 확인

**Phase 3 (Phase 2 배포 후 진행)**:
- [ ] `applyPromoCode.js` Bug #1 픽스
- [ ] `capturePaypalOrder.js` 쿠폰 소진 로직 추가
- [ ] `createPaypalOrder.js` 파라미터 pass-through
- [ ] `PayPalBookingButton.tsx` state + body 수정 (LOCKED 핵심부 건드리지 않음 확인)
- [ ] curl §3.2 2케이스 PASS
- [ ] 회귀 §3.4 통과
- [ ] E2E §3.3 샌드박스 결제 9 스텝 완료
- [ ] Firebase 콘솔에서 isUsed 업데이트 육안 확인
- [ ] 같은 쿠폰 재사용 시도 → 차단 확인
- [ ] 배포

---

## 6. 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| Phase 3 샌드박스 결제 테스트에 시간 걸림 | 검증 지연 | Test Mode는 capture 경로 안 타므로 반드시 sandbox PayPal 실결제 필요. 예상 20분. |
| 환율 1350 하드코딩 → 실제 환율과 괴리 | 사용자 체감 할인액 ≠ 실제 | 기존 시스템(PayPalBookingButton L277)도 동일 1350 사용 중. 일관성 유지 우선. 향후 공통 상수 or rate API 이관은 별도 과제. |
| `createPaypalOrder` / `capturePaypalOrder`가 LOCKED에 해당하는지 불확실 | 수정 시 결제 장애 | CLAUDE.md는 `PayPalBookingButton` 내부의 PDF 관련 부분은 명시하지 않음. 결제 API는 LOCKED에 속하지 않음 (단지 민감). 수정 시 E2E 필수. |
| 쿠폰 소진 실패 → 재사용 가능 | 드물게 포인트 농장 가능 | capture 성공 후 업데이트 실패는 로그만. Phase 3 배포 후 1주 모니터링 로그에서 "coupon update failed" 빈도 확인. |
| 사용자가 교환 후 "못 쓰는 쿠폰" 혼란 | 지원 티켓 증가 | Redeem 성공 토스트에 코드 자동 복사 + "Enter at checkout" 안내 문구. 9개 언어 번역. |

---

## 7. Phase 3 이후 (스코프 밖)

- **3,000 coins → $40 OFF (한정 이벤트)** — 레이트 테이블 동적화
- **공유 리워드 쿨다운** — 하루 N건 제한 (Phase 1 현재 무제한 per plan, 다만 planId dedup이라 실제 시 낮음)
- **쿠폰 expiresAt 자동 정리** — 만료된 쿠폰 숨김 (현재 `useLoyalty.ts` activeCoupons 필터에서 이미 제외, OK)
- **환율 API 실시간 연동** — 현재 1350 하드코딩 → 미국 환율 급변 시 별도 이슈
- **리뷰 리워드 시스템** — 리뷰 수집 UI 자체가 없어서 별도 스프린트

---

## 8. 관련 문서

- `docs/HANDOFF-loyalty-phase1.md` — Phase 1 (earn-share)
- `docs/HANDOFF-session-0420.md` — Phase 1 완료 보고
- `api/loyalty.js` — 기존 earn/spend/use-coupon + 이번에 redeem-coupon 추가
- `api/applyPromoCode.js` — 프로모 코드 검증 (Bug #1 위치)
- `api/capturePaypalOrder.js` — 결제 capture (Bug #2 위치)
- `src/components/PayPalBookingButton.tsx` — 결제 UI (LOCKED 경계 주의)
- `src/hooks/useLoyalty.ts` — 쿠폰/포인트 구독 (수정 없음, 이미 완비)
