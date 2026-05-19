# Phase 0 — 어드민 상품 등록 시스템 (디자인)

> 작성일: 2026-05-19
> 상태: **검토 대기** — Phase 1 구현 진입 전 사용자 승인 필요
> 작업 디렉토리: `홈페이지 클로드ai/홈페이지 사이트 최근`

---

## A. 배경 & 목표

### A1. 현재 상태

| 항목 | 위치 | 비고 |
|---|---|---|
| 정적 9개 투어 | `src/data/tours.ts` (1028L) | 4-lang i18n, stops, included/excluded, rating — OTA 80% |
| Firestore `tours` 컬렉션 | `Admin.tsx` 4-field form (`title/description/price/totalSeats`) | OTA 10% |
| 사용자 상세 | `src/pages/TourDetailPage.tsx` (713L) | 이미 OTA-스러운 섹션 다수 |
| 취소 정책 | `RefundPolicyModal.tsx` (글로벌 표 hardcoded) | 투어별 X |
| 예약 | `TourBookingDialog.tsx` | 날짜만, 시간슬롯 X, 픽업 09:00 KST 하드코딩 |

**핵심 문제**: 정적 코드 9 투어 + Firestore 4-field 신규 = **둘이 분리**. 운영자가 신규 OTA-quality 상품을 코드 push 없이 등록할 수단이 없음.

### A2. 목표 (Phase 0 ~ Phase 4)

```
Phase 0 (이 문서) — 디자인 확정 (코드 0줄)
Phase 1 — Firestore schema v2 + tours.ts 통합 타입 + Firebase Storage 사진 업로드
Phase 2 — Admin ProductEditorPage 9-탭 form
Phase 3 — TourDetailPage 신규 섹션 (FAQ accordion / 미팅포인트 지도 / 시간슬롯)
Phase 4 — AI 자동 번역 (Gemini, ko→en/ja/zh 1-click)
```

이 문서는 **Phase 0 만** 다룬다. Phase 1+ 는 별도 PR/문서.

### A3. 비-목표 (이 시점 X)

- 외부 OTA marketplace (GYG/Klook) 동시 발행
- Dynamic pricing (시즌/요일별)
- 채널 매니저 (재고 동기화)
- 별도 supplier 계정 (운영자=단일 owner)
- Reviews 모듈 수정 (이미 `ReviewList` 가 존재)

---

## B. OTA 표준 vs 현재 — 갭 분석 표 (33 필드)

기준: GetYourGuide / Klook / Viator 공통 + Tripadvisor Experiences.

| # | 필드 | OTA 표준 | tours.ts (정적) | Firestore (4-field) | 갭 |
|---|---|---|---|---|---|
| 1 | 상품 ID | UUID + supplier_sku | `id` + `slug` | doc id 만 | ✅ |
| 2 | 이름 (4-lang) | 다국어 | `title: I18nString` | `title: string` | ⚠️ Firestore 1-lang |
| 3 | 요약 (4-lang) | 다국어 | `summary` | ❌ | ⚠️ |
| 4 | 상세 설명 (4-lang) | 다국어 + rich-text | `description` (plain text) | `description: string` | ⚠️ rich-text 미지원 |
| 5 | 카테고리 / 태그 | 분류 트리 | `tags: TourTag[]` (8 enum) | ❌ | ⚠️ |
| 6 | 지역 | 도시/구역 | `region: TourRegion` | ❌ | ⚠️ |
| 7 | 썸네일 | 1장 + 사이즈 | `thumbnail: string` (`/public` 경로) | ❌ | 🔴 정적 경로 |
| 8 | 사진 갤러리 | 5~10장 + alt | `images: string[]` | ❌ | 🔴 alt 없음, 정적 |
| 9 | 영상 | YouTube/Vimeo embed | ❌ | ❌ | 🔴 |
| 10 | 가상 투어 | 360° | ❌ | ❌ | 🔴 (선택) |
| 11 | 소요 시간 | days + hours | `durationDays` + `durationHours` | ❌ | ✅ |
| 12 | 야간 여부 | bool | `isNightTour` | ❌ | ✅ |
| 13 | 차량 / 운송 | enum + 좌석 | `vehicleType` + `maxPax` | ❌ | ✅ |
| 14 | 최대 인원 | int | `maxPax` | `totalSeats` | ⚠️ 의미 다름 (좌석=캡 vs 일일 캐퍼) |
| 15 | 최소 인원 | int | ❌ | ❌ | 🔴 |
| 16 | 가격 기준 | per_group / per_person | `priceUnit` + `priceFrom` | `price` (1-tier) | ⚠️ Firestore 단순 |
| 17 | 통화 | enum | `currency: 'USD'` | ❌ | ⚠️ KRW 도 |
| 18 | 가격 계산 (인원/요일) | 동적 | `pricing_spec.json` SSOT (외부) | ❌ | ⚠️ 외부 의존 |
| 19 | 가격 단위 / 표시 | 다국어 | ❌ (코드 하드코딩) | ❌ | 🔴 |
| 20 | 평점 | float + count | `rating` + `reviewCount` + `reviewSource` | ❌ | ✅ (Firestore 누락만) |
| 21 | 외부 평점 링크 | URL | `useTourRating` hook (Google Places) | ❌ | ✅ |
| 22 | 하이라이트 (1-line) | 3~5 bullets | `highlights: TourHighlight[]` | ❌ | ✅ |
| 23 | 포함 사항 | 글로벌 + 투어별 | `GLOBAL_INCLUDED` + `included` | ❌ | ✅ |
| 24 | 불포함 사항 | 글로벌 + 투어별 | `GLOBAL_EXCLUDED` + `excluded` | ❌ | ✅ |
| 25 | 세부 일정 (timed) | 시간순 stop | `stops: TourStop[]` (time/name/photo/desc/tip/transit) | ❌ | ✅ |
| 26 | 운전기사 언어 | 다중 | `driverLanguages: DriverLanguage[]` | ❌ | ✅ |
| 27 | 라이브 가이드 vs 오디오 | enum | ❌ | ❌ | 🔴 |
| 28 | **미팅 포인트** | 주소/좌표/사진/지침 | `defaultPickup: I18nString` (텍스트 1줄만) | ❌ | 🔴 좌표·사진·지침 없음 |
| 29 | 다중 픽업 존 | 지역 array | ❌ | ❌ | 🔴 |
| 30 | **취소 정책** | 투어별 tier 표 | `RefundPolicyModal` (글로벌 hardcoded) | ❌ | 🔴 투어별 X |
| 31 | **시간 슬롯** | 출발 시각 array | TourBookingDialog 가 09:00 하드코딩 | ❌ | 🔴 |
| 32 | 가용성 캘린더 | 일자 ON/OFF | `tour-availability` (별도 컬렉션) | (별개) | ✅ |
| 33 | **FAQ** | Q&A array (4-lang) | ❌ | ❌ | 🔴 |
| 34 | 적합성 / 제약 | age/fitness/wheelchair/stroller/pregnancy | ❌ | ❌ | 🔴 |
| 35 | 준비물 (4-lang) | bring/wear/eat | ❌ | ❌ | 🔴 |
| 36 | 중요 정보 (4-lang) | 안전/날씨/지참물 | ❌ | ❌ | 🔴 |
| 37 | 즉시 확정 vs 요청 | enum | (TourBookingDialog 가 PayPal 즉결) | ❌ | ⚠️ |
| 38 | 바우처 종류 | mobile / printed | (자동 PDF 발급) | ❌ | ✅ |
| 39 | 공급자 정보 | 사업자/면허 | (CLAUDE.md / footer hardcoded) | ❌ | ✅ (글로벌) |
| 40 | 보험 / 안전 표기 | 표시 | ❌ | ❌ | 🔴 |

