# 🪙 D3 Phase 1 — 공유 리워드 + 포인트 히스토리 UI

**작성일**: 2026-04-20 KST
**프로젝트**: CocoTrip (planning-with-ai-a0801)
**범위**: (A) 플랜 공유 시 +20 Trip Coins 지급, (B) MyPage 포인트 히스토리 탭 UI
**선행 작업**: D1 소셜 공유 + Firestore Rules 강화 (완료)
**난이도**: 🟢 낮음 — 기존 loyalty 인프라 재사용, LOCKED region 안 건드림

---

## 1. 왜 이걸 하는가

D1 공유 기능을 배포했으나 **공유할 동기 부여가 없음**. 20 Trip Coins($0.20 상당)를 지급해 다음 루프를 만든다:

```
플랜 생성 → 공유 → 친구가 본다 → 새 사용자 유입 → 본인 +20코인
                                           ↓
                                     재방문 동기 (마이페이지에서 포인트 확인)
```

부수 효과: 사용자가 본인 MyPage 포인트 탭을 쓰기 시작하면서 **로열티 시스템 전체가 가시화** → Phase 2 (쿠폰 교환) 사용 의사 생김.

---

## 2. 작업 1: 공유 리워드 +20P

### 2.1 데이터 스키마

**신규 컬렉션**: `users/{uid}/shareRewards/{planId}`

| 필드 | 타입 | 용도 |
|---|---|---|
| `planId` | string | 중복 지급 방지 키 |
| `rewardedAt` | Timestamp (serverTimestamp) | 지급 시각 |
| `coinsAwarded` | number | 이 건으로 지급된 코인 (항상 20) |
| `shareMethod` | string | 'native' \| 'clipboard' \| 'native_mini' \| 'clipboard_mini' |

**중복 방지 규칙**: `users/{uid}/shareRewards/{planId}` 문서가 이미 존재하면 지급하지 않는다 (플랜당 1회).

### 2.2 API 변경 — `api/loyalty.js`

기존 파일 하단에 **신규 action 추가** (earn/spend/use-coupon 아래):

```javascript
// ════════════════════════════════════════════════════════
// ACTION: earn-share — 플랜 공유 시 보너스 코인 지급
// 중복 방지: users/{uid}/shareRewards/{planId}
// ════════════════════════════════════════════════════════
if (action === 'earn-share') {
  const { planId, shareMethod } = body;
  const REWARD_COINS = 20;

  if (!planId) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing planId for earn-share' }));
  }

  // 소유 플랜인지 검증 (타인 플랜 공유로 farming 방지)
  const planSnap = await db.collection('plans').doc(planId).get();
  if (!planSnap.exists) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Plan not found' }));
  }
  const planData = planSnap.data();
  if (planData.uid !== userId) {
    res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not your plan' }));
  }

  const result = await db.runTransaction(async (tx) => {
    const rewardRef = db.collection('users').doc(userId)
      .collection('shareRewards').doc(planId);
    const rewardSnap = await tx.get(rewardRef);

    if (rewardSnap.exists) {
      return { alreadyRewarded: true, newBalance: null };
    }

    const userSnap = await tx.get(userRef);
    const currentCoins = userSnap.exists ? (userSnap.data().tripCoins || 0) : 0;
    const newBalance = currentCoins + REWARD_COINS;

    // 유저 코인 증가 (유저 문서가 없으면 생성)
    if (userSnap.exists) {
      tx.update(userRef, { tripCoins: newBalance });
    } else {
      tx.set(userRef, {
        tripCoins: REWARD_COINS,
        tier: 'Bronze',
        totalSpentUSD: 0,
        bookingCount: 0,
      });
    }

    // 중복 방지 마커 생성
    tx.set(rewardRef, {
      planId,
      rewardedAt: FieldValue.serverTimestamp(),
      coinsAwarded: REWARD_COINS,
      shareMethod: shareMethod || 'unknown',
    });

    // 포인트 이력 기록
    const logRef = db.collection('users').doc(userId)
      .collection('pointHistory').doc();
    tx.set(logRef, {
      type: 'earn',
      amount: REWARD_COINS,
      balance: newBalance,
      description: `Share bonus (plan ${planId.slice(0, 8)})`,
      createdAt: Date.now(),
    });

    return { alreadyRewarded: false, newBalance, earnedCoins: REWARD_COINS };
  });

  console.log('[loyalty] earn-share:', userId, planId, result);
  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ success: true, ...result }));
}
```

