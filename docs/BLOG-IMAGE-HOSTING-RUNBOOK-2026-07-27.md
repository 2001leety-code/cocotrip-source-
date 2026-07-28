# Blogger 이미지 영구 보관 경로 — 2026-07-27

## 목적

Brain OS가 외부 사진 주소를 Blogger 본문에 직접 넣지 않도록 한다. 사진은 먼저
Firebase Storage의 비공개 `blog-images/{year}/{slug}-{sha12}.webp` 객체로 저장하고,
공개 주소는 CocoTrip 도메인만 사용한다.

```
https://cocotripkr.com/blog-images/{year}/{slug}-{sha12}.webp
```

## 웹 제공 경로

- 기존 `public/blog-images/**` 파일은 Vercel 파일 시스템이 그대로 우선 제공한다.
- 정적 파일이 없는 새 주소만 `/api/blog-image`로 재작성한다.
- 서버 함수는 `blog-images/연도/해시이름.webp` 형식만 허용한다.
- Firebase의 다른 객체 경로는 요청할 수 없다.
- `image/webp`, 10MB 이하인 객체만 제공하며 장기 캐시와 `nosniff`를 적용한다.

## 환경변수

- Vercel: 기존 `VITE_FIREBASE_STORAGE_BUCKET` 또는 `FIREBASE_STORAGE_BUCKET`.
- 둘 다 없으면 기존 `FIREBASE_PROJECT_ID`로 신규 Firebase 버킷 이름을 계산한다.
- 새 비밀키는 추가하지 않는다. 기존 Firebase Admin 자격증명을 사용한다.

## 운영 확인

1. Brain OS가 먼저 사진을 Firebase Storage에 올린다.
2. `cocotripkr.com/blog-images/...`가 200과 `image/webp`를 반환하는지 확인한다.
3. 확인이 끝난 주소만 Blogger에 발행한다.
4. 사진 저장·검증 중 하나라도 실패하면 글 발행을 중단하고 검토 대기로 되돌린다.