### B1. 🔴 = 필수 신규 (9개)

1. 사진 갤러리 — Firebase Storage 마이그 + alt
2. 영상 (선택)
3. 최소 인원
4. 가격 표시 메시지 (다국어)
5. 라이브 가이드 vs 오디오
6. **미팅 포인트** (좌표/사진/지침)
7. 다중 픽업 존
8. **투어별 취소 정책** (tier 표 override)
9. **시간 슬롯** (출발 시각 array)
10. **FAQ**
11. 적합성/제약
12. 준비물
13. 중요 정보
14. 보험/안전

### B2. ⚠️ = 부분 개선 (5개)

- Firestore 의 `title/description` 을 `I18nString` 으로 격상
- `price` 단일 값을 pricing 객체로
- `maxPax` vs `totalSeats` 의미 명확화
- 사진 경로 `/public` → Firebase Storage URL
- rich-text 지원 여부 (간단 markdown 정도)

### B3. ✅ = 이미 충분 (16개)

이름·요약·일정·하이라이트·포함/불포함·평점·차량 — tours.ts 의 구조를 그대로 Firestore 로 옮기면 됨.

---

## C. Firestore Schema v2

### C1. 컬렉션 구조

```
tours/{tourId}                       (메인 도큐먼트, ~20-40 KB)
  ├─ availability/{YYYY-MM-DD}       (서브컬렉션 — 기존 tour-availability-store 와 연결)
  ├─ slots/{slotId}                  (서브컬렉션 — 시간슬롯, 신규)
  ├─ faqs/{faqId}                    (서브컬렉션 — 4-lang FAQ, 신규)
  ├─ bookings/{bookingId}            (legacy, 유지)
  └─ reviews — Firestore root `reviews` 컬렉션 (기존, targetType='tour' + targetId=tourId)

tours_drafts/{tourId}                (어드민 작성 중 임시 저장 — Firestore Auth admin only)
```

서브컬렉션 분리 사유:
- `availability` — 1년치=365 doc, 메인 doc 비대화 방지
- `slots` — 투어당 1~10개 시간슬롯, 가격이 다를 수 있음
- `faqs` — 5~20 Q&A, 추가/삭제 빈번

### C2. 메인 도큐먼트 schema (TypeScript)

`src/data/tours.ts` 의 `Tour` 타입을 다음으로 격상. 기존 정적 9개와 호환 위해 모든 신규 필드는 **optional**.

