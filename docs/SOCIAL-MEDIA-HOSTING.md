# 🌐웹 — Brain 소셜 미디어 원본 호스팅

## 결론

새 저장 서비스를 만들지 않고, 운영 중인 Firebase Storage 버킷을 그대로 쓴다.
Brain만 짧게 열린 업로드 주소를 받을 수 있고, 서버가 파일 전체를 다시 검사한
뒤에만 `https://cocotripkr.com/social-media/<랜덤 이름>.jpg|mp4` 주소가 생긴다.

Vercel 함수는 요청과 응답이 각각 4.5MB로 제한되므로 영상 파일 자체가 Vercel
함수를 통과하면 안 된다. 업로드는 Firebase signed PUT으로 바로 보내고, 공개
다운로드는 Vercel의 고정 외부 rewrite가 Firebase 원본을 프록시한다. 이 구조는
주소를 바꾸는 3xx redirect가 아니며, TikTok `PULL_FROM_URL`의 "redirect 금지"
조건을 만족하도록 설계했다.

- Vercel 제한: <https://vercel.com/docs/functions/limitations#request-body-size>
- TikTok URL 전송 조건: <https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide>
- Vercel 외부 rewrite: <https://vercel.com/docs/routing/rewrites#rewrites-to-external-origins>

## 지원 파일

| 종류 | 확장자 | Content-Type | 최대 크기 |
|---|---|---|---:|
| 사진 | `.jpg`, `.jpeg` | `image/jpeg` | 10MB |
| 영상 | `.mp4` | `video/mp4` | 100MB |

확장자와 요청의 Content-Type만 믿지 않는다. finalize 때 다음을 모두 확인한다.

1. Firebase 실제 객체 크기와 업로드 시작 때 신고한 크기가 같은지
2. 파일 전체 SHA-256이 Brain이 보낸 값과 같은지
3. JPEG 시작·끝 표식 또는 MP4 `ftyp`/표준 브랜드가 실제로 있는지
4. 최종 공개 객체에 서버 검증 표식이 붙었는지

## API 계약

공통 요청:

- 주소: `POST https://cocotripkr.com/api/social-media-upload`
- 헤더: `Authorization: Bearer <SOCIAL_MEDIA_UPLOAD_TOKEN>`
- 헤더: `Content-Type: application/json`
- 응답과 signed URL을 로그에 남기지 않는다.

### 1. 업로드 시작

```json
{
  "action": "init",
  "filename": "daily-seoul.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 12345678,
  "sha256": "64자리 소문자 SHA-256"
}
```

성공은 HTTP 201이다.

```json
{
  "ok": true,
  "uploadId": "서명된 일회성 세션",
  "uploadUrl": "15분 유효한 Firebase signed PUT URL",
  "uploadHeaders": {
    "Content-Type": "video/mp4",
    "x-goog-content-length-range": "12345678,12345678",
    "x-goog-if-generation-match": "0"
  },
  "expiresAt": "ISO-8601"
}
```

Brain은 `uploadHeaders`를 하나도 바꾸지 않고, `uploadUrl`에 파일 원본을 PUT한다.
signed URL에는 정확한 크기와 "이미 같은 객체가 있으면 실패" 조건이 서명돼 있다.

### 2. 검사·공개 확정

```json
{
  "action": "finalize",
  "uploadId": "init 응답 값"
}
```

성공은 HTTP 200이며, 20분 세션 안에서는 같은 `uploadId`로 다시 호출해도 같은
결과가 나온다.

```json
{
  "ok": true,
  "publicUrl": "https://cocotripkr.com/social-media/<48자리 랜덤>.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 12345678,
  "sha256": "검증된 SHA-256"
}
```

공개 이름은 원래 파일명이나 계정 정보를 포함하지 않는다. 192비트 난수이고,
덮어쓰기를 금지하며 1년 immutable 캐시를 사용한다.

## 외부 rewrite 캐싱 헤더

`/social-media/(.*)` 응답에 `x-vercel-enable-rewrite-caching: 1`을 붙인다. 이 헤더는
Vercel 공식 문서에 있는 현재 지원 지시자다(2026-08-16 확인,
<https://vercel.com/docs/routing/rewrites#caching-rewrites-to-external-origins>).
2026-04-06 이후 생성된 프로젝트는 외부 origin의 `Cache-Control`을 기본으로 그대로
따르므로 이 헤더는 그 프로젝트에서는 이미 기본값과 같아 무해하고, 그 이전에 생성된
프로젝트에서는 캐싱을 켜는 데 필수다. 값을 넣지 않거나 `0`으로 두면 위 두 확장자
rewrite 응답이 CDN에 캐시되지 않는다.

이 캐싱이 안전한 이유: finalize가 Firebase 객체에 직접
`cacheControl: 'public, max-age=31536000, immutable'`을 쓰므로, Vercel이 존중하는
업스트림 `Cache-Control`이 곧 이 값이다. 객체 이름이 곧 콘텐츠 해시이므로(덮어쓰기
금지) immutable 캐싱과 충돌하지 않는다.

## 키를 넣을 위치

- **Vercel Production 환경변수:** `SOCIAL_MEDIA_UPLOAD_TOKEN`
- **🧠Brain 로컬 `.env`:** 같은 이름과 같은 값
- **GitHub Secrets:** 이 흐름에는 새 키가 필요 없다.

최소 32자 난수를 사용한다. `VITE_` 접두사를 붙이면 브라우저에 노출되므로 금지다.
Firebase Admin 키와 업로드 토큰 값은 코드, 문서, 요청 오류, 로그에 넣지 않는다.

## 배포 때 반드시 남은 일

코드만 합쳐서는 운영 공개가 끝나지 않는다. 다음 세 가지는 계정 권한이 필요한
배포/콘솔 작업이라 이 변경에서 임의 실행하지 않는다.

1. Vercel Production에 `SOCIAL_MEDIA_UPLOAD_TOKEN`을 넣고 새 배포를 만든다.
2. Firebase 권한이 있는 환경에서 `firebase deploy --only storage`로
   `storage.rules`를 배포한다. 규칙 배포 전에는 최종 URL이 403/404가 맞다.
3. TikTok for Developers에서 `https://cocotripkr.com` 도메인 소유권을 확인한다.

배포 뒤 실제 JPEG와 MP4 각 1개로 다음을 확인해야 완료다.

```text
HEAD  /social-media/<name>             -> 200, Content-Length/Content-Type
GET   /social-media/<name> Range:0-99  -> 206, Content-Range, 100 bytes
GET   /social-media/<name>             -> 200, Location 헤더 없음
POST  /api/social-media-upload (오답 키) -> 401
```

Vercel 외부 rewrite가 배포 환경에서 `Range` 또는 `HEAD`를 보존하지 않으면 TikTok
URL 전송을 열면 안 된다. 그 경우에는 TikTok은 `FILE_UPLOAD` 방식으로 우회하고,
미디어 전용 CDN/커스텀 도메인을 별도 승인받아야 한다.

## 운영 메모

- init만 하고 finalize하지 않은 `social-media-staging/` 객체는 공개되지 않는다.
  비용 누적 방지를 위해 버킷 수명주기 규칙으로 1일 뒤 삭제를 권장한다.
- 기존 Firebase Storage 사용량과 Vercel 전송량에는 사용량 기반 비용이 생길 수
  있다. 새 유료 제공자는 추가하지 않았다.
- 공개 객체 삭제 API는 만들지 않았다. 삭제가 필요하면 운영자가 Firebase에서
  정확한 객체를 확인하고 수동 처리한다.
