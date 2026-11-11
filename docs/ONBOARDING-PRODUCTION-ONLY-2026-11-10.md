# 가입 쿠폰 복구 API의 운영 전용 최소안

## 결과

운영 기준 `efbb60e51ee542522f6de8529fffdd54fc8e32db`에서 공통 Firebase 모듈을 교체하지 않고 쿠폰 안전 변경을 포팅했다. 두 관리자 복구 API는 정확한 `VERCEL_ENV=production`에서만 POST 요청을 처리한다. Preview·development·환경 미설정·대소문자/공백이 다른 값은 503 `RECOVERY_PRODUCTION_ONLY`로 거부한다.

- 브랜치: `fix/onboarding-admin-prod-only-20261110`.
- 작업트리: `onboarding-admin-prod-only-20261110`.
- 이전 `onboarding-admin-prod-base-20261110`의 19개 변경 파일과 원본 `onboarding-admin-safety-20261110`의 13개 변경 파일은 해시로 보존 확인.
- 기존 Preview 기준과 운영 기준 사이의 66개 변경은 이번 작업본에 하나도 포함하지 않았다.
- 운영/Preview 접속·배포·push·커밋·staging·자격증명 읽기·실제 발급·고객 데이터 변경 없음.

## 변경 범위

총 16개 파일이다.

- 두 API: `api/admin-coupon-fix.js`, `api/admin-issue-onboarding-coupons.js`.
- UI: `src/pages/AdminClaims.tsx`.
- CI: `scripts/validate-prod-admin-auth.mjs`, `scripts/lib/admin-onboarding-dryrun-result.mjs`.
- 개발 프록시: `vite.config.ts`, `scripts/lib/dev-api-proxy-bypass.mjs`.
- 검사 7개: `admin-coupon-fix-target-auth.test.ts`, `admin-onboarding-json-guard.test.ts`, `admin-onboarding-dryrun-result.test.ts`, `admin-claims-coupon-confirmation.component.test.tsx`, `onboarding-recovery-production-only.test.ts`, `onboarding-recovery-load-failure.test.ts`, `dev-coupon-proxy-block.test.ts`.
- 문서: `tests/regression/README.md`와 이 보고서.

`api/_shared/admin-auth.js`, `firebase-admin.js`, `user-auth.js`는 운영 기준과 동일하다. 이전 포트의 `firebase-admin-provenance.js`, `preview-firebase-app.js`, `firebase-auth-app.js`는 운영 기준처럼 존재하지 않는다. 다른 결제·예약·크론 소비자가 사용하는 공통 Firebase 경로를 바꾸지 않았다.

`api/onboarding-coupons.js`와 그 발급·구매 쿠폰·marker·트랜잭션 로직도 그대로다. 새로운 persistence helper나 저장소 모델을 만들지 않았다.

## 초기화 전 차단

두 API는 이제 CORS와 지연 초기화하는 Sentry 모듈만 정적으로 import한다. 관리자 인증, 중앙 Firebase DB, `onboarding-coupons.js`는 운영 환경 검사 뒤에 동적으로 import한다.

`onboarding-coupons.js`가 내부적으로 중앙 Firebase를 정적으로 import하므로, 발급 함수 import도 함께 뒤로 옮겼다. 직접 DB import만 늦추고 발급 함수 import를 남기는 방식은 사용하지 않았다.

순서:

1. OPTIONS 200 / POST 외 405의 기존 계약.
2. 정확한 production이 아니면 POST 503으로 즉시 종료. dryRun도 예외 없음.
3. 운영에서 기존 Firebase/관리자 인증 모듈과 실제 발급 모듈을 지연 로딩.
4. 관리자 권한 확인.
5. 입력 검증, DB 사용 가능 확인, 필요한 대상 Auth 존재 확인.
6. 승인된 단건 실행 또는 dryRun 문서 조회.

운영에서는 이전과 같이 중앙 DB bootstrap이 관리자 토큰 검증 전에 초기화된다. 이 bootstrap은 SDK 객체를 준비하는 동작이며, 대상 문서 조회·발급은 권한/입력 검증 뒤에 수행한다. 모듈 로딩 실패를 다른 앱이나 환경으로 우회하는 fallback은 추가하지 않았다.

동적 runtime import 자체가 실패하면 고정 500 JSON `RECOVERY_RUNTIME_UNAVAILABLE`를 반환한다. 내부 import 오류 내용은 응답에 노출하지 않고 고정 진단 문구만 console에 남긴다. 이 경우 관리자 인증 호출·대상 조회·발급을 진행하지 않는다. 원래 handler 밖으로 나가던 import 예외 6건을 먼저 재현한 뒤 보완했다.

