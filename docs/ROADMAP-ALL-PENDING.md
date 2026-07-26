# 🗺️ CocoTrip 전체 잔여 작업 로드맵

**작성일**: 2026-04-21
**기준 커밋**: `3cb4d3f` (main)
**취합 대상**: 감사 + 직전 스프린트 핸드오프 + CLAUDE.md Phase 잔여 + 사용자 의존 이월

> 본 문서는 **앞으로 해야 할 모든 것**을 단일 인덱스로 제공. 각 항목은 우선순위/차단조건/예상시간/관련문서 포함.

---

## 🧭 한눈에 보기 (대시보드)

### 🔴 P0 (즉시)
| # | 작업 | 차단 | 예상 |
|---|------|------|------|
| P0-1 | 리뷰 Firestore Rules 보안 테스트 보강 | - | 30분 |
| P0-2 | A1 쿠폰 E2E 검증 (isUsed 마킹 실증) | PayPal 샌드박스 | 20분 |

### 🟡 P1 (단기, 1~2주)
| # | 작업 | 차단 | 예상 |
|---|------|------|------|
| P1-1 | earlybird/counter 문서 생성 | - | 5분 |
| P1-2 | 리뷰 v2 사진 업로드 | - | 3~4시간 |
| P1-3 | 번들 크기 최적화 (>500KB 청크) | - | 30~60분 |
| P1-4 | OG 이미지 webp→PNG 전환 검토 | 실제 SNS 공유 테스트 | 1시간 |

### 🟢 P2 (중기, 1개월)
| # | 작업 | 차단 | 예상 |
|---|------|------|------|
| P2-1 | D2 eSIM 통합 (Airalo) | Airalo 파트너 가입 | 3~5시간 |
| P2-2 | 리뷰 어드민 모더레이션 | - | 2~3시간 |
| P2-3 | any 타입 점진 제거 (133건) | - | 스프린트 여러 개 |
| P2-4 | untracked docs/scripts 정리 | - | 30분 |
| P2-5 | 환율 API 공통 유틸 분리 | - | 1시간 |
| P2-6 | 환경변수 감사 (Vercel 대시보드) | 사용자 접근 | 30분 |
| P2-7 | 공유 리워드 일일 상한 | - | 1시간 |

### 🔵 P3 (장기, 분기)
| # | 작업 | 차단 | 예상 |
|---|------|------|------|
| P3-1 | AI 플래너 Phase 4 (3-pass 아키텍처) | 사용자 명시적 승인 | 대형 |
| P3-2 | AI 플래너 Phase 6 (제주/경주/전주 DB) | 식당 데이터 수집 | 대형 |
| P3-3 | 어드민 이메일 다중화 | 정책 결정 | 2시간 |
| P3-4 | 리뷰 Gemini/Perspective 자동 필터 | - | 3~4시간 |
| P3-5 | 3000코인→$40 OFF 한정 이벤트 | 기획 결정 | 30분 |

---

# 📂 Section 1 — 보안 / 인프라

## P0-1. 리뷰 Firestore Rules 보안 테스트 보강

**배경**: 스프린트 2에서 reviews + reviewRewards 규칙 추가했지만 `test-firestore-rules-hardening.mjs`에 케이스 편입 확인 안 됨.

**작업**:
- 신규 스크립트 `scripts/test-firestore-rules-reviews.mjs` 작성
- 7케이스 (R1~R7 — 상세는 `HANDOFF-next-sprint-3.md §1.2`)
- 7/7 PASS 확인 후 커밋

**완료 기준**: 자동화 스크립트 + 결과 로그

---

## P2-6. 환경변수 감사

**배경**: 로컬에서 Vercel CLI 로그인 미완 → `vercel env ls` 불가. 필수 키 누락 여부 미확인.

**필수 키 리스트**:
- `GEMINI_API_KEY` (플래너 핵심)
- `GOOGLE_SERVICE_ACCOUNT_KEY` (Firestore Admin)
- `PAYPAL_CLIENT_ID/SECRET` + Sandbox 버전
- `NAVER_CLIENT_ID/SECRET`
- `ODSAY_API_KEY`
- `VITE_FIREBASE_*` 6종
- `VITE_GA_MEASUREMENT_ID`

**작업**: 사용자가 Vercel 대시보드에서 전체 키 존재/값 검증 → AG에게 누락분 전달.

