# Google Play 제출 체크리스트

설정 정본은 `config/google-play-release.v1.json` 하나다. package name, 서명 지문, 계정 유형을
다른 문서나 스크립트에 복사하지 않는다. 현재 값이 비어 있는 것은 누락이 아니라 운영자 확정 전
잠금이다. `npm run play:preflight`는 하나라도 비어 있거나 서로 다르면 실패한다.
정책 확인 기록은 30일이 지나면 자동으로 실패해 공식 문서를 다시 확인하게 한다.

## 1. 운영자가 먼저 확정할 값

1. `android.packageName`: 한 번 출시하면 바꾸기 어려운 영구 Android 패키지명
2. `android.playSigningSha256CertificateFingerprints`: Play Console의 **App signing key certificate** SHA-256
   지문. 업로드 키 지문을 대신 넣지 않는다.
3. `playDeveloperAccount.type`과 `createdAt`: 개인/조직 여부와 계정 생성일. 2023-11-13 이후 만든
   개인 계정이면 비공개 테스트 조건을 설정 정본의 `closedTesting`에 사실대로 기록한다.

키·비밀번호는 JSON에 넣지 않는다. Play App Signing 키는 Play Console이 관리한다. 업로드 키를
만들게 되면 키 파일과 비밀번호는 레포 밖 로컬 보안 저장소에 두고, CI가 필요할 때만 GitHub
Secrets에 별도로 넣는다. Vercel 환경변수에 Android 서명 키를 넣지 않는다.

## 2. TWA와 PWA

- 현재 `/`, scope `/`, standalone, injectManifest, 192/512 아이콘 계약은 유지한다.
- 확정한 package name으로 `android/` TWA 프로젝트를 만든다.
- `targetSdk`는 설정 정본과 Android build.gradle 모두 36 이상이어야 한다.
- release AAB를 만들고 `android.releaseBundlePath`에 기록된 위치와 일치시킨다.
- `public/.well-known/assetlinks.json`은 package name과 **Play App Signing** SHA-256을 같이 담는다.
- 배포 후 `https://cocotripkr.com/.well-known/assetlinks.json`의 HTTP 200, JSON MIME, 실제 지문을 다시
  확인한다. 브라우저 주소창이 사라지는지는 실제 Android 기기의 설치본으로 확인한다.

## 3. 계정 삭제 요청

- 공개 URL: `https://cocotripkr.com/account-deletion`
- 앱 안 진입: 마이페이지 → 내 계정 → 계정 삭제 요청
- 로그인하지 않은 사용자는 전 페이지 하단의 계정 삭제 요청 링크로 들어갈 수 있다.
- 현재 흐름은 고객지원 이메일로 요청을 **시작**할 뿐 즉시 삭제하지 않는다. 비밀번호, 인증번호,
  카드번호, PayPal 정보를 이메일로 받지 않는다.

자동 삭제 API는 아래 세 결정 전까지 만들지 않는다.

1. Google·Apple·LINE·휴대전화 로그인별 재인증과 계정 소유 확인 방법
2. Firebase Auth, Firestore 하위 컬렉션, 예약·결제·분쟁 기록, 분석·오류 서비스까지 포함한 삭제 범위와 법정 보존표
3. 처리 기한, 취소 가능 시점, 실패 복구와 운영 감사 담당자

## 4. Play Console 수동 확인

완료한 항목만 `manualDeclarations`를 `true`로 바꾼다.

- Data safety: Firebase/Firestore, GA4, PostHog, Sentry, PayPal과 고객지원 흐름을 실제 코드·설정 기준으로 작성
- 계정 삭제: 웹 URL과 앱 안 경로, 보존되는 자료를 개인정보처리방침과 같은 내용으로 신고
- 광고 포함 여부, 콘텐츠 등급, 대상 연령
- 검토자가 로그인 기능을 확인할 수 있는 접근 안내. 계정 비밀번호는 레포 설정에 기록하지 않는다.

## 5. 스토어 자료

- 전용 512x512 앱 아이콘. 미리 둥글게 자르거나 그림자를 넣은 후보를 그대로 쓰지 않는다.
- 1024x500 특성 그래픽
- 실제 Android 설치본에서 촬영한 휴대전화 스크린샷 최소 2장
- 앱 이름·짧은 설명·상세 설명의 혜택 문구가 실제 기능과 일치하는지 검수

## 6. 검증 명령

```bash
npm run play:preflight
npx vitest run tests/unit/google-play-preflight.test.ts tests/unit/account-deletion-page.component.test.tsx
npx vitest run tests/unit/pwa-splash-shortcuts.test.ts tests/unit/bughunt-splash-ready.test.ts tests/unit/pwa-update-prompt-no-forced-reload.test.ts
npm run build
```

preflight가 실패한 상태에서는 AAB 제출, Play Console 출시, package name 변경, assetlinks 배포를 하지 않는다.

## 공식 근거

- [Android 16(API 36) 대상 요구사항](https://developer.android.com/google/play/requirements/target-sdk)
- [Trusted Web Activity 개요와 Digital Asset Links](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities)
- [Google Play 계정 삭제 요구사항](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en)
- [신규 개인 계정 비공개 테스트 요구사항](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)