## 개발 프록시 보호

서버의 production gate만으로는 로컬 UI를 보호할 수 없었다. 기존 Vite `/api` 프록시가 요청을 운영 서버로 보내면 그 서버의 환경은 production이기 때문이다.

`devApiProxyBypass`는 두 복구 경로를 Vite의 `false` 반환 계약으로 로컬 404 처리한다. query, trailing slash, 중복 slash, dot segment 및 인코딩된 경로도 확인한다. 잘못됐거나 모호한 인코딩은 거부한다. `/api/_shared/*.js`의 기존 로컬 소스 bypass와 관련 없는 정상 API 경로의 프록시 동작은 유지했다.

실제 Vite 미들웨어를 HTTP listener 없이 직접 호출해 두 경로의 404를 확인했다. 테스트 대상 프록시는 가상의 `.invalid` 주소이며 Node 네트워크 차단을 유지했다. 운영 서버에 요청하지 않았다.

이 보호는 이 작업본의 Vite 개발 프록시에만 해당한다. 직접 운영 URL을 호출하거나 다른 프록시/기존 버전의 dev 서버를 쓰면 대신 막아주지 않는다. 다른 API는 여전히 운영 프록시를 사용하므로 일반 dev 화면 전체가 안전한 테스트 환경이 된 것은 아니다.

## 유지한 안전 변경

- UI의 혜택 3개/365일 안내, Enter 자동 발급 제거, 대상 확인, 중복 클릭 방지.
- 프로모 종료 응답을 성공으로 표시하지 않고 입력 보존.
- 단건 UID/이메일의 Auth 사용자 존재 확인, UID 우선순위 및 이메일 정규화.
- 일괄 API의 명시적 boolean dryRun, 엄격한 객체 본문/필드/UID/pageSize 검사.
- 실제 실행은 단일 UID 명시 필수. UID 없는 일괄 발급 경로 없음.
- 두 경로 모두 없는 UID는 404 `USER_NOT_FOUND`, 그 외 대상 Auth 실패는 500 `INTERNAL_ERROR`, 발급 함수 미호출.
- 운영 dryRun의 조회/응답 계약 유지. CI의 정상 `{pageSize:1,dryRun:true}` 유지 및 실제 발급 응답 fallback 거부.
- 운영 관리자 인증의 Bearer token, revoke 확인, email_verified, 관리자 이메일 또는 admin claim 판단을 기존 공통 코드 그대로 사용한다.

## 검증

검증 폴더: `../onboarding-prod-only-validation-20261110`.

- `node ../onboarding-prod-only-validation-20261110/run-checks.mjs final-packaging-safety`: 17개 파일, 368개 검사 통과. 최초 최소안 단계의 15개 파일/339개 결과는 이전 기록이다.
- 새 `onboarding-recovery-production-only.test.ts` 43개: 실제 두 API와 실제 공통 모듈을 import하고 SDK 호출만 mock한다. 실제 발급 함수는 실행하지 않는다.
  - 비운영 환경 8종, 모듈 import만 수행한 경우, OPTIONS/GET, production에서 Preview로 바뀐 warm cache, Preview dryRun 모두 초기화/인증/문서 접근 없이 거부하거나 기존 method 응답.
  - 운영의 토큰 누락, 비관리자, 이메일 미인증, revoke, 관리자 설정 누락, UID/이메일 not-found, UID dryRun 계약.
  - 세 runtime import가 환경 gate 뒤의 동적 import인지 소스 검사도 수행.
- 별도 기존 요청/대상 검사는 발급 함수를 mock해 정상 단건 dispatch와 실패 시 호출 차단을 검증한다. 저장·트랜잭션 모델은 없다.
- runtime import 오류 8개, 개발 프록시 21개 검사를 추가했다. 프록시 검사는 실제 Vite 미들웨어도 포함한다.
- `run-quality.cjs lint`: 변경 코드/검사 14개 파일 통과.
- `run-quality.cjs build`: 실제 `npm run build` (`tsc -b && vite build`) 통과.
- 두 API `node --check`, `git diff --check` 통과.
- `audit-port.cjs`: 전체 66개 선행 변경 미포함, 상대 import 11개 모듈의 누락 0, 원본 및 이전 포트 해시 보존, staging 없음 확인.
- 빌드의 기존 Tailwind utility/혼합 import/큰 chunk 경고는 남아 있다. 해당 소스는 변경하지 않았다.

