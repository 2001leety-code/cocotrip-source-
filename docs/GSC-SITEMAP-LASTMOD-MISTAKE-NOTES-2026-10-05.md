# GSC sitemap lastmod 오답노트 — 2026-10-05

- 증상: 2026-09-27 지역 콘텐츠 수정 뒤에도 `/region/paju`, `/region/ganghwa`, `/region/incheon`의 sitemap `lastmod`가 `2026-08-29`로 남아 있었다.
- 근본원인: 정적 sitemap과 일치 테스트가 기존 날짜를 고정해 두어 이후의 실제 콘텐츠 변경일을 반영하지 못했다.
- 수정 범위: 세 URL의 날짜를 `2026-09-27`로 바로잡고, 테스트가 이 세 URL과 나머지 15개 URL의 날짜를 각각 확인하도록 했다.
- 재발 방지: 실제로 의미 있는 콘텐츠 변경이 확인된 URL에만 해당 날짜를 반영한다. 빌드 날짜로 sitemap 전체를 일괄 갱신하지 않는다.
- 한계: `lastmod` 수정은 검색엔진의 색인이나 재방문을 보장하지 않는다.
- 별도 CI 함정: `owner-controller-preflight`의 fixture `checkedAt: 2026-09-01`은 실행일 기준 30일 뒤 만료될 수 있어 테스트에 기준일을 명시했다. fail-closed 검증 로직과 운영 설정은 변경하지 않았다.