```typescript
// ─── 기존 유지 ──────────────────────────────────────────
export type VehicleType = 'Staria' | 'Sprinter' | 'SprinterMid' | 'Bus';
export type TourTag = ... (기존)
export type TourRegion = ... (기존)
export type I18nString = { ko: string; en: string; ja: string; zh: string };
export type TourHighlight = { icon: string; text: I18nString };
export type DriverLanguage = 'en' | 'ja' | 'zh';
export type TourTransit = ... (기존)

// ─── 격상: TourStop ───────────────────────────────────────
export type TourStop = {
  time: string;
  name: I18nString;
  stay_min: number;
  photo?: TourPhoto;           // ← 변경: string → TourPhoto
  description: I18nString;
  entry_fee_krw?: number;
  tip?: I18nString;
  naver_map_url?: string;
  transit_from_prev?: TourTransit;
};

// ─── 신규: 사진 객체 (Firebase Storage 마이그) ──────────────
export type TourPhoto = {
  url: string;                  // Firebase Storage HTTPS URL (resized variants 권장)
  alt: I18nString;              // SEO + a11y
  width?: number;
  height?: number;
  blurhash?: string;            // 로딩 placeholder (선택)
  /** 정적 마이그용 — 기존 /public 경로면 그대로 src 로 사용 */
  legacy_public_path?: string;
};

// ─── 신규: 미팅 포인트 ────────────────────────────────────
export type MeetingPoint = {
  /** 'hotel_lobby_pickup' / 'fixed_address' / 'multiple_zones' */
  kind: 'hotel_pickup' | 'fixed_address' | 'multi_zone';
  /** kind='fixed_address' / 'hotel_pickup' 일 때 */
  address?: I18nString;
  lat?: number;
  lng?: number;
  photo?: TourPhoto;
  /** "호텔 로비에서 만남, 기사가 한국어 사인 들고 있음" */
  instructions?: I18nString;
  naver_map_url?: string;
  google_maps_url?: string;
  /** kind='multi_zone' 일 때 가능 픽업 구역 */
  zones?: PickupZone[];
};

export type PickupZone = {
  id: string;
  name: I18nString;
  /** 서울 강남, 명동 등 */
  area_label: I18nString;
  surcharge_krw?: number;
  /** 픽업 시각 (HH:mm KST) */
  pickup_time?: string;
};

// ─── 신규: 시간 슬롯 ────────────────────────────────────
export type TourSlot = {
  id: string;
  /** "09:00" 24시간 KST */
  start_time: string;
  /** 슬롯별 가격 변경 (선택) */
  price_modifier_krw?: number;
  /** 슬롯별 정원 (없으면 tour.maxPax) */
  capacity?: number;
  /** 라벨 (예: "아침 출발", "오후 1시 출발") */
  label?: I18nString;
  is_active: boolean;
};

// ─── 신규: 투어별 취소 정책 ───────────────────────────────
export type CancellationPolicy = {
  /** 'inherit_global' 이면 RefundPolicyModal 의 글로벌 표 사용 */
  kind: 'inherit_global' | 'custom';
  /** kind='custom' 일 때 tier 표 직접 정의 */
  tiers?: CancellationTier[];
  /** 추가 안내문 (4-lang) — global notes 위에 추가됨 */
  extra_notes?: I18nString[];
};

export type CancellationTier = {
  /** 출발 N시간 전까지 */
  hours_before: number;
  /** Bronze/Silver | Gold | Platinum 환불율 (% 0~100) */
  refund_percent: { general: number; gold: number; platinum: number };
};

// ─── 신규: FAQ ──────────────────────────────────────────
export type FAQ = {
  id: string;
  question: I18nString;
  answer: I18nString;
  /** 정렬 순서 (낮은 숫자가 위) */
  order: number;
};

// ─── 신규: 적합성/제약 ────────────────────────────────────
export type Suitability = {
  /** 최소 연령 (없으면 제한 없음) */
  min_age?: number;
  /** 최대 연령 */
  max_age?: number;
  /** 체력 요구도 */
  fitness_level?: 'easy' | 'moderate' | 'challenging';
  wheelchair_accessible?: boolean;
  stroller_friendly?: boolean;
  pregnancy_safe?: boolean;
  infant_seat_available?: boolean;
  /** 자유 텍스트 보충 안내 */
  notes?: I18nString;
};

// ─── 신규: 준비물 / 중요 정보 / 가이드 종류 ─────────────────
export type GuideType = 'live_guide' | 'driver_only' | 'audio' | 'self_guided';

// ─── 격상된 메인 Tour 타입 ─────────────────────────────────
export type Tour = {
  // 기존 (그대로 유지) ────────────────────────────
  id: string;
  slug: string;
  region: TourRegion;
  title: I18nString;
  summary: I18nString;
  description: I18nString;
  priceFrom: number;
  priceUnit?: 'group' | 'per_person';
  currency: 'USD';
  durationDays: number;
  durationHours?: number;
  isNightTour?: boolean;
  vehicleType: VehicleType;
  maxPax: number;
  thumbnail: string;              // legacy 또는 TourPhoto.url
  images: string[];               // legacy 또는 photos[].url
  tags: TourTag[];
  highlights: TourHighlight[];
  driverLanguages?: DriverLanguage[];
  stops?: TourStop[];
  defaultPickup?: I18nString;     // legacy — meetingPoint 로 마이그
  rating?: number;
  reviewCount?: number;
  reviewSource?: 'internal' | 'google';
  included?: TourHighlight[];
  excluded?: TourHighlight[];

  // ── 신규 (Phase 1 에서 점진 추가) ──────────────
  /** Firestore 도큐먼트 여부 (true=Firestore, undefined/false=정적 tours.ts) */
  source?: 'static' | 'firestore';
  /** 운영자가 publish 한 시점 */
  publishedAt?: number;           // ms epoch
  /** draft / published / archived */
  status?: 'draft' | 'published' | 'archived';
  /** version (낙관적 lock 용) */
  version?: number;

  // 미디어 (격상) ────────────────────────────
  photos?: TourPhoto[];           // images[] 의 v2. images 우선, 없으면 photos.
  thumbnail_photo?: TourPhoto;    // thumbnail 의 v2
  video_embed_url?: string;       // YouTube / Vimeo
  /** 1인당 최소 인원 (즉시확정 컷오프) */
  minPax?: number;

  // 가이드 / 미팅 / 픽업 ────────────────────
  guide_type?: GuideType;
  meeting_point?: MeetingPoint;

  // 가격 표시 (다국어) ───────────────────────
  /** "성인 1인 기준 가격" 같은 다국어 보조 텍스트 */
  price_display_note?: I18nString;

  // 시간 슬롯 (가용한 출발 시각들) ────────────
  /** 비어있으면 Booking dialog 가 09:00 KST 기본 사용 (현재 동작 유지) */
  slot_count?: number;            // 서브컬렉션 카운트 캐시

  // 취소 정책 (투어별 override) ────────────────
  cancellation_policy?: CancellationPolicy;

  // 적합성 / 준비물 / 중요 정보 ───────────────
  suitability?: Suitability;
  what_to_bring?: I18nString;     // multiline rich text
  important_info?: I18nString;    // multiline rich text

  // FAQ 카운트 캐시 ────────────────────────
  faq_count?: number;

  // 메타데이터 ────────────────────────────
  createdAt?: number;             // ms epoch
  updatedAt?: number;
  createdBy?: string;             // admin uid
  updatedBy?: string;
  /** PR #487 같은 보호 플래그 (cleanup cron 차단) */
  do_not_delete?: boolean;
};
```