### 네트워크와 자격증명 경계

기존 검증 실행기를 사용한다. 자식 프로세스 환경은 OS 실행 키 allowlist와 빈 HOME/USERPROFILE/APPDATA/LOCALAPPDATA로 구성하고, 실제 `.env`나 `.vercel` 파일을 복사하지 않았다. Vitest는 `envDir:false`, 빌드는 `PRERENDER=0`이다.

기존 `offline-guard.cjs`를 `NODE_OPTIONS`로 로드해 Node net/tls/http/https/fetch 연결을 거부한다. 최종 test/lint/build audit의 연결 시도 횟수는 모두 0이다. 이것은 Node 경계 차단이며 OS 방화벽이나 모든 비-Node 프로세스의 전체 egress 차단 증명은 아니다.

테스트 안의 production 값과 Firebase 문자열은 SDK mock용 fixture다. 실제 운영 환경이나 자격증명을 사용한 검사가 아니다. 운영 CI 스크립트도 실행하지 않았다.

## 동적 import의 오프라인 의존성 패키징 검사

별도 폴더 `../onboarding-prod-only-packaging-20261110`에서 설치된 공식 Vercel CLI 50.38.3의 `@vercel/node` 5.7.0이 사용하는 `@vercel/nft` 1.5.0 추적기를 이용했다. 이후 같은 로컬 입력으로 공식 Node builder의 `build()`까지 실행했다. 전체 Vercel CLI 빌드나 배포는 실행하지 않았다.

- 각 API에서 2,344개 파일, 약 15.3 MB의 추적 결과를 격리 폴더에 복사했다.
- 세 동적 import와 Auth/Firestore·user-auth·attribution 등 필수 파일 13개가 각각 포함됐다.
- 격리 복사본 12개 실행 검사 통과: 두 API 각각 미설정/preview/development/대소문자 또는 공백 오류 환경은 503, 정확한 production+무토큰은 401.
- 비운영 실행에서는 Firebase 모듈 로드 0개였다. production은 복사본 안의 SDK 모듈을 로드했지만 자격증명·인증 토큰·대상 UID 없이 401에서 종료했다. 실제 인증/DB/발급은 실행하지 않았다.
- 외부 node_modules fallback 0개. 추적·복사·실행 전후 두 API 해시 일치. 모든 실행에 빈 HOME 및 Node 연결 차단 적용, 네트워크 시도 0.
- 각 함수에서 추적 경고 6개가 남았다: optional `encoding`, Sentry 관련 `import-in-the-middle`의 동적 경로, grpc LICENSE의 script/module 파싱. 검증한 거부 경로에는 영향을 주지 않았다. 아래 별도 모의 검사에서도 Sentry 초기화/오류 수집은 성공했지만 실제 전송·모든 계측·인증/저장 경로를 보증하지 않는다.

근거: `trace-summary.json`, 함수별 `*.manifest.json`, `runtime-summary.json`, `trace-network.ndjson`, `runtime-network.ndjson`. 이것은 공식 tracer를 쓴 의존성 포함/복사본 실행 근거다. Vercel 빌더의 변환·함수 wrapper·Linux 런타임 전체 증명은 아니다.

### 공식 Node builder 후속 검사

설치된 수정 없는 `@vercel/node` 5.7.0의 `build()`를 비개발 모드로 실행해 두 `NodejsLambda` 출력을 만들었다. runtime은 `nodejs22.x`, architecture는 `x86_64`, launcherType은 `Nodejs`다. 함수별 2,344개 파일과 필수 의존성 13개가 모두 포함됐고, 입력과 출력의 공통 파일 해시는 모두 같았다.

입력은 앞서 검증한 함수별 격리 복사본뿐이다. 공식 구현의 `meta.skipDownload=true`, `VERCEL_INSTALL_COMPLETED=1`, `considerBuildCommand=false`를 사용했다. 설치 생략 로그를 확인했고 실행 대상 package script가 없음을 검사했다. 기존 로컬 의존성을 재사용한 것이므로 원본 전체 프로젝트의 설치/lockfile 재현성 검사는 아니다. builder나 설치된 패키지를 수정하지 않았다.

공식 출력 파일을 직접 import한 무토큰 검사도 12/12 통과했다. 비운영은 503과 Firebase CommonJS 모듈 로드 0, 정확한 production은 401이었다. 외부 node_modules fallback 0, API 원본/입력/출력 해시 일치, 빈 HOME 유지, builder 및 실행 감사의 네트워크 시도 0을 확인했다. 운영 자격증명·인증 토큰·대상 UID·실제 서비스는 사용하지 않았다.

