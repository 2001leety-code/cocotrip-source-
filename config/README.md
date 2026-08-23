# Guide import approvals

`cocotripkr.com/guide/<slug>`가 가이드의 대표 원문이다. Blogger 공개 피드는 새 글 후보를
찾는 통로일 뿐이며, 공개됐다는 사실만으로 웹 가이드에 복사하지 않는다.

`legacy-blogger-guide-import-ledger.json`은 2026-08-22까지 이미 Blogger에 쌓인 미이관 11건과
중복 URL 통합 1건을 격리·정리하기 위한 이관 장부다. 날짜를 늘려 새 글 파이프라인으로 쓰지 않는다. 이후 글의
장기 정본은 Brain `content_queue`의 최종 본문·품질 검수·운영자 승인 provenance를 담은
projection manifest다.

현재 11건의 `migration-safety-hold`는 자동 이관 금지 표식이지, 사람이 각 본문을 승인했다는
뜻이 아니다. `approved`로 바꿀 때는 실제 검토자와 시각을 새로 기록해야 한다.

## 검토 순서

1. `npm run guide:legacy-audit`로 이관 후보와 현재 SHA-256 지문을 확인한다.
2. `legacy-blogger-guide-import-ledger.json`에 후보와 정확히 같은 `sourceUrl`, `slug`, `title`,
   `contentSha256`를 기록한다.
3. 판단을 아래 중 하나로 남긴다.
   - `approved`: `quality.verdict`가 `pass`이고 숫자 `quality.score`가 92 이상이어야 한다.
   - `hold`: 지금은 가져오지 않는다. `reason`이 필요하다.
   - `rejected`: 가져오지 않기로 확정한다. `reason`이 필요하다. 중복 URL 통합은 exact
     `redirectTo: https://cocotripkr.com/guide/<survivor>`도 기록하며 자기 자신은 거부한다.
4. `approved`/`rejected`는 실제 `reviewedBy`와 시간대가 든 ISO 8601 `reviewedAt`을 기록한다.
   자동 안전 격리인 `hold`는 사람 검토자로 위장하지 않고 `recordedBy`/`recordedAt`을 쓴다.
5. `npm run guide:legacy-check`를 통과시킨 뒤 `npm run guide:legacy-sync`를 실행한다.
6. `npm run build`와 관련 단위 테스트를 통과시킨 뒤 브랜치와 PR로 반영한다.

승인 뒤 Blogger의 제목·본문·날짜·라벨이 조금이라도 바뀌면 지문이 달라져 다시 막힌다.
동기화는 기존 로컬 글을 덮어쓰거나 삭제하지 않으며 Blogger 글도 수정하지 않는다.
cutoff 이후 Blogger 글은 먼저 공개하지 않는다. teaser의 단 하나뿐인 exact canonical 링크가
검증된 Brain 웹 가이드를 가리키고, 10~120단어·장문 구조 없음 조건을 만족할 때만 legacy 감사에서
정상으로 분류한다. Blogger가 긴 제목의 URL slug를 잘라도 canonical 링크로 대조하며, Blogger-first
전문이나 링크 없음·복수/다른 링크·제목/hash 드리프트는 계속 실패한다.

## Brain projection 계약 (장기 경로)

`npm run guide:brain-check -- --brain-manifest=<path>`는 Brain `content_queue`에서 넘긴 글
1편짜리 JSON 객체를 읽기 전용으로 검사한다. 통과한 같은 파일은
`npm run guide:brain-sync -- --brain-manifest=<path>`로만 웹 정본에 투영한다.

필수 필드:

- 숫자 `schemaVersion: 1`
- `^[A-Za-z0-9_-]{1,64}$`인 `queueId`, 결정적 영문 kebab-case `slug`, 정확한
  `canonicalUrl: https://cocotripkr.com/guide/<slug>`
- 최종 안전 `html` UTF-8 바이트의 소문자 SHA-256인 `contentSha256`
- 꺾쇠 없는 plain-text `title`, `description`, 승인 시각의 한국 날짜(`YYYY-MM-DD`)와 같은 `published`
- 최대 10개·각 60자 이하이며 대소문자 무시 중복 제거·정렬된 `labels`
- `review: { verdict: "pass", score: 92 이상 숫자 }`
- `approval: { approvedBy, approvedAt }` (`approvedBy`는 `discord:<숫자 uid>` 또는
  `telegram:<숫자 uid>`, `approvedAt`은 시간대 포함 ISO 8601)
- Brain SSOT와 정확히 같은 `qualityRulesVersion: "brain-content-quality-v1"`

slug 예시: `Seoul Rainy Day Guide 2026` → `seoul-rainy-day-guide-2026`. 100자를 넘으면
단어 중간을 남기지 않고 직전 `-` 경계에서 자른다.
HTML은 Node import 검사와 브라우저 렌더가 같은 allowlist를 쓰며, 정제 결과가 원문과 한 글자라도
다르면 projection을 거부한다. 통과한 `contentSha256`는 향후 글 JSON에 보존되고 Article
JSON-LD의 `urn:sha256:<hash>` 식별자와 `cocotrip:content-sha256` meta로 운영 URL에서 읽기
전용 확인할 수 있다.

적용 명령은 저장소 루트 배타 lock을 얻은 뒤 검증·slug/queueId/hash 충돌·현재 `_index.json`
상태·sitemap 중복을 모두 확인하고 guide JSON, 목록, sitemap을 임시 파일로 준비해 한 묶음으로 교체한다. 중간 오류는
원래 바이트로 되돌린다. 기존 slug는 같은 queueId·hash·전체 문서일 때만 멱등 처리하며 다른
내용을 덮어쓰지 않는다. Brain manifest 원본이 승인 감사 정본이다. 공개 상세 JSON에는 원문
queueId·승인자 UID·검토 세부를 복사하지 않고 멱등성 확인용 queueId SHA-256과 콘텐츠 hash만
남긴다. 공개 목록 `_index.json`에는 그 내부 연결값도 넣지 않는다.