---

## P2-4. untracked 파일 정리

**현재 상태**: `docs/` 7개 + `scripts/` 7개 + `firestore.rules` 백업 3개 untracked.

**작업**:
- 각 파일 의도 확인 후 커밋 or `.gitignore` 추가
- 백업 파일(`firestore.rules.preHardening` 등)은 커밋 유지 권장 (롤백용)

---

# 📂 Section 2 — 결제 / 쿠폰

## P0-2. A1 쿠폰 E2E 검증

**배경**: 스프린트 1에서 `capturePaypalOrder.js`에 `isUsed` 마킹 코드 배포됐으나 Test Mode는 capture 경로 미통과 → 실결제로만 검증 가능.

**사용자 액션**:
1. PayPal 샌드박스 개인 계정 로그인
2. cocotripkr.com 쿠폰 코드(`SAVE-3F2E51` or `SAVE-936DD5`)로 결제
3. `orderId` + `userId` 전달

**AG 검증**:
- Firestore `users/{userId}/coupons/{couponDocId}.isUsed=true` 확인
- 재사용 curl 차단 확인
- `used_paypal_orders/{orderId}` 기록 확인

**완료 시**: AUDIT P1-1 해결 처리.

---

## P2-5. 환율 API 공통 유틸 분리

**현재**: `applyPromoCode.js` + `createPaypalOrder.js` 각각 환율 fetch 로직 중복.

**작업**: `api/_utils/exchangeRate.js` 신규 — `getUsdToKrw({cap = 1350})` 함수로 단일화.

**주의**: 1350 cap은 사업자 보호 로직 — 제거/변경 금지.

---

# 📂 Section 3 — 리뷰 시스템 확장

## P1-2. 리뷰 v2 — 사진 업로드

**스펙**: `HANDOFF-next-sprint-3.md §4` 참조.

