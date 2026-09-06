# 개인용 Android 운영 컨트롤러

Google Play에 올리지 않는 운영자 전용 설치 앱이다. `com.cocotrip.owner`가
`https://cocotripkr.com/admin/ai-center`를 열며, 기존 관리자 로그인과 권한 검사를 그대로 사용한다.
설치만으로 관리자 권한을 얻지는 않는다.

## 설치 파일과 첫 실행

- 운영자 PC 설치 파일: `C:\Users\dlxod\Downloads\CocoTrip-Owner-v1.0.0.apk`
- 최소 Android 6.0(API 23). 신뢰된 웹 실행은 지원되는 브라우저와 사이트 연결 확인이 필요하다.
- 휴대폰으로 APK를 옮겨 설치하고 CocoTrip Owner 아이콘을 연다. 설치 출처 허용과 Google 로그인은 운영자가 직접 진행한다.
- 개발 검증은 데이터 케이블 연결 → 개발자 옵션의 USB 디버깅 → 휴대폰의 연결 허용 후 진행한다.
  `adb devices -l`에 승인된 기기가 표시돼야 설치·실행 결과를 기록할 수 있다.
- 다른 서명으로 설치된 앱 때문에 덮어쓰기가 실패하면 임의 삭제하지 않는다. 기존 앱과 서명을 먼저 확인한다.

## 무엇이 자동으로 업데이트되나

웹 화면과 기능은 Vercel 배포를 통해 갱신된다. 기존 PWA 업데이트 코드는 앱 진입 직후 새 버전을 확인하면
사용자 입력·결제 진행 여부와 짧은 대기 시간을 확인한 뒤 적용한다. 이미 작업 중이면 업데이트 선택을 남긴다.
모든 변경이 배포 즉시 열린 화면을 강제로 바꾸는 구조는 아니다.

Android 설치 파일 자체(패키지·아이콘·실행 설정 등)를 바꾸는 경우에는 같은 서명키와 증가한
`versionCode`로 새 APK를 만들어 다시 설치해야 한다. 별도 APK 자동 설치 기능은 없다.
PC를 꺼도 Vercel 웹은 열 수 있지만, 로컬 Brain OS에서만 실행되는 작업까지 서버로 옮겨지는 것은 아니다.

## 배포 버전 확인

- HTML의 `data-cocotrip-build`와 `meta[name="cocotrip-build"]`는 빌드 시 공개 커밋 SHA를 담는다.
- Vercel SHA를 우선하고, 없으면 GitHub SHA를 쓴다. 누락되거나 형식이 잘못되면 `local`이다.
  로컬 빌드는 `local`만으로 서로 다른 버전을 구분할 수 없다.
- `data-cocotrip-navigation`은 `navigate`, `reload`, `back_forward`, `prerender`, `unknown` 중 하나다.
  이 값만으로 자동 업데이트가 성공했다고 판단하지 않는다.
- 새 배포 SHA·운영 HTML·실행 페이지의 SHA가 일치하는지 확인한다. 이전 버전 페이지를 남겨 둔 상태에서
  새 배포 뒤 앱을 다시 열고, 수동 새로고침 없이 새 버전으로 전환됐는지도 따로 기록한다.
- 브라우저 탭 검증과 실제 Android 설치·주소창 없는 실행·알림·업데이트 검증을 구분한다.
  연결된 휴대폰이 없으면 실기기 항목은 미검증이다.

## 서명과 운영 연결

정본은 `config/owner-controller-release.v1.json`과 `public/.well-known/assetlinks.json`이다.
공개 인증서 지문과 패키지가 일치해야 하며, 사이트 연결 API의 성공은 설치·실행 성공과 별개다.
키 파일·암호·로컬 서명 설정은 저장소에 넣지 않는다.

로컬 서명 빌드는 운영자 Windows 계정의 보호된 실행기
`C:\Users\dlxod\.cocotrip\owner-controller\build-owner-controller.ps1`를 사용한다.
실행기는 보호 저장소에서 암호를 읽고 빌드가 끝나면 임시 환경변수를 복원한다.
키를 재생성하거나 지문을 바꾸면 기존 설치본과 업데이트 관계가 달라지므로 별도 결정이 필요하다.

## 배포 검사

`npm run build`, 단위검사, 크기·실수 패턴·훅 검사와 브라우저 확인을 마친 뒤 브랜치 하나로 묶어 푸시한다.
머지 후 Vercel이 READY인지 확인하고 `/admin/ai-center`, `/sw.js`,
`/manifest-owner-controller.webmanifest`, `/.well-known/assetlinks.json` 응답을 확인한다.
서명 APK가 존재한다는 이유로 실기기 알림·자동 업데이트까지 완료로 기록하지 않는다.
