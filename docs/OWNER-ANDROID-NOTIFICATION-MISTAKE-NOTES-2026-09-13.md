# Android 소유자 앱 알림 연결 보완

## 11시 후속: 1.0.2에서도 등록되지 않음

사용자 새 사진은 여전히 기기 미등록/브라우저 권한 요청 전이다. 현재 USB 기기 0개이므로 새로운 실기기 권한 값을 읽은 것은 아니다. 지난 실제 검사에서 실행 브라우저는 Samsung Internet 30이었으며 Google ABH 공식 브라우저 지원표는 Samsung Internet의 기본 TWA 지원과 알림 위임 미지원을 구분한다. 1.0.2의 권한·서비스 보완만으로 이 브라우저 호환성을 해결할 수 없었다. 단, 사진만으로 브라우저 웹 권한 실패의 모든 원인을 확정하지 않는다.

- 최소 후속은 컨트롤러 앱에만 Chrome provider를 지정하는 1.0.3/code 4다. 사용자의 OS 기본 브라우저, 기존 삼성 인터넷 로그인/데이터, 고객 데이터/웹 UI/서버 설정/키는 바꾸지 않는다. Chrome 로그인은 별개 세션이라 사용자가 다시 로그인해야 할 수 있다.
- ABH 2.7.3 실제 AAR의 javap 바이트코드에서 LAUNCHING_BROWSER/LAUNCHING_BROWSER_NAME 해석, createTwaLauncher의 명시 provider 전달, 미설치/비활성 provider 때 공식 안내창 fallback을 확인했다. Java launcher나 인증서 검증을 재작성하지 않는다. Chrome 자동 설치/활성화 및 권한 강제 승인도 하지 않는다.
- Spark가 정확한 compiled launcher metadata 검사 코드를 작성했고 root가 기존 검사 함수에 통합했다. 누락·잘못된 브라우저·다른 Activity의 메타데이터·리소스 값·중복을 거부하는 회귀 검사를 추가한다.
- 11:09에 본인 폰 연결을 확인했고 기존 1.0.2/code 3·OS 알림 권한 false·Chrome 152 활성 설치를 확인했다. 같은 키로 1.0.3/code 4를 서명 빌드/preflight PASS 후 11:10 user0 덮어 설치 Success. 최초 설치시각 유지, OS 기본 브라우저는 설치 전후 모두 com.sec.android.app.sbrowser다. 앱 실행 방식만 바뀌며 기본 브라우저를 바꾼 것이 아니다.
- 1.0.3 실제 Chrome 실행/권한/구독/서버 등록/수신 확인은 남아 있다. 새 앱 열기, 필요시 본인 로그인 후 AI 센터를 보여 달라고 요청했다. 등록 버튼 반복 요청 전 실제 provider부터 확인한다. 실폰 확인 전 추가 업로드나 머지를 반복하지 않는다. PR1395는 기존 1.0.2 head의 Draft OPEN이다. 이 PR의 원격 Android 컴파일은 PASS, 일부 검사는 docs-only 판정으로 SKIPPED/대체 상태이며 Lighthouse는 FAIL이다. 이를 실제 전체 원격 검사 PASS로 보고하지 않는다.
- 새 변경 관련 5파일/123개 검사, 변경 ESLint, npm run build, unsigned/signed Android 빌드와 최종 APK 검사 PASS. 기존 1.0.2 APK는 Chrome provider 없음으로 FAIL 대조했다. 전체 11,385개는 이전 1.0.2 검사 기록이고 이번 1.0.3 전체 검사를 다시 돌렸다고 쓰지 않는다.
- 설치 파일 C:/Users/dlxod/Downloads/CocoTrip-Owner-v1.0.3.apk, SHA-256 ED6ED7D7C80A655AFC980B6101B0FAD4B54577361F831D698465355440843546.

