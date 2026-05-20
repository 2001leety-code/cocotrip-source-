# Firebase Extension `storage-resize-images` 설정 가이드 (P109, 2026-05-20)

어드민 상품 갤러리 사진 자동 resize. 모바일 LCP 5초 → 1초 개선.

코드 측 통합은 [PR 본문](https://github.com/2001leety-code/cocotrip-source-/pull/?) 에서 완료 — `TourPhoto.variants` + `resolvePhotoUrl(photo, '400'|'800'|'1600')` + `buildPhotoSrcSet(photo)`. Extension 미설치 환경에서도 자동 원본 폴백이라 prod 안전. 이 문서는 **운영자가 한 번 실행하는 인프라 설치 절차**.

## 1. 설치

```bash
cd "홈페이지 클로드ai/홈페이지 사이트 최근"
firebase ext:install firebase/storage-resize-images
```

## 2. 프롬프트 입력값

| 항목 | 값 | 비고 |
|---|---|---|
| Cloud Functions location | `us-central1` | 기본 |
| Sizes | `400x400,800x800,1600x1600` | 3 variants. 코드의 `TourPhoto.variants` 키와 정확 매칭 — 변경 시 srcset 깨짐 |
| Output format | `webp` | 단일 포맷, JPEG 대비 30~40% 작음 |
| Backfill existing images | `no` | 기존 정적 9 투어 사진은 별도 `scripts/backfill-resize-images.mjs` 로 batch 처리 권장 |
| Resized files path | `(빈 값)` | 기본 동작 — 원본 같은 폴더에 `_400x400.webp` 등 suffix |
| Cache control | `public, max-age=31536000` | 1년 |
| Bucket | `planning-with-ai-a0801.appspot.com` | Firebase 콘솔에서 확인 |
| Paths that contain images | `tours/` | 어드민 상품 사진만 처리 |
| Paths that should NOT cause resize | `(빈 값)` | |
| Delete original | `no` | 원본 보존 — 운영자 재편집 + 보안 검토 가능 |

## 3. 배포

```bash
firebase deploy --only extensions
```

배포 후 Firebase 콘솔 > Extensions 탭에서 status `Healthy` 확인.

## 4. 비용

- Cloud Functions Gen2 호출: 사진 1장 = 3 variants = 3 호출
- 1000장 등록 시 약 $0.0012 (사실상 무료)
- 저장 비용: webp 추가 사이즈 합산 약 +35% (원본 1.5MB → variants 합 ~530KB)

## 5. URL 패턴

원본 업로드 시:
```
tours/{tourId}/gallery/{ts}-{name}.webp
```

Extension 비동기 처리 후 (~5초):
```
tours/{tourId}/gallery/{ts}-{name}_400x400.webp
tours/{tourId}/gallery/{ts}-{name}_800x800.webp
tours/{tourId}/gallery/{ts}-{name}_1600x1600.webp
```

## 6. AdminProductEditor 통합 (선택 — variants 자동 채움)

업로드 직후 Extension 의 5초 polling 으로 variants 자동 채워 Firestore tours_drafts 에 저장하는 path 는 별도 PR 권장:

```typescript
// src/lib/storage-upload.ts (후속)
async function uploadWithVariants(file, path): Promise<TourPhoto> {
  const url = await uploadFile(file, path);
  // poll for variants (5s timeout)
  const variants = await pollForVariants(url, [400, 800, 1600]);
  return { url, variants };
}
```

현재 코드 흐름: 업로드 시점에 variants 빈 상태로 doc 저장 → 사용자 페이지 첫 진입 시 `resolvePhotoUrl(photo)` 가 원본 url 폴백. Extension 처리 완료 후 (~5초 뒤) draft 재편집 / 사진 재업로드 시 polling 으로 variants 채워짐.

## 7. 기존 사진 backfill

`tours/`  아래 이미 업로드된 사진은 Extension 이 자동 처리 안 함 (`Backfill existing images=no`). 별도 batch script 작성 필요:

```bash
# (후속 PR)
node scripts/backfill-resize-images.mjs --bucket=tours/
```

내부 동작: Cloud Storage `listFiles({prefix: 'tours/'})` → 각 파일 `setMetadata({})` 호출로 Extension trigger 재발화.

## 8. 회귀 차단

- 코드: `tests/unit/resolve-photo-url.test.ts` (17 케이스). Extension 미설치 환경에서도 자동 폴백 검증.
- lint: `scripts/lint-mistake-patterns.mjs` 의 `P109_resizeImagesVariantsFallback`. `resolvePhotoUrl` 시그니처 회귀 + variants 키 매칭 (`'400'|'800'|'1600'`) 검증.
- 메모리: `feedback_mistake_p109_resize_images_variants_fallback.md`.

## 9. 모니터링

설치 후 첫 주는 Firebase 콘솔 > Functions 탭에서 `storage-resize-images` 실행 로그 확인. 실패 시 (예: 이미지 손상) Extension 자체 dead-letter queue 활용. 운영자가 원본을 재업로드해 회복.

## 10. 롤백 절차

```bash
firebase ext:uninstall storage-resize-images
```

Extension 제거해도 코드는 자동 원본 폴백이라 사용자 페이지 무영향. 이미 만들어진 variants 파일은 Storage 에 남아 (수동 cleanup).

## 관련

- 디자인 메모리: `project_cocotrip_resize_images_extension.md` (호출: "resize-images")
- 코드 메모리: `feedback_mistake_p109_resize_images_variants_fallback.md`
- 어드민 상품 시스템: `project_cocotrip_admin_product_system.md`