**핵심**:
- Firebase Storage 경로 `/reviews/{uid}/{reviewId}/{idx}.jpg`
- 3장 / 5MB / image/* 제한
- `ReviewWriteModal` 파일 input + progress
- `ReviewCard` 썸네일 grid + 라이트박스
- Storage Rules 추가 + i18n 5개 키 ×4 언어

---

## P2-2. 리뷰 어드민 모더레이션

**스펙**: `HANDOFF-next-sprint-3.md §6` 참조.

**핵심**:
- `/admin/reviews` 신규 페이지 (어드민 이메일 검증)
- `moderate` action — keep/hide/delete
- 신고 사유 배열 (`reports: [{reporterUid, reason, createdAt}]`)
- 경량 자동 필터 (동일 IP 5분 3건, URL 포함)

---

## P3-4. Gemini / Perspective API 자동 필터

**장기 확장**: 리뷰 텍스트 → LLM 또는 Perspective API로 혐오/스팸 점수 산출 → threshold 초과 시 자동 `status=reported`.

**예상**: Gemini 2.5 Flash 활용 시 리뷰 1건당 ~$0.001. 월 1000건 기준 $1 이하.

---

# 📂 Section 4 — 신규 매출원

## P2-1. D2 eSIM 통합 (Airalo)

**차단**: Airalo 파트너 가입 대기.

**사용자 전달 필요**:
1. 파트너 ID / API 키
2. 제휴 링크 포맷
3. Tier 권한 (단순 링크 vs REST 임베드)

**사전 작업 (차단 중 가능)**:
- `EsimPromoCard.tsx` 스켈레톤 (placeholder URL)
- i18n `esim` 블록 4개 언어
- GA4 `esim_click` 핸들러 스텁
- 플랜 상세 + MyPage 배치 마크업

**배치 권장**: A (플랜 상세 상단 배너) + D (MyPage My Trips 탭).

**스펙**: `HANDOFF-next-sprint.md §2` 참조.

---

# 📂 Section 5 — 얼리버드 / 프로모

## ~~P1-1. earlybird/counter 문서 생성~~ — ❌ 무효 (2026-07-26)

**배경**: 문서 미생성 → D4 보안 테스트 404. EarlyBirdBanner fallback 경로 사용 중.

**종결 사유**: `EarlyBirdBanner` 컴포넌트가 `src/` 에서 제거돼 얼리버드 배너 자체가 없다.
카운터 문서를 만들 대상이 사라졌고, 생성용 `scripts/create-earlybird-counter.mjs` 도 삭제했다.
자세한 내용은 `docs/HANDOFF-next-sprint-3.md` §3 참조.

---

## P3-5. 3000코인 → $40 OFF 한정 이벤트

**구현 용이**: `api/loyalty.js`의 REDEMPTION_RATES 테이블에 한 줄 추가.

```javascript
3000: { usdValue: 40, bonus: '+33%', limited: true }
```

**기획 결정 필요**: 한정 조건 (선착순 몇 명? 기간?)

---

## P2-7. 공유 리워드 일일 상한

**현재**: `shareRewards/{planId}` 중복 방지로 플랜별 1회 → 사실상 개인당 플랜 수만큼 가능.

**보강안**:
- `users/{uid}/shareStats.dailyCount` 증가
- 하루 5회 초과 시 리워드 0
- UTC 기준 자정 reset (별도 cron 불필요, 타임스탬프 비교로 처리)

---

# 📂 Section 6 — UI/UX / 성능

## P1-3. 번들 크기 최적화

**현재**: 일부 청크 >500KB 경고.

**작업**:
- `vite.config.ts`의 `build.rollupOptions.output.manualChunks` 설정
- 대형 의존성 분리 (firebase, react-query, pdfmake 등)
- `import()` 동적 분할 — 플래너/투어/MyPage 각각 lazy route

**검증**: 빌드 로그에서 >500KB 경고 소멸.

---

## P1-4. OG 이미지 webp → PNG 전환 검토

**배경**: 감사에서 `/api/og-image` webp 2MB 반환. 일부 구형 SNS 봇 호환성 우려.

**검증 우선**: 사용자가 Facebook, 카카오톡, Twitter, LinkedIn, 디스코드에 cocotripkr.com 공유 → 썸네일 렌더 확인.

**실패 시 작업**:
- `@vercel/og` 출력을 PNG로 변환 (`content-type: image/png`)
- 파일 크기 300KB 이하 목표 (Kakao 권장)

---

## P2-3. any 타입 점진 제거

**현재**: 133건 (대부분 `eslint-disable` 포함).

**작업**: 대형 작업 — 스프린트 여러 개로 분할.
- Phase A: `src/pages/` (우선순위 낮음)
- Phase B: `src/components/` (재사용성 높음)
- Phase C: `api/` (런타임 안전성)

**기준**: 커밋당 10~20건 전환, tsc 통과 확인.

---

# 📂 Section 7 — AI 플래너 (CLAUDE.md §G)

## P3-1. Phase 4 — 3-pass 아키텍처

**현재**: Phase 3 완료 (총 이슈 32→9건, -71.9%).

**Phase 4 계획**: 단일 Gemini 호출 → 3-pass 파이프라인
1. Pass 1: 컨셉/구조 생성
2. Pass 2: 상세 채움 (이름/팁/검증)
3. Pass 3: 교통/시간 계산

**차단**: 사용자 명시적 승인 필요 — 호출 비용 3배 증가.

**선결**: Gemini 2.5 Flash 비용 트렌드 + 현재 이슈 9건의 사용자 영향도 재측정.

---

## P3-2. Phase 6 — 제주/경주/전주 DB 수집

**배경**: `_food_index.json`에 해당 지역 식당 부족 → `unverified_restaurant` 주요 원인.

**작업**:
- `food_data/jeju.json` 수집 (Naver Place API 또는 수동)
- `food_data/gyeongju.json`
- `food_data/jeonju.json`
- `scripts/build-food-index.js` 재실행 (rating≥4.5, reviews≥50 필터)
- `api/_food_index.json` 재생성 후 커밋

**주의**: `_food_index.json` 삭제 절대 금지 (CLAUDE.md §B-1).

---

## 보조. 제주 비건 DB 확보

**현재**: 제주+비건 조합 시 100% unverified 발생.

**작업**: 제주 비건/채식 식당 수동 리서치 → `food_data/jeju_vegan.json`.

---

# 📂 Section 8 — 테스트 / 품질

## 자동화 체크리스트 (배포 전)

```bash
# 플래너 품질 (Gemini 5회, ~5분)
node scripts/validate-planner.cjs
# 기준치: 총 이슈 9건 이하

# TypeScript
npx tsc --noEmit

# 빌드
npx tsc -b && npx vite build

# 보안 규칙 (catch-all 제거 검증)
node scripts/test-firestore-rules-hardening.mjs

# 리뷰 규칙 (P0-1 완료 후)
node scripts/test-firestore-rules-reviews.mjs

# 의존성 감사
npm audit --audit-level=critical
```

---

## 수동 스모크 (배포 후)

| 여정 | 확인 |
|------|------|
| J1 홈 | 투어 리스트 로딩 |
| J2 투어 예약 | PayPal SDK 로드 |
| J3 AI 플래너 | 질문지 진입 |
| J4 플랜 상세 | PDF 다운로드 백지 아님 |
| J5 공유 | ShareButton 클릭 → +20P 토스트 |
| J6 MyPage | Gold/Silver 배지 + Redeem UI + Reviews 탭 |

---

# 📂 Section 9 — 사용자 의존 이월 요약

AG가 단독으로 진행 불가 → 사용자 액션 대기:

| # | 항목 | 액션 |
|---|------|------|
| U-1 | A1 쿠폰 E2E | PayPal 샌드박스 로그인 + 실결제 |
| U-2 | OG 이미지 실전 테스트 | Facebook/카카오톡 공유 후 썸네일 확인 |
| U-3 | Airalo 파트너 가입 | https://partners.airalo.com/ |
| U-4 | 환경변수 감사 | Vercel 대시보드 `vercel env ls` |
| U-5 | Phase 4 승인 | 3-pass 아키텍처 비용 증가 승인 |
| U-6 | 어드민 이메일 정책 | 다중화 여부 결정 |
| U-7 | 3000코인 이벤트 기획 | 한정 조건 결정 |

---

# 📂 Section 10 — 스프린트 분할 제안

## 스프린트 3 (다음 세션)
- P0-1 리뷰 Rules 테스트
- P1-1 earlybird/counter
- P1-2 리뷰 v2 사진 업로드
- P2-2 리뷰 어드민 모더레이션
- (사용자 액션 시) P0-2 쿠폰 E2E / P2-1 eSIM

## 스프린트 4
- P1-3 번들 최적화
- P1-4 OG 이미지 전환 (테스트 결과 따라)
- P2-4 untracked 정리
- P2-5 환율 유틸 분리
- P2-7 공유 리워드 일일 상한

## 스프린트 5+
- P2-3 any 타입 제거 (A/B/C 분할)
- P3-2 Phase 6 DB 수집
- P3-4 자동 필터
- P3-1 Phase 4 (승인 후)

---

# 📚 참조 문서

| 문서 | 용도 |
|------|------|
| `CLAUDE.md` | 프로젝트 규칙 (LOCKED, 필드 스키마, Phase 상태) |
| `docs/AUDIT-2026-04-20.md` | 2026-04-20 전체 감사 결과 |
| `docs/HANDOFF-session-0420-final.md` | 스프린트 1 완료 (Rules + D3 Phase 1~3) |
| `docs/HANDOFF-session-0420-sprint2.md` | 스프린트 2 완료 (protobufjs + 리뷰 풀스택) |
| `docs/HANDOFF-next-sprint.md` | eSIM + 리뷰 원본 설계 |
| `docs/HANDOFF-next-sprint-3.md` | 스프린트 3 상세 지시 |
| `docs/HANDOFF-loyalty-phase1.md` | earn-share 패턴 |
| `docs/HANDOFF-loyalty-phase2-3.md` | redeem-coupon + 결제 연동 |
| `firestore.rules` | 현재 강화 버전 |

---

# ✅ 문서 운영 원칙

1. **신규 작업 착수 시**: 이 문서에서 해당 항목 찾아 해당 핸드오프 문서로 점프
2. **완료 시**: 이 문서에서 해당 항목 제거 + 스프린트 보고서에 완료 로그
3. **신규 이슈 발견 시**: 이 문서의 적절한 Section에 P0~P3 판정 후 추가
4. **우선순위 재조정 시**: 대시보드 테이블 동기화

---

**작성**: 2026-04-21
**다음 업데이트**: 스프린트 3 완료 시
**총 항목 수**: P0 2건 / P1 4건 / P2 7건 / P3 5건 + 사용자 의존 7건 = **25건**