공식 지원표: https://github.com/GoogleChrome/android-browser-helper/blob/main/docs/trusted-web-activity-browser-support.md

## 실수와 재발 방지

- TWA 실행과 웹 Push 지원만으로 Android 앱 알림이 연결됐다고 판단하지 않는다. 기존 1.0.1에는 POST_NOTIFICATIONS, ABH DelegationService, NotificationPermissionRequestActivity가 모두 없었다.
- 실제 연결된 Android 16 폰의 삼성 인터넷 실행 페이지에서 권한 default/prompt, 활성 서비스워커, 구독 없음이 확인됐다. 앱 구성 누락은 확인된 결함이지만 삼성 인터넷의 웹 권한이 유지되지 않는 단일 원인으로 확정하지 않는다.
- ABH 공식 알림 샘플과 실제 사용하는 2.7.3 AAR의 세 클래스를 확인하고 기존 인증·주소·서명은 유지한다. 알림 권한 외 연락처·사진·위치 등은 추가하지 않는다. 권한은 사용자 동작에 따라 요청하며 강제 승인하지 않는다.
- 소스 문자열뿐 아니라 최종 APK를 aapt2로 읽어 권한, 비공개 권한 요청 Activity, 검증된 브라우저만 받는 ABH 서비스와 정확한 intent-filter를 검사한다. 누락·중복·잘못된 소속·공개 Activity·권한 SDK 상한을 거부한다.
- Spark가 알림 구성 검사 구현 초안을 작성했다. 주 담당이 기존 파서에 통합하며 중복 도우미 제거, 엄격한 enabled 값·alias·필터 검증을 보완했다. 별도 Terra 담당은 검사 사례를 구현한다.

## 범위

앱 버전은 1.0.2/code 3. 웹 UI·서비스워커·서버 발송·Firebase 규칙·VAPID·서명키를 변경하지 않는다. 웹 자동 업데이트는 네이티브 APK 권한 변경을 대신하지 않는다. 같은 서명으로 APK를 교체 설치한 뒤 앱 권한, 웹 권한, 구독, 서버 등록, 실수신을 각각 확인해야 한다.

검증용 미서명 APK와 기존 보호 저장소를 사용한 서명 APK 빌드가 모두 성공했다. 최종 APK 구성·서명·버전 검사 PASS, 기존 1.0.1 APK는 알림 권한 누락으로 FAIL을 확인했다. 2026-09-13 03:09 KST 지정 본인 폰 user 0에 1.0.2/code 3 덮어 설치 Success, 최초 설치 시각 2026-09-07 12:55:32 유지. 기기 삭제·초기화·키 교체·강제 권한 승인은 없다.

설치 직후 OS 알림 권한 granted=false는 실제 승인 전 상태다. 새 앱을 열어 등록·허용하도록 요청했다. 실기기 웹 권한·구독·서버 등록·실수신은 사용자 응답 후 별도로 확인해야 하며 설치 성공으로 완료 처리하지 않는다.

APK SHA-256: `27DED7D36F45C9566B59C9A34F113D71ED433D8733B1F3CB6772A4E3D7F80E39`. 같은 파일을 Downloads/CocoTrip-Owner-v1.0.2.apk에 보존한다. 비공개 서명 비밀번호 원문은 도구 출력·파일·커밋에 기록하지 않았다.

검사 결과: 전체 단위 813파일/11,385개 PASS/7 todo, 알림 APK 검사 2파일/71개 PASS, 관련 Android·웹 알림·PWA 잠금 10파일/121개 PASS, npm run build 및 변경한 검사 코드 ESLint PASS. 별도 읽기 전용 검토에서 보완 필수 회귀는 발견되지 않았다. 이 결과는 실제 웹 등록·푸시 수신 성공의 대체 증거가 아니다.

공식 참고: https://github.com/GoogleChrome/android-browser-helper/blob/main/demos/twa-notification-delegation/src/main/AndroidManifest.xml