### C3. Firestore Security Rules 변경점

```javascript
match /tours/{tourId} {
  // 읽기: published 만 공개, draft/archived 는 admin
  allow read: if resource.data.status == 'published'
              || request.auth.token.email in ADMIN_EMAILS;
  // 쓰기: admin only
  allow write: if request.auth.token.email in ADMIN_EMAILS;

  match /availability/{date} { ... 기존 유지 ... }
  match /slots/{slotId} {
    allow read: if true;
    allow write: if request.auth.token.email in ADMIN_EMAILS;
  }
  match /faqs/{faqId} {
    allow read: if true;
    allow write: if request.auth.token.email in ADMIN_EMAILS;
  }
}

match /tours_drafts/{tourId} {
  allow read, write: if request.auth.token.email in ADMIN_EMAILS;
}
```

`ADMIN_EMAILS` 는 기존 `firestore.rules` 의 admin 패턴 그대로. CLAUDE.md/architecture_index 의 "하드코드 admin email 3곳 동기화" 규칙 적용.

### C4. Firestore Indexes 추가

`firestore.indexes.json` 에 다음 composite index 추가:

```json
{
  "collectionGroup": "tours",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "region", "order": "ASCENDING" },
    { "fieldPath": "publishedAt", "order": "DESCENDING" }
  ]
}
```

(투어 목록 페이지 `/tours` 가 region+publishedAt 으로 정렬)

### C5. Firebase Storage 구조

```
gs://planning-with-ai-a0801.appspot.com/
  tours/
    {tourId}/
      thumbnail.webp                  # 1200x630 (OG + 목록)
      gallery/
        001.webp                       # 원본
        001-800w.webp                  # 800w resized (auto)
        001-1600w.webp                 # 1600w resized
        ...
      stops/
        {stopIndex}.webp
      meeting/
        meeting.webp
```

**규칙**:
- 업로드는 `admin/upload-tour-photo.ts` (신규) 가 admin custom claim 검증 후 signed URL 발급
- public read, admin write
- `firebase.storage().rules` 신규 추가 필요
- resize: Cloud Function `resize-images` (extension) 또는 frontend `<img srcset>` + Firebase URL params

---

## D. Admin Form 와이어프레임 (9 탭)

### D1. 페이지: `/admin/products` (목록) → `/admin/products/new` 또는 `/admin/products/:id`

목록 페이지는 기존 `Admin.tsx` 의 4-field form 을 **신규 ProductEditorPage 진입 링크로 교체**. 4-field form 삭제는 Phase 2 에서 (legacy 잔존 Firestore doc 마이그 후).

### D2. ProductEditorPage 구조

좌측 sidebar (9 탭) + 우측 컨텐츠. 모든 탭 입력은 **`tours_drafts/{tourId}` 에 1초 throttle autosave**, "Publish" 버튼이 `tours/{tourId}` 로 commit.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ← 목록      서울 시티투어 (draft v3)        [👁 미리보기] [📤 발행]          │
├──────────┬──────────────────────────────────────────────────────────────┤
│ ① 기본정보 │  ┌─ 한국어 ─┐ ┌─ English ─┐ ┌─ 日本語 ─┐ ┌─ 中文 ─┐         │
│ ② 미디어   │  │ 제목       │ │ Title     │ │ タイトル   │ │ 标题   │         │
│ ③ 일정     │  │ [────────] │ │ [───────] │ │ [───────] │ │ [────] │         │
│ ④ 미팅포인트│  │ 요약       │ │ Summary   │ │ 概要       │ │ 摘要   │         │
│ ⑤ 가격예약 │  │ [────────] │ │ [───────] │ │ [───────] │ │ [────] │         │
│ ⑥ 포함미포함│  │ 상세설명    │ │ Descript. │ │ 詳細       │ │ 详细   │         │
│ ⑦ 취소정책 │  │ [────────] │ │ [───────] │ │ [───────] │ │ [────] │         │
│ ⑧ FAQ      │  └────────────┘ └───────────┘ └───────────┘ └────────┘         │
│ ⑨ 메타·QA  │                                                                │
│            │  Slug:        seoul-city-full-day                              │
│            │  카테고리:    [☑ Popular] [☐ AI-Curated] [☐ Best Value] ...    │
│            │  지역:        [Seoul ▾]                                        │
│            │  소요시간:    [1] 일 + [9] 시간    ☐ 야간 투어                    │
│            │  차량:        [Staria ▾]    최대 인원: [7]    최소 인원: [2]    │
│            │  기사 언어:   [☑ EN] [☐ JA] [☐ ZH]                              │
│            │  가이드 종류: [☑ Driver only] [☐ Live guide] [☐ Audio]          │
│            │                                                                │
│            │  ────────────────────────────────────                          │
│            │  💾 자동저장됨 · 12초 전                                          │
└────────────┴──────────────────────────────────────────────────────────────┘
```

### D3. 탭 ② 미디어

```
┌─ 썸네일 (1200x630 권장, 1장 필수) ───────────┐
│  [현재 사진 미리보기 320x180]                    │
│  [📁 업로드]  [🗑 삭제]                          │
│  Alt 텍스트 (4-lang):                          │
│    ko [경복궁 정문 아침 풍경                   ]   │
│    en [Gyeongbokgung main gate in morning  ]   │
│    ja [景福宮の正門 朝の風景                 ]   │
│    zh [景福宫正门清晨                        ]   │
└──────────────────────────────────────────────┘

