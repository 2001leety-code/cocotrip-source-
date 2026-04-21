# Earlybird & Counter 시스템 가이드

## 개요
CocoTrip의 Earlybird 시스템은 초기 고객 유치를 위한 한정 프로모션 메커니즘입니다.

---

## Firestore 구조

### `earlybird/{docId}`
```json
{
  "code": "EARLY50",
  "totalSlots": 50,
  "usedSlots": 12,
  "discount": 0.20,
  "label": "Early Bird 20% OFF",
  "active": true,
  "createdAt": "2025-12-01T00:00:00Z"
}
```

### 접근 규칙
```
match /earlybird/{docId} {
  allow read:  if true;    // 누구나 잔여 수량 확인 가능
  allow write: if false;   // Admin SDK만 수정 가능
}
```

---

## 프론트엔드 통합

### `EarlyBirdBanner` 컴포넌트
- 위치: `src/sections/ads/EarlyBirdBanner.tsx`
- 실시간 Firestore 구독으로 `totalSlots - usedSlots` 잔여 수량 표시
- i18n 키: `t.ads.earlybird.*`

### 카운터 표시 로직
```typescript
const remaining = totalSlots - usedSlots;
// remaining <= 0 이면 "SOLD OUT" 표시
// remaining <= 5 이면 긴급감 강조 (빨간색 + 애니메이션)
```

---

## 프로모코드 연동

### `applyPromoCode.js`에서 검증
```javascript
// GLOBAL_PROMOS 객체에 하드코딩
'EARLY50': { discount: 0.20, label: 'Early Bird 20% OFF', limit: 50, stackable: false }
```

### 제한사항
- `EARLY50`는 **stackable: false** — 다른 쿠폰과 합산 불가
- `limit: 50` — 소진 시 자동 비활성 (프론트엔드 표시만, 서버 측은 수동 관리)

---

## 카운터 업데이트 플로우

```
[사용자 결제 성공]
  → capturePaypalOrder.js
    → booking-processor.js
      → Firestore earlybird/{docId}.usedSlots +1 (Admin SDK)
```

> **주의**: 카운터 증가는 서버사이드에서만 처리.
> 클라이언트는 `allow write: if false` 규칙으로 수정 불가.

---

## 관리자 작업

### 새 Earlybird 캠페인 생성
Firebase Console > Firestore > `earlybird` 컬렉션에서 수동 문서 생성.

### 캠페인 비활성화
`active: false`로 변경하면 프론트엔드에서 배너 미노출.

---

## 관련 파일
| 파일 | 역할 |
|------|------|
| `src/sections/ads/EarlyBirdBanner.tsx` | UI 배너 컴포넌트 |
| `api/applyPromoCode.js` | 프로모코드 검증 |
| `api/capturePaypalOrder.js` | 결제 완료 후 처리 |
| `firestore.rules` | earlybird 읽기 전용 규칙 |
| `src/i18n/index.ts` → `ads.earlybird.*` | 4개 국어 번역 |
