---
plan: Plan-detail ad slides full i18n
created: 2026-04-24
trigger: 사용자 스샷에서 KO 모드인데 광고 슬라이드 5개가 영어 표시 (HotelAd / CharterBanner / CarRentalAd / AirportPickupAd / FlightAd). EsimAd만 i18n 적용됨.
related-mistake-cat: 13 (i18n 폴백 영어 노출)
---

# Plan-Detail Ad Slides Full i18n

## 1. 목표
프로덕션에서 KO/JA/ZH 사용자가 보는 광고 슬라이드 5개의 영어 노출 제거. EsimAd 패턴(`useLanguage()` + `t.planner?.<key>`)으로 통일.

## 2. 영향 범위

### 수정 파일 (5개 광고)
| 파일 | 현재 줄 수 | 수정 후 예상 | 판정 |
|---|---|---|---|
| [HotelAd.tsx](src/pages/PlanDetailPage/components/ads/HotelAd.tsx) | 37 | ~45 | 🟢 |
| [AirportPickupAd.tsx](src/pages/PlanDetailPage/components/ads/AirportPickupAd.tsx) | 42 | ~50 | 🟢 |
| [CharterBanner.tsx](src/pages/PlanDetailPage/components/ads/CharterBanner.tsx) | 130 | ~140 | 🟢 |
| [CarRentalAd.tsx](src/pages/PlanDetailPage/components/ads/CarRentalAd.tsx) | 34 | ~42 | 🟢 |
| [FlightAd.tsx](src/pages/PlanDetailPage/components/ads/FlightAd.tsx) | 35 | ~43 | 🟢 |

### 신규 파일
없음. 컴포넌트 이미 분리되어 있음.

### i18n 키 (4개 언어 동시 추가)
컴포넌트별 신규 키:

| 광고 | 신규 i18n 키 |
|---|---|
| Hotel | `adHotelTitle`, `adHotelSub`, `adAffiliateNote` (재사용) |
| AirportPickup | `adPickupTitle`, `adPickupSub`, `adPickupCta` |
| Charter | `adCharterTitle`, `adCharterSub`, `adCharterFeatEnglish`, `adCharterFeatDoor`, `adCharterFeatWifi`, `adCharterFeatLuggage`, `adCharterCtaInApp`, `adCharterCtaWa` |
| CarRental | `adCarTitle`, `adCarSub`, `adAffiliateNote` (공유) |
| Flight | `adFlightTitle`, `adFlightSub`, `adAffiliateNote` (공유) |

**총 신규 키 약 16개 × 4개 언어 = 64개 string** (`adAffiliateNote`는 공통 1개만)

### 백엔드 변경
없음. 순수 프론트 컴포넌트 i18n 작업.

## 3. 파일 크기 사전 체크 (cat 12)
모든 대상 파일 200줄 이내. Lock 표 (`coding-rules.md` §6.1) 해당 없음.

## 4. 아키텍처

### 패턴 (EsimAd 기준)
```tsx
import { useLanguage } from '@/hooks/useLanguage';

export function HotelAd({ region }: HotelAdProps) {
  const { t } = useLanguage();
  const p = t.planner as Record<string, string | undefined>;
  // ...
  <p className="font-bold text-white text-base leading-tight">
    {p.adHotelTitle || 'Find Your Perfect Hotel'}
  </p>
  <p className="text-xs text-white/50 mt-0.5">
    {(p.adHotelSub || 'Best rates for {region} hotels').replace('{region}', region)}
  </p>
```

### 문자열 보간 룰
- 동적 텍스트 (`{region}`, `{airport}`)는 `.replace('{token}', value)` 패턴 (이미 i18n에서 쓰는 패턴 — `wizardNightsTrip` 참고)
- Affiliate 링크 라벨 (`carLink.label`, `link.label`)은 `affiliateLinks.ts` config에서 오므로 i18n 대상 외

### 폴백 영어 유지
컴포넌트 모두 `p.<key> || '<English>'` 패턴 — i18n 누락 시에도 영어로 보이도록 (cat 13 안전망).

## 5. 리스크 & 예외 처리

### 리스크 1: 영어 폴백 잔존 → cat 13 재발
**완화**: 4개 언어 i18n에 모두 추가하는지 PR 자가 검토. KO 모드 스샷으로 확인.

### 리스크 2: 줄바꿈 문자(`{'\u2014'}` em-dash) → mojibake
**완화**: `{'\u2014'}` 같은 ASCII escape 패턴 유지. 직접 em-dash 입력 금지.

### 리스크 3: `region` / `airport` 보간 실수
**완화**: `.replace()` 패턴 통일, 테스트 시 region 다른 KO 사용자 페이지 1회 확인.

### 리스크 4: 기존 영어 사용자에 변경 전혀 없어야 함
**완화**: 영어 i18n 키도 컴포넌트의 기존 영어 텍스트와 동일하게 등록. diff 0.

## 6. P2 검증 항목 (별도)
사용자 스샷에 Hotel ad 표시됨 → P2 룰("hotel_address 있으면 skip")이 사용자 케이스에 적용됐는지 확인 필요:
- 사용자가 호텔 주소 미입력 시 → Hotel ad 표시 = 정상
- 호텔 주소 입력했는데 표시 → P2 로직 버그
- 사용자 케이스는 사용자 답변 후 진단

## 7. 실행 순서
1. en.json: 신규 16개 키 추가 (기존 영어 텍스트 그대로)
2. ko.json: 한국어 16개 추가
3. ja.json: 일본어 16개 추가
4. zh.json: 중국어 16개 추가
5. HotelAd.tsx: i18n 적용
6. AirportPickupAd.tsx: i18n 적용
7. CharterBanner.tsx: i18n 적용 (chip 4개 + 버튼 2개 가장 많음)
8. CarRentalAd.tsx: i18n 적용
9. FlightAd.tsx: i18n 적용
10. `npx tsc --noEmit -p tsconfig.app.json` ✓
11. `npx vite build` ✓
12. branch `fix/ads-i18n` 생성 → commit → push → PR → 머지 → Vercel 자동 배포

## 8. 승인 체크박스
- [ ] 사용자 승인 (실행 GO)
- [ ] 16개 키 × 4개 언어 = 64개 신규 string 동시 추가 (cat 13)
- [ ] 영어 사용자 diff 0 보장
- [ ] PR 단위로 머지 (cat 16: main 직접 push 금지)

## 9. 예상 작업량
30~40분 (i18n 64개 + 컴포넌트 5개 + 빌드/PR 사이클)