> ⚠️ **플랜 소유자 검증 필수**: `uid !== userId`면 거부. 공용 플랜 링크를 재공유해서 포인트 farming하는 행위 차단.

### 2.3 Firestore Rules 확장

`firestore.rules`에 `users/{uid}` 블록 내부에 추가:

```
match /shareRewards/{planId} {
  allow read:  if isOwner(uid);   // 본인이 내역 조회 가능
  allow write: if false;          // 서버 전용 (Admin SDK가 기록)
}
```

배포 명령: `firebase deploy --only firestore:rules --project planning-with-ai-a0801`

### 2.4 클라이언트 — `ShareButton.tsx` 수정

두 군데 모두 수정: `handleShare` (ShareButton), `handleShare` (ShareMiniIcon).

**변경점**:
- 공유 성공(native share or clipboard copy) 직후 **fire-and-forget**으로 `POST /api/loyalty { action: 'earn-share', userId, planId, shareMethod }` 호출
- `useAuth()`에서 `user.uid` 획득 (이미 다른 컴포넌트에서 사용 중)
- **비로그인 사용자 공유는 보상 없음** (정상) — `user?.uid` 없으면 API 호출 생략
- 성공 응답 `alreadyRewarded: false`이면 toast로 "+20 Trip Coins earned!" 표시 (i18n 고려)
- `alreadyRewarded: true`면 조용히 무시

**구체적 수정 예시** (`ShareButton` 내 `handleShare`):

```tsx
const handleShare = async () => {
  const title = plan?.itinerary?.tour_title || 'Korea Trip';
  let shareMethod = '';

  if (navigator.share) {
    try {
      await navigator.share({ title, url: shareUrl });
      trackShare('native', planId);
      shareMethod = 'native';
    } catch (e: any) {
      if (e.name !== 'AbortError') console.warn('[ShareButton] share error:', e);
      return;  // 사용자 취소/실패 시 포인트 지급 X
    }
  } else {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(sh.shareSuccess || 'URL copied!');
      trackShare('clipboard', planId);
      shareMethod = 'clipboard';
    } catch {
      toast.error('Failed to copy URL');
      return;
    }
  }

  // 리워드 지급 (fire-and-forget, 소유자만)
  if (isOwner && user?.uid && shareMethod) {
    try {
      const res = await fetch('/api/loyalty', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'earn-share',
          userId: user.uid,
          planId,
          shareMethod,
        }),
      });
      const data = await res.json();
      if (data.success && !data.alreadyRewarded) {
        toast.success(sh.shareReward || `+20 Trip Coins earned!`);
      }
    } catch (e) {
      console.warn('[ShareButton] reward error:', e);
      // 리워드 실패해도 공유 자체는 성공 — 조용히
    }
  }
};
```

`ShareMiniIcon`도 동일 패턴. 단 `isOwner` 프로퍼티가 없으므로 추가하거나, `plan?.uid === user?.uid`로 판정.

### 2.5 i18n 문자열 추가

`src/i18n/*.ts`의 `planDetail.share` 객체에 4개 언어 동시:

```
shareReward: {
  ko: '+20 Trip Coins 적립!',
  en: '+20 Trip Coins earned!',
  ja: 'トリップコイン+20獲得！',
  zh: '获得20 Trip Coins！',
}
```

> ⚠️ CLAUDE.md §E: "새 텍스트 추가 시 ko/en/ja/zh 4개 언어 동시 추가" 규칙 준수.

---

## 3. 작업 2: MyPage 포인트 히스토리 탭 UI

### 3.1 현재 상태 확인 (AG가 먼저 읽을 것)

`src/pages/MyPage.tsx`에 이미:
- `tab: Tab` 상태, `Tab = 'overview' | 'coupons' | 'wishlist' | 'itinerary' | 'history'`
- `useLoyalty()`에서 `pointHistory` 구독 중 (최근 30건)

