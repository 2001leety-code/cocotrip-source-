# 블로그·가이드 대표 원문 오답노트 — 2026-08-23

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
