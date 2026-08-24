# 플래너 오프라인 하네스 — Node 20 호환 오답노트 (2026-08-24)

## 무엇이 실패했나

- 로컬 플래너 하네스가 `node:module`의 `registerHooks`를 가져왔다.
- 로컬 Node 22.15에서는 동작하지만, 필수 GitHub `unit` 검사는 Node 20.20.2를 쓴다.
- 새 저장 전 품질 테스트가 이 오래된 불일치를 처음으로 CI에서 실제 실행했다.

## 근본 원인

로컬 성공은 개발 PC의 실행 환경만 증명했다. 저장소가 정한 CI 실행 환경까지 증명하지 못했다. 모든 저장소 검사가 Node 20을 기준으로 하는데 하네스만 Node 22.15 이상 전용 기능에 의존했다.

## 재발 방지

- Node 20.6부터 지원하는 `module.register`를 사용하고, Firestore·교통·Axios 경계만 로컬 파일로 돌린다.
- 바뀌는 fixture 상태는 loader thread가 아니라 실제 앱이 도는 영역에 둔다.
- 출시 전에는 CI와 정확히 같은 실행 환경으로 하네스를 돌린다.

```bash
npx -y node@20.20.2 scripts/plan-local/run.mjs sample
npx -y node@20.20.2 node_modules/vitest/vitest.mjs run tests/unit/plan-local-prewrite-quality-gate.test.ts
```

- 특정 Node 버전 기능을 쓰면 개발 PC 기본 Node의 통과만으로 완료 처리하지 않는다.