이는 준비된 로컬 입력에 대한 공식 함수 builder 검증이다. 전체 `vercel build` CLI, 실제 프로젝트 설정/파일 제외/라우팅/maxDuration, Vercel launcher 후처리, Linux 호스팅이나 실서비스 검증은 아니다. 근거: `OFFICIAL-BUILDER-REPORT.md`, `official-builder-summary.json`, 함수별 `*.official-builder-manifest.json`, `official-builder-smoke-summary.json` 및 두 network audit.

### 남은 추적 경고의 영향

- `node-fetch` 2.7의 `encoding`은 선택적 의존성이다. 일반 `text()`와 `json()`은 복사본에서 통과했고, `textConverted()`만 명시적으로 의존성 누락 오류가 났다. 현재 `api`/`scripts`에는 `textConverted` 호출이 없다. 해당 변환 기능까지 가능하다고 주장하지 않는다.
- `import-in-the-middle`의 `'./'` 경고는 CommonJS re-export를 분석하는 동적 해석 경로다. 고정된 쿠폰 모듈의 누락으로 확인된 것은 아니다. 실제 복사된 Sentry SDK 10.76.2를 제품과 같은 주요 계측/개인정보 옵션으로 초기화하고, 공식 custom transport를 메모리 배열로 바꿔 합성 오류 1건씩 수집했다. 두 패키지 모두 초기화·capture·flush·close가 통과했다. 제품 Sentry wrapper 전체, 실제 전송, 모든 자동 계측 조합을 검증한 것은 아니다.
- grpc LICENSE 관련 4개 경고는 라이선스 텍스트를 script/module로 파싱하는 과정에서 발생한다. 두 공식 builder 출력과 검증한 모듈 로드/거부 경로는 이 경고에도 성공했다.

Sentry 검사에는 `.invalid` 가상 DSN만 사용했고, 전송은 메모리에만 저장했다. 외부 의존성 fallback 0, Node 감사 네트워크 시도 0이었다. 실제 Sentry로 오류를 보내거나 경고를 억제하지 않았다. 근거: `sentry-mock-summary.json`, `sentry-mock-network.ndjson`, `sentry-mock-child.cjs`.

## Preview 검증 한계와 미해결 사항

- 이 작업본의 Preview에서는 두 관리자 복구 API가 항상 거부된다. 정상 UID/이메일 조회, dryRun, 실제 발급의 Preview E2E는 할 수 없다. 허용 환경으로 위장하거나 gate를 제거해 시험하지 않는다.
- Preview에서 볼 수 있는 것은 거부 응답과 UI의 안전한 실패 표시까지다. 이번 단계에서는 브라우저/실제 Preview 요청도 실행하지 않았다. UI 소스는 앞선 수정과 동일하고 component 검사 및 빌드로 재검증했다.
- 이것은 두 복구 API의 운영 전용 정책이다. 다른 가입/결제/예약 API 전체의 Preview 격리나 부작용 차단을 새로 제공하지 않는다. 기존 Preview 작업트리나 실제 배포도 변경하지 않았다.
- 실제 Firebase 인증·설정, 전체 Vercel CLI/프로젝트 설정/launcher 및 배포 런타임, 실제 Firestore 저장/동시성은 미검증이다. 공식 tracer와 Node 함수 builder, 격리 출력 직접 실행 및 Sentry 모의 검사는 위 범위까지만 완료했다. npm build 통과도 실서비스 검증을 대신하지 않는다.
- 기존 이력/marker 불일치·중복·일부 누락·Auth 확인 후 삭제 race는 해결하지 않았다. dryRun 후보 조회의 marker 누락/null 및 pagination 한계도 남아 있다.
- 2026-11-10 09:29 UTC Vercel 관리 API 읽기 전용 확인에서 운영 SHA는 로컬 기준 `efbb60e51ee542522f6de8529fffdd54fc8e32db`와 같았다. apex/www alias는 동일 READY production 배포를 가리킨다. 실제 사이트/API는 호출하지 않았고 환경값은 복호화하지 않았다. 환경 목록은 일부 잘렸으므로 전체 Firebase 설정이나 적용된 값의 유효성은 미검증이다. 상세는 검증 폴더의 `LIVE-BASELINE-READONLY-20261110.md`에 기록했다. 향후 적용 직전 기준 재확인과 별도 승인·검증이 필요하며, 이 결과만으로 배포 가능한 상태라고 결론 내리지 않는다.
