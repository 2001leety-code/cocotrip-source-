# 기기 알림 조회 규칙: 승인 대기 수정안

## 결론과 승인 범위

알림 등록 상태 확인을 막는 운영 보안 규칙 결함을 확인했다. 아래는 제안서이며
`firestore.rules` 파일 수정, 규칙 저장·배포, 고객 문서 접근은 아직 하지 않았다.
운영자 승인이 필요한 범위는 **본인 계정의 알림 기기 문서 단건 조회 허용**이다.
다른 사용자 문서, 목록 조회, 삭제, 결제·예약 권한은 넓히지 않는다.
기존 생성·수정 규칙을 이번에 함께 개편하지도 않는다.

## 직접 확인한 원인

- 프로젝트: `planning-with-ai-a0801`.
- 운영 규칙: `projects/planning-with-ai-a0801/rulesets/e18731c8-3428-4109-acf8-be7cf41cfab0`.
- 운영 release 갱신 시각: `2026-08-30T16:20:15.945182Z`.
- 조회한 운영 규칙 SHA-256: `e4d41f9cde8a6bae339e29636c5513da31d50495f2aea40cfac81bd92e1744ec`.
- `push_subscriptions/{docId}`의 운영 블록과 로컬 블록이 공백 정규화 후 일치했다.
- 현행 `allow read, write, delete`가 `request.resource.data`를 함께 검사한다.
  읽기 요청에는 새 문서 값이 없어서 본인 GET도 `Property resource is undefined on object`로 거부됐다.
  [Firebase 요청 정의](https://firebase.google.com/docs/reference/rules/rules.firestore.Request#resource)에서도
  이 값은 쓰기 요청에만 존재한다고 명시한다.

## 최소 변경안

현재 `match /push_subscriptions/{docId}` 안에 다음 조건만 추가한다. 현행 허용문은 유지한다.

```text
allow get: if isSignedIn()
  && docId.size() > request.auth.uid.size() + 1
  && docId[0:request.auth.uid.size() + 1] == request.auth.uid + '_'
  && docId.split('_').size() == request.auth.uid.split('_').size() + 1
  && (resource == null
      || ('uid' in resource.data
          && resource.data.uid == request.auth.uid));
```

UID를 정규식으로 해석하지 않고 문자 그대로 비교한다. 기기 ID는 현행 코드의
`btoa(endpoint).slice(-32)`이며 밑줄을 포함하지 않으므로 밑줄 개수로 UID 접두어 혼동을 차단한다.
문서가 있으면 저장된 UID도 일치해야 한다. 없는 문서는 본인 이름 공간 안에서만 존재 여부를 확인한다.
기기 ID 생성 규칙을 바꾸는 후속 작업은 이 조건과 함께 다시 검증해야 한다.

## 실제 수행한 모의검사

[Firebase 공식 projects:test API](https://firebase.google.com/docs/reference/rules/rest/v1/projects/test)에
격리된 해당 블록과 `isSignedIn()`만 전달했다. 가상의 계정·문서만 사용했고 서비스 함수 호출 수는
40건 모두 0이었다. 고객 문서를 조회하거나 테스트 사용자를 만들지 않았다.

| 가상 요청 | 기존 규칙 | 제안 규칙 |
|---|---|---|
| 본인 문서 GET, 저장 UID 일치 | 거부 | 허용 |
| 본인 이름 공간의 없는 문서 GET | 거부 | 허용 |
| 타인 문서·타인 이름 공간의 없는 문서 | 거부 | 거부 |
| 비로그인, 저장 UID 불일치·누락 | 거부 | 거부 |
| 밑줄·정규식 문자가 들어간 정확한 본인 UID | 거부 | 허용 |
| UID 접두어 겹침·정규식 문자 악용 | 거부 | 거부 |
| 빈 기기 ID·너무 짧은 문서 ID | 거부 | 거부 |
| 목록 조회·삭제 | 거부 | 거부 |
| 기존 본인 생성·수정 | 허용 | 허용 |
| 타인 생성 | 거부 | 거부 |

기존 20/20, 제안 20/20이 각각 예상과 일치했다. 기존 규칙의 20건 통과는 기존의 잘못된 거부까지
재현했다는 뜻이지 운영 규칙이 정상이라는 뜻이 아니다. 격리 규칙 원문 SHA-256:

- 기존: `f88a41663cd36925d3cf1b54ee2bf22e0af7fe26ec18b6a59be2d7844badecfd`.
- 제안: `c6d9c48fa9ecdc0f40643573a65c5d705300129e381a6b61bf29fc721df4225d`.

## 승인 후 진행 순서

1. 운영 규칙과 원격 main의 변경 여부를 다시 확인한다. 전체 규칙과 로컬 차이가 있으면 덮어쓰지 않는다.
2. 최소 조건과 가상 회귀검사를 추가하고 전체 규칙 문법·동작, 웹 빌드·전체 회귀·린트를 검증한다.
3. 준비된 알림 UI와 하나의 브랜치/PR로 묶어 푸시·검사·머지한다. 보안 규칙은 Vercel 웹 배포와
   별도이므로 기존 정식 Firebase 배포 절차를 먼저 확인하고 승인 범위만 반영한다.
4. 배포된 규칙과 웹 버전의 일치를 다시 확인한다. 실패하면 운영 정상으로 보고하지 않는다.
5. 운영자가 연결·허용한 Android 기기로 설치·등록·수신 시험을 이어간다. 실제 알림 발송은
   지정된 운영자 기기에 대한 시험 범위 확인 후에만 한다.

전체 운영 규칙 파일을 사용한 제안 컴파일·통합검사, 규칙 배포, 실제 기기 등록은 아직 미수행이다.
예약·문의·수신 메일·API 비용 자동 발송 연결도 별도 후속 작업이며 이 규칙 수정만으로 완성되지 않는다.