┌─ 갤러리 (최대 10장, 추천 5~7장) ────────────────┐
│  [드래그 정렬 가능한 grid]                      │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐       │
│  │ 1   │ │ 2   │ │ 3   │ │ 4   │ │  +  │       │
│  │ 🗑✏ │ │ 🗑✏ │ │ 🗑✏ │ │ 🗑✏ │ │ 업로드│       │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘       │
│                                                │
│  ✏ 클릭 시 alt 4-lang 편집 모달 오픈            │
└──────────────────────────────────────────────┘

┌─ 영상 (선택) ────────────────────────────────┐
│  YouTube 또는 Vimeo embed URL                  │
│  [https://www.youtube.com/embed/...        ]   │
└──────────────────────────────────────────────┘
```

### D4. 탭 ③ 일정 (Stops)

```
┌─ Day 1 ─────────────────────────────────────────────┐
│  [+ Stop 추가] [↕ 드래그 정렬]                       │
│                                                      │
│  ┌─ Stop 1 ────────────────────────────────────┐    │
│  │  시각: [09:00]   체류: [60]분  입장료: [3,000] KRW│
│  │  이름 (4-lang):                              │    │
│  │    ko [경복궁                          ]      │    │
│  │    en [Gyeongbokgung                  ]      │    │
│  │    ja/zh 동일                                │    │
│  │  설명 / 팁 (4-lang each, expand)              │    │
│  │  사진: [업로드]    네이버 지도 URL: [────]     │    │
│  │  이전 stop 에서 이동:                           │    │
│  │    수단: [도보 ▾]  시간: [10]분  거리: [0.5]km│    │
│  │  [🗑 삭제]                                    │    │
│  └──────────────────────────────────────────────┘    │
│  ┌─ Stop 2 ────────────────────────────────────┐    │
│  │  ...                                          │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

durationDays > 1 이면 Day 2, Day 3, ... 탭 분기.

### D5. 탭 ④ 미팅 포인트

```
유형: ○ 호텔 픽업 (입력자 호텔 주소)
      ● 고정 주소 (지도에서 선택)
      ○ 다중 픽업 존 (강남/명동/홍대 등 옵션)

┌─ 고정 주소 ──────────────────────────────────┐
│  주소 (4-lang):                              │
│    ko [서울 종로구 사직로 161             ]    │
│    en [161 Sajik-ro, Jongno-gu, Seoul    ]    │
│  좌표:    위도 [37.5796]  경도 [126.9770]      │
│  지도:    [네이버 지도에서 선택 ↗]              │
│                                              │
│  안내 사진: [업로드]  (기사가 들고 있는 사인 등)│
│  알트 (4-lang):                              │
│    ko [경복궁 흥례문 앞 만남              ]    │
│                                              │
│  미팅 안내 (4-lang):                         │
│    ko [경복궁 흥례문 앞에서 만나뵙겠습니다. │    │
│        기사님이 "CocoTrip" 사인을 들고 있어요]  │
└──────────────────────────────────────────────┘

(다중 픽업 존 선택 시 zones[] 추가 row 형태로 반복)
```

### D6. 탭 ⑤ 가격 · 예약

```
가격 단위: ○ per_group (전세 차량 1대)
           ● per_person (1인당)

기본 가격 (USD):   [208]    표시 메시지:
환산 KRW (자동):   ₩297,440   ko [성인 1인 기준 가격          ]
                              en [Price per adult           ]
통화:             USD ▾

────────────────────────────────────
시간 슬롯 (출발 시각, 비어있으면 09:00 기본):

┌──────────────────────────────────────────────┐
│  [+ 슬롯 추가]                                │
│  ┌──────────────────────────────────────────┐│
│  │ 09:00  라벨[아침 출발]  정원[7]  가격수정[₩0] │
│  │ ☑ 활성  [🗑]                                ││
│  └──────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────┐│
│  │ 14:00  라벨[오후 출발]  정원[7]  가격수정[₩+20,000]│
│  │ ☐ 활성 (비활성)  [🗑]                       ││
│  └──────────────────────────────────────────┘│
└──────────────────────────────────────────────┘

가용성 캘린더 관리: → /admin/availability 로 이동 링크 (별개 페이지)
```

### D7. 탭 ⑥ 포함 / 미포함

```
☑ 글로벌 기본값 사용 (GLOBAL_INCLUDED 4 항목, GLOBAL_EXCLUDED 3 항목 자동 적용)

추가 포함 사항 (이 투어만):
  [+ 추가]
  ┌────────────────────────────────────────┐
  │ 아이콘: [🎫 Ticket ▾]                    │
  │ 텍스트 (4-lang):                         │
  │   ko [한복 무료 대여                ]    │
  │   en [Free hanbok rental           ]    │
  │   ...                                    │
  │ [🗑]                                     │
  └────────────────────────────────────────┘

추가 미포함 사항 (이 투어만):
  [+ 추가]
  (동일 구조)
```

### D8. 탭 ⑦ 취소 정책

```
유형: ● 글로벌 정책 사용 (RefundPolicyModal 의 5-tier × 3-Loyalty 표)
      ○ 투어별 커스텀

(커스텀 선택 시)

┌─ Tier 표 ──────────────────────────────────────────────────┐
│  잔여시간     │ Bronze/Silver │ Gold       │ Platinum     │
│  ─────────────┼────────────────┼─────────────┼──────────────│
│  [72] h 이상  │ [100] %        │ [100] %     │ [100] %     │
│  [48-72] h    │ [80]  %        │ [100] %     │ [100] %     │
│  [24-48] h    │ [50]  %        │ [80]  %     │ [100] %     │
│  [12-24] h    │ [0]   %        │ [50]  %     │ [80]  %     │
│  [<12] h      │ [0]   %        │ [0]   %     │ [0]   %     │
│                                                            │
│  [+ Tier 추가]  [- 마지막 Tier 삭제]                          │
└────────────────────────────────────────────────────────────┘

추가 안내 (4-lang, 글로벌 NOTES 위에 표시):
  ko [날씨로 인한 취소 시 100% 환불됩니다       ]
  en [Full refund for weather-related cancel  ]
```

### D9. 탭 ⑧ FAQ

```
[+ Q&A 추가]  [↕ 드래그 정렬]

┌─ Q&A 1 ─────────────────────────────────────────────────┐
│  질문 (4-lang):                                          │
│    ko [어린이도 참여 가능한가요?                          ]│
│    en [Are children allowed?                            ]│
│    ja/zh ...                                            │
│  답변 (4-lang, multiline):                              │
│    ko [네, 만 5세 이상 동반 가능합니다. 카시트는 사전 요청 │
│        시 무료 대여 가능해요.]                            │
│    en [Yes, children aged 5+ are welcome. Free car ...] │
│  [🗑]                                                    │
└─────────────────────────────────────────────────────────┘

┌─ Q&A 2 ─────────────────────────────────────────────────┐
│  ...                                                     │
└─────────────────────────────────────────────────────────┘
```

### D10. 탭 ⑨ 메타 · QA

```
적합성 / 제약:
  최소 연령:     [5]    최대 연령:    [없음 ▾]
  체력 요구:    [Easy ▾]
  ☑ 휠체어 접근 가능   ☐ 유모차 친화   ☐ 임산부 안전
  ☐ 카시트 사용 가능
  추가 안내 (4-lang):
    ko [이동량이 많지 않아 어르신 동반에도 적합합니다]

준비물 (4-lang, multiline):
  ko [편한 신발, 양산 또는 우산 (날씨에 따라), 작은 가방]

중요 정보 (4-lang, multiline):
  ko [- 출발 30분 전 미팅 포인트 도착 권장
       - 비/눈 날씨에도 정상 운영 (실내 위주 코스)
       - 입장료는 별도]

────────────────────────────────────
운영 상태:  ● Draft   ○ Published   ○ Archived
SEO 슬러그: [seoul-city-full-day  ]  (소문자, 하이픈만)
검색 노출:  ☑ 노출   ☐ 숨김

────────────────────────────────────
[👁 미리보기]  ← 새 탭에서 /tours/{slug}?preview=draft 로 열림
[📤 발행 (Publish)]
```

### D11. AI 자동 번역 트리거 (Phase 4 hook)

각 I18n 필드 옆에 [🤖 AI 번역 (ko→en/ja/zh)] 버튼. Phase 0 에서는 wireframe 만, Phase 4 에서 구현. 호출 시 `/api/admin-translate` 가 Gemini API + admin auth.

---

## E. 사용자 TourDetailPage — 신규 섹션 mockup

기존 페이지 구조 (이미 풍부) 에 다음 섹션을 **삽입**.

### E1. 현재 섹션 흐름

```
1. 헤더 (브레드크럼)
2. ImageGallery (이미 있음, 5~10장 슬라이더)
3. 제목 + 요약
4. 메타 칩 (소요시간 / 차량 / 평점 / 기사언어)
5. 포함 사항 (highlights)
6. 상품 설명
7. IncludedExcluded
8. 세부 일정 (TourStopList — stops 가 있을 때만)
9. 추천 숙소 (Trip.com affiliate)
10. Reviews
11. 하단 고정 CTA 바 (가격 + 예약 버튼)
```

### E2. 신규 섹션 (점선) 삽입 위치

```
1. 헤더
2. ImageGallery
3. 제목 + 요약
4. 메타 칩
   ⤷ [신규: 가이드 종류 칩 (Driver only/Live guide/Audio)]
   ⤷ [신규: 즉시 확정 칩 (instant confirm)]
5. 포함 사항 (highlights)
6. 상품 설명
                                          ┌─ 신규 ─────────┐
7. ┄┄┄ 영상 ┄┄┄ (video_embed_url 있을 때) │  YouTube embed │
                                          └────────────────┘
8. IncludedExcluded
9. 세부 일정
                                          ┌─ 신규 ─────────────────────┐
10. ┄┄┄ 미팅 포인트 ┄┄┄                    │  주소 + 좌표 + 안내 사진 +    │
                                          │  네이버지도/구글지도 버튼      │
                                          │  4-lang 안내                  │
                                          └─────────────────────────────┘
                                          ┌─ 신규 ─────────────────────┐
11. ┄┄┄ 시간 슬롯 picker ┄┄┄              │  09:00 [선택]                │
   (slots 1개 이상일 때만 노출,             │  14:00 [선택]  +₩20,000      │
    날짜 picker 와 함께 표시)              └─────────────────────────────┘
                                          ┌─ 신규 ─────────────────────┐
12. ┄┄┄ 적합성 / 준비물 / 중요 정보 ┄┄┄    │  Accordion 3개 섹션          │
                                          │  - 적합성 (휠체어/연령 등 칩)  │
                                          │  - 준비물                    │
                                          │  - 중요 정보                  │
                                          └─────────────────────────────┘
                                          ┌─ 신규 ─────────────────────┐
13. ┄┄┄ FAQ ┄┄┄                          │  Q1 (클릭) ▾                 │
                                          │  Q2 (클릭) ▾                 │
                                          └─────────────────────────────┘
14. 추천 숙소 (Trip.com)
15. Reviews
                                          ┌─ 변경 ─────────────────────┐
16. 하단 CTA 바                            │  취소·환불 정책 링크 클릭 시,│
                                          │  투어 cancellation_policy   │
                                          │  있으면 그 표, 없으면 글로벌  │
                                          └─────────────────────────────┘
```

### E3. 미팅 포인트 컴포넌트 디자인

```
┌─────────────────────────────────────────────────────────────┐
│  📍  MEETING POINT  /  미팅 포인트                              │
│                                                               │
│  ┌──────────────────────────────┐ ┌─────────────────────┐    │
│  │ [안내 사진 - 480x320]          │ │ 경복궁 흥례문        │    │
│  │ "기사가 사인 들고 있는 위치"   │ │                       │    │
│  │                                │ │ 서울 종로구 사직로     │    │
│  │                                │ │ 161                   │    │
│  │                                │ │                       │    │
│  │                                │ │ [🗺 네이버 지도]       │    │
│  │                                │ │ [🌍 Google Maps]       │    │
│  └──────────────────────────────┘ └─────────────────────┘    │
│                                                               │
│  ℹ️ 경복궁 흥례문 앞에서 만나뵙겠습니다. 기사님이 "CocoTrip"     │
│     사인을 들고 있어요. 출발 10분 전 도착을 권장드립니다.        │
└─────────────────────────────────────────────────────────────┘
```

신규 컴포넌트: `src/components/tours/MeetingPointCard.tsx`

### E4. FAQ Accordion 컴포넌트 디자인

```
┌─────────────────────────────────────────────────────────────┐
│  ❓  FREQUENTLY ASKED QUESTIONS / 자주 묻는 질문                │
│                                                               │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  어린이도 참여 가능한가요?                       ▾     │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  비/눈이 와도 진행하나요?                       ▾     │   │
│  └───────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────┐   │
│  │  카시트가 필요한데 사전 요청 가능한가요?         ▾     │   │
│  │  ─────────────────────────────────────────────────    │   │
│  │  네, 예약 시 메모 또는 결제 후 WhatsApp 으로 ID 보내   │   │
│  │  주세요. 사전 요청 시 무료로 대여해 드립니다.            │   │
│  └───────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

신규 컴포넌트: `src/components/tours/TourFAQ.tsx` (shadcn `Accordion` 재사용)

### E5. 시간 슬롯 Picker (TourBookingDialog 내)

기존 다이얼로그 step 1 의 "날짜" picker 옆에 **시간** 드롭다운 추가:

```
┌─ Step 1 — 인원/날짜/시간/언어 ─────────────────────────────┐
│  인원: [- 2 +]    날짜: [📅 2026-05-25]                   │
│  ─────────────────────────────────                       │
│  시간 (신규):                                              │
│    ○ 09:00  아침 출발 (기본 가격)                          │
│    ● 14:00  오후 출발 (+₩20,000)                          │
│    (해당 일자/슬롯의 capacity 잔여석 표시)                  │
│  ─────────────────────────────────                       │
│  기사 언어: [EN ▾]    Addon: ...                          │
└──────────────────────────────────────────────────────────┘
```

`slots` 가 비어있는 투어는 시간 picker 미노출 (현재 동작 유지).

### E6. 적합성 칩 (메타 칩 행에 추가)

```
[♿ 휠체어 가능] [👶 만 5세 이상] [💪 Easy 체력]
```

`suitability.wheelchair_accessible` / `min_age` / `fitness_level` 에서 자동 렌더.

---

## F. 마이그레이션 전략

### F1. 정적 9 투어 → Firestore

**옵션 A — Big Bang (1회 마이그)**: 비추. 데이터 손실 위험.

**옵션 B — Dual Source + Lazy Override (권장)**:

1. `src/data/tours.ts` 의 정적 `TOURS_RAW` 그대로 유지
2. 신규 `getTourBySlug()` 가 다음 순서로 lookup:
   - a. Firestore `tours` 컬렉션에서 slug 매칭 (status='published')
   - b. 없으면 정적 `TOURS_RAW` 폴백
3. 운영자가 어드민에서 신규 투어 등록 → Firestore 만 저장
4. 운영자가 기존 9개 중 하나를 수정하려면, "이 정적 투어 복제 → Firestore 로 가져오기" 버튼 → 자동 import → 어드민이 수정 후 publish → Firestore 가 우선
5. 모든 9개가 Firestore 로 이전된 후 (수 주~수 개월), 정적 TOURS_RAW 폴백 제거 (Phase 3 후반)

### F2. Public Image 경로 → Firebase Storage

정적 투어의 `thumbnail: '/JnR5Ie_경복궁(1).webp'` 같은 경로는 마이그 도중에도 그대로 동작해야 함. `TourPhoto.legacy_public_path` 필드로 호환:

```typescript
function resolvePhotoUrl(photo: TourPhoto | string): string {
  if (typeof photo === 'string') return photo;                  // legacy
  if (photo.url.startsWith('http')) return photo.url;           // Firebase Storage
  return photo.legacy_public_path ?? photo.url;
}
```

### F3. 가격 SSOT 처리

기존 `pricing_spec.json` SSOT 는 **유지**. Firestore 의 `priceFrom` 은 fallback, `getTourPriceKRW()` 가 spec 매핑 우선 그대로:

```typescript
// 호환: tours.ts:29-40 의 getTourPriceKRW 그대로
// Firestore 투어는 TOUR_TO_CHARTER_KEY 매핑이 없을 가능성 → fallback
// 따라서 Firestore 투어는 어드민 form 에서 KRW 직접 입력 또는 USD × policy_rate
```

운영자가 신규 투어 등록 시 가격 입력 UX:
- USD 입력 → KRW 자동 환산 (KRW_PER_USD=1430)
- 또는 KRW 직접 입력 → USD 자동 계산
- "pricing_spec.json 매핑 사용" 체크박스 (체크 시 spec 우선)

### F4. 데이터 손실 방지

- 모든 어드민 변경은 **`tours_drafts/{tourId}` 1초 throttle autosave**
- "Publish" 가 `tours/{tourId}` 로 atomic write
- `tours` 도큐먼트의 `version` 필드 (낙관적 lock) — 두 어드민 동시 편집 시 충돌 감지
- `do_not_delete: true` 플래그 (architecture index 의 PDF golden fixture 패턴과 동일)

---

## G. Phase 1 작업 목록 (디자인 승인 후 진행)

순서대로:

1. **`src/data/tours.ts` 타입 확장** — `TourPhoto / MeetingPoint / TourSlot / CancellationPolicy / FAQ / Suitability` 추가. 기존 9개 데이터 영향 X (모두 optional).
2. **Firestore Security Rules + Indexes** — `tours_drafts/{tourId}` 신규, `tours/{tourId}/slots`, `tours/{tourId}/faqs` 추가.
3. **Firebase Storage rules** — `tours/{tourId}/**` admin write, public read.
4. **`src/lib/tours-firestore.ts`** (신규) — Firestore CRUD 헬퍼.
5. **`src/hooks/useTour.ts`** (신규) — Firestore 우선 + 정적 폴백 lookup.
6. **사진 업로드 UI** — `src/components/admin/PhotoUploader.tsx` (드래그/드롭, Firebase Storage 업로드, blurhash 생성).
7. **TourPhoto 마이그 헬퍼** — `resolvePhotoUrl()` 함수 + `TourDetailPage / TourCard / ImageGallery` 에 적용.

Phase 1 의 한계점:
- ProductEditorPage 자체는 Phase 2 — Phase 1 은 schema + storage 기반만
- 시간슬롯 + FAQ + 미팅포인트 사용자 표시는 Phase 3
- AI 번역은 Phase 4

---

## H. 미해결 결정 사항 (검토 시 답변 부탁)

| # | 결정 | 권장 | 메모 |
|---|---|---|---|
| H1 | **다중 픽업 존** 도입 시점 | Phase 3 (출시 후 운영자 요청 시) | 복잡도 ↑ |
| H2 | 사진 resize 방식 | Firebase Extension `resize-images` | Cloud Functions Gen2, $0.40/M 호출 |
| H3 | rich-text 에디터 | 일단 plain text + 줄바꿈만 | 차후 `@tiptap/react` 검토 |
| H4 | draft autosave 빈도 | 1초 throttle + tab 닫힘 시 flush | wizardPersistence 와 동일 패턴 |
| H5 | 정적 9 투어 마이그 시점 | 각 투어 수정 발생 시 lazy import | Big Bang 금지 |
| H6 | 어드민 미리보기 URL | `/tours/{slug}?preview=draft&token=...` | preview token = uid hash |
| H7 | 영상 자동재생 | OFF (사용자 클릭 시만) | 모바일 데이터 절약 |
| H8 | FAQ 분량 cap | 20개 (운영 가이드) | UI 한계 X, 운영 가이드만 |
| H9 | i18n 빈 필드 fallback | `field.en ?? field.ko` (기존 패턴) | 신규 i18n key 추가 시 동일 |
| H10 | 슬롯별 가격 modifier | KRW 가산 (음수 가능) | USD 환산 자동 |

---

## I. 배포 후 운영자 체크리스트 (Phase 1 머지 시)

- [ ] Firebase Storage rules deploy: `firebase deploy --only storage`
- [ ] Firestore indexes deploy: `firebase deploy --only firestore:indexes`
- [ ] Firestore rules deploy: `firebase deploy --only firestore:rules`
- [ ] Vercel env 추가: `VITE_FIREBASE_STORAGE_BUCKET=planning-with-ai-a0801.appspot.com` (이미 있을 수도)
- [ ] `npm i firebase` (이미 있음) — 추가 SDK 불필요
- [ ] `dist/` 빌드 크기 영향 확인 (Storage SDK 추가로 ~30 KB gzip 예상)

---

## J. 메모리 갱신 (Phase 0 승인 후)

- `project_cocotrip_post_launch_queue.md` 에 "Phase 0~4 어드민 상품 등록 시스템" 트랙 추가
- `feedback_cocotrip_rules.md` 에 신규 schema 폴백 규칙 (`Firestore 우선 + 정적 폴백`) 추가
- `project_cocotrip_architecture_index.md` 의 Firestore 컬렉션 표 갱신 (`tours_drafts` / `tours/{id}/slots` / `tours/{id}/faqs` 추가)

---

## 끝 — Phase 0 디자인 완료

이 문서 검토 후 진행 결정:
- **승인** → Phase 1 (코드 작업) 시작
- **수정 요청** → 특정 섹션 다시 작성
- **보류** → 메모리 보관, 향후 재개