**확인할 것**: `tab === 'history'` 일 때 실제로 pointHistory를 렌더링하는 섹션이 있는가?
- 있으면 → UI 스타일 폴리싱 + 공유 리워드 항목이 올바로 표시되는지만 검증
- 없거나 플레이스홀더면 → 아래 §3.2 UI 추가

### 3.2 히스토리 탭 UI 구조

```tsx
{tab === 'history' && (
  <div className="space-y-3">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-white font-bold text-lg">Point History</h3>
      <span className="text-white/40 text-sm">
        Balance: <span className="text-[#FFD700] font-bold">{loyalty?.tripCoins ?? 0}</span>
      </span>
    </div>

    {pointHistory.length === 0 ? (
      <div className="text-center py-12 text-white/30">
        <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
        <p>No point activity yet.</p>
        <p className="text-xs mt-1">Share a plan to earn your first Trip Coins!</p>
      </div>
    ) : (
      pointHistory.map((log) => (
        <div key={log.id}
          className="flex items-center justify-between p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <div className="flex-1">
            <p className="text-white/90 text-sm font-medium">{log.description}</p>
            <p className="text-white/40 text-xs mt-0.5">
              {new Date(log.createdAt).toLocaleString()}
            </p>
          </div>
          <div className={`font-bold text-lg ${
            log.type === 'earn' ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {log.type === 'earn' ? '+' : ''}{log.amount}
          </div>
        </div>
      ))
    )}
  </div>
)}
```

**디자인 기준**: `MyPage.tsx`의 다른 탭들(coupons, wishlist)과 시각적으로 통일. 기존 카드 스타일(`bg-white/[0.03] border border-white/[0.08]`) 재사용.

### 3.3 탭 네비게이션 버튼

`history` 탭으로 가는 버튼이 이미 있는지 확인. 없으면 기존 탭 바에 추가:

```tsx
{ key: 'history',  icon: <Clock size={16} />, label: 'History' }
```

---

## 4. Firestore 마이그레이션 필요 여부

**없음**.

- 기존 플랜: 공유한 적 없으니 `shareRewards` 하위 문서 자연스럽게 빈 상태
- 기존 유저 문서: `tripCoins` 필드가 없으면 `earn-share` 트랜잭션이 자동 초기화 (`|| 0`)

---

## 5. 검증 계획

### 5.1 단위 검증 (curl)

```bash
# (1) 공유 리워드 신규 지급
curl -X POST https://cocotripkr.com/api/loyalty \
  -H "Content-Type: application/json" \
  -d '{"action":"earn-share","userId":"<TEST_UID>","planId":"<OWNED_PLAN_ID>","shareMethod":"clipboard"}'
# 기대: { success:true, alreadyRewarded:false, newBalance:<prev+20>, earnedCoins:20 }

# (2) 동일 플랜 재시도 (중복 방지)
curl -X POST ... (same body)
# 기대: { success:true, alreadyRewarded:true, newBalance:null }

