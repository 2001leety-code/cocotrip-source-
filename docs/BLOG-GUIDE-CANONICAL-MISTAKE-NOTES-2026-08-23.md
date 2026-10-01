# 블로그·가이드 대표 원문 오답노트 — 2026-08-23

- 2026-10-02: 승인된 기존 가이드 5개의 확인된 표기·교통 오류만 정정했다.
  망원은 6호선, 성수는 2호선이며 서울숲 수인분당선과 구분한다. 창덕궁,
  황남빵, 화천 산천어 축제의 명칭을 바로잡았다. 기존 slug·공개일·사진·출처는
  유지하고 본문과 목록의 수정일·낱말 수를 함께 맞춘다. 수정일을 고정한 테스트도
  실제 정정 날짜를 확인해야 한다. 이 정정을 전체 본문의 사실 검증 완료로 확대하지 않는다.
- 같은 PR의 전체 CI에서 플래너 미리보기 테스트의 100ms 스크롤 타이머가 검사 환경
  종료 뒤 실행됐다. 해당 테스트는 자동 진행 모의 타이머를 쓰고 종료 때 취소·복원한다.
  제품 코드를 건드리거나 CI 오류를 무시하지 않는다.
- 2026-09-07: 공개 목록과 본문 모듈이 모두 있는 글은 동적 본문을 읽는 잠시 동안도
  `index, follow`를 유지한다. 없는 slug·본문 실패만 `noindex, nofollow`로 닫는다.
  이 회귀는 최종 meta만 보면 놓치므로 MutationObserver로 로딩 전 구간을 전부 기록한다.
- Blogger 공개 피드에 글이 보인다는 사실은 품질 승인 근거가 아니다. 승인 장부나 Brain
  projection manifest가 없으면 감사만 하고 웹 파일을 쓰지 않는다.
- 외부·동기화 HTML을 `dangerouslySetInnerHTML`에 바로 넣지 않는다. import와 브라우저 렌더
  직전에 같은 allowlist로 검사하고, script·handler·위험 URL·form·SVG·style을 막는다.
- 새 글은 `https://cocotripkr.com/guide/<slug>`를 먼저 만든다. 배포 뒤 canonical, sitemap,
  Article JSON-LD, `cocotrip:content-sha256` meta가 같은 URL/hash인지 읽기 전용으로 확인한다.
- `legacy-blogger-guide-import-ledger.json`은 2026-08-22까지의 11건 이관 장부다. cutoff를
  늘려 장기 발행 경로로 재사용하지 않는다.
- 장기 경로는 Brain 최종 본문 → 품질 `pass`·92점 이상 → 운영 승인 → hash 검증 → 웹
  projection 순서다. 이후 Blogger에는 짧은 canonical teaser만 둘 수 있다.
- projection 적용은 기존 slug를 덮어쓰지 않는다. 같은 queueId/hash의 정확히 같은 문서만
  멱등 처리하고, guide JSON·목록·sitemap 중간 오류는 원래 바이트로 되돌린다.
