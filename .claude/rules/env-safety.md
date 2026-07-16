---
description: 환경변수 안전 규칙 — 손상 시 prod 인증/지도 API 사망. env 키를 추가·변경하거나 관련 helper 수정 시.
paths:
  - "api/_shared/**"
  - "vercel.json"
---

# 환경변수 안전 규칙 (CRITICAL)

> 자동 로드는 env 배선이 모인 `api/_shared/**`·`vercel.json` 기준이지만, **`process.env`를 읽는 모든 `api/*` 파일에 적용된다.**

## `FIREBASE_PRIVATE_KEY`

- **Vercel Dashboard에서 직접 입력만.** CLI(`vercel env add`)로 설정 금지 — 줄바꿈/특수문자 손상 시 `cert()` invalid → Firebase 인증 전체 401.
- 정답 패턴: `(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')` — `.trim()` 금지, PEM reformat 금지.

## `NCP_CLIENT_ID` (Naver Maps NCP 키)

- `process.env.NCP_CLIENT_ID.trim()` 필수 — 보이지 않는 개행(`\n`)으로 401.
- 네이버 키 2종 혼용 금지: **검색 API 키(Naver Developers)** 와 **지도 NCP 키(NCP Maps)** 는 다른 시스템.

## 일반 원칙

- env 키는 Vercel Dashboard에서만 관리. **Git 저장 금지.**
- 신규 키 추가 시 production/preview/development **모든 환경에 동시 등록** — preview만 빠지면 PR 빌드 silent fail.
- 값이 개행/공백으로 오염될 수 있는 키는 읽는 helper에서 `.trim()` 여부를 키 특성에 맞게 결정(단, `FIREBASE_PRIVATE_KEY`는 예외 — trim 금지).

## 이 저장소에서 하지 않는 것

- AI는 secret rotation·`vercel env` 변경·prod env 조작을 **수행하지 않는다.** 필요하면 서비스명만 사용자에게 보고하고 사용자가 직접.