# (3) 타인 플랜으로 시도 (소유자 검증)
curl -X POST ... (planId is someone else's)
# 기대: 403 { error: 'Not your plan' }

# (4) 존재하지 않는 planId
curl -X POST ... (planId: 'nonexistent')
# 기대: 404 { error: 'Plan not found' }
```

### 5.2 E2E (프로덕션 수동)

1. 테스트 계정 로그인 (2001leety@gmail.com)
2. 플랜 생성 → 디테일 페이지
3. Share 버튼 클릭 → 클립보드 복사 확인
4. Toast "+20 Trip Coins earned!" 표시 확인
5. MyPage → History 탭 → "Share bonus (plan xxxx)" 항목 +20 표시
6. MyPage → Overview → tripCoins 20 증가 확인
7. 같은 플랜 Share 다시 클릭 → 리워드 toast 안 뜸 (이미 지급됨)
8. Firebase 콘솔 → `users/<uid>/shareRewards/<planId>` 문서 존재 확인

### 5.3 회귀 검증

- [ ] 기존 `earn` (투어 완료) 액션 정상 작동 (브레이킹 체크)
- [ ] 기존 `spend` 액션 정상 작동
- [ ] 기존 `use-coupon` 액션 정상 작동
- [ ] `test-firestore-rules.mjs` + `test-firestore-rules-hardening.mjs` 여전히 all PASS
- [ ] 비로그인 유저가 공유해도 오류 없음 (`user?.uid` 가드)
- [ ] Firestore 룰: 본인 `shareRewards` read OK, 남 거 read 403

---

## 6. 커밋 가이드

**단일 커밋 권장** (D1 때 6→1 통합 이슈 재발 방지 위해 이번엔 본문에 명확히 씀):

```
feat(loyalty): add share reward action + MyPage history tab (D3 Phase 1)

- api/loyalty.js: new 'earn-share' action, awards 20 Trip Coins per shared plan
  - Transactional with dedup via users/{uid}/shareRewards/{planId}
  - Ownership check prevents point farming
- firestore.rules: allow owner read on users/{uid}/shareRewards/{planId}
- src/pages/PlanDetailPage/components/ShareButton.tsx: fire-and-forget reward call
  after successful native share / clipboard copy (owner only)
- src/pages/MyPage.tsx: wire pointHistory tab UI
- src/i18n: add share.shareReward across ko/en/ja/zh

Refs: docs/HANDOFF-loyalty-phase1.md
```

파일 변경 예상:
- `api/loyalty.js` (신규 action 추가)
- `firestore.rules` (shareRewards 규칙 추가)
- `src/pages/PlanDetailPage/components/ShareButton.tsx` (리워드 호출 + ShareMiniIcon에도)
- `src/pages/MyPage.tsx` (history 탭 UI)
- `src/i18n/*.ts` (4개 언어 파일)

---

## 7. 배포 전 체크리스트

- [ ] `api/loyalty.js` earn-share action 추가 (기존 액션 안 건드림)
- [ ] `firestore.rules` shareRewards 규칙 추가 → deploy
- [ ] ShareButton + ShareMiniIcon 둘 다 리워드 호출 추가
- [ ] i18n 4개 언어 동시 추가
- [ ] MyPage history 탭 UI 구현 (또는 기존 폴리싱)
- [ ] 로컬 `npx tsc --noEmit` 통과
- [ ] `npx tsc -b && npx vite build` 성공
- [ ] curl 단위 검증 §5.1 4 케이스 통과
- [ ] 프로덕션 스모크 §5.2 8 스텝 통과
- [ ] 회귀 검증 §5.3 통과

---

## 8. 관련 문서

- `docs/HANDOFF-firestore-rules-hardening.md` — 이 작업의 Firestore 룰 전제
- `api/loyalty.js` — 기존 loyalty API
- `src/hooks/useLoyalty.ts` — 이미 pointHistory 구독 중 (수정 불필요)
- `src/pages/MyPage.tsx` — history 탭 UI 추가 대상
- `src/pages/PlanDetailPage/components/ShareButton.tsx` — 리워드 호출 주입 대상

---

## 9. Phase 2/3 예고 (이번엔 안 함)

**Phase 2 (후속)**: MyPage에 "1000 Trip Coins → $10 OFF 쿠폰 교환" 버튼.
- `api/loyalty.js`의 기존 `spend` 액션 활용 + 쿠폰 문서 생성 로직 추가
- 새 엔드포인트 `redeem-coupon` 또는 `spend`에 `convertToCoupon: true` 옵션

**Phase 3 (후속, 위험)**: AI 플래너 결제($9.90)에 쿠폰 할인 적용.
- `PurchaseSection.tsx` → `PayPalBookingButton`은 **LOCKED region**
- 건드리기 전에 별도 조사 세션 필요 (결제 흐름 전체 리버스 엔지니어링)
- Phase 2 배포 후 사용자가 실제로 쿠폰 교환 기능을 쓰는지 관찰 후 판단

**리뷰 리워드 (별도 스프린트)**: 리뷰 시스템 자체가 없음. 리뷰 데이터 구조 설계 → 작성 UI → 지급 트리거 순으로 풀 스택 필요.
