#!/usr/bin/env bash
# Unit test for scripts/vercel-ignore.sh
# 회귀 가드: PR after #477 — VERCEL_GIT_PREVIOUS_SHA unreachable 케이스 (set -e + shallow clone)
# 실행: bash scripts/test-vercel-ignore.sh

set -u
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TARGET="$SCRIPT_DIR/vercel-ignore.sh"
PASS=0
FAIL=0
TOTAL=0

# 각 case 마다 임시 git repo 생성 → vercel-ignore.sh 실행 → exit code 확인
run_case() {
  local name="$1"
  local expected_exit="$2"
  local setup_fn="$3"
  TOTAL=$((TOTAL+1))

  local tmp
  tmp=$(mktemp -d)
  (
    cd "$tmp"
    git init -q -b main
    git config user.email t@t
    git config user.name t
    # setup_fn 정의된 환경 + 커밋 생성
    eval "$setup_fn"
    # vercel-ignore.sh 실행
    bash "$TARGET" >/tmp/vci-out 2>&1
    actual_exit=$?
    if [ "$actual_exit" = "$expected_exit" ]; then
      echo "  PASS: $name (exit=$actual_exit)"
      exit 0
    else
      echo "  FAIL: $name (expected=$expected_exit, actual=$actual_exit)"
      echo "    output: $(cat /tmp/vci-out)"
      exit 1
    fi
  )
  local rc=$?
  if [ "$rc" = "0" ]; then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
  fi
  rm -rf "$tmp"
}

echo "== vercel-ignore.sh unit tests =="

# Case 1: skip keyword in commit msg → exit 0
run_case "skip keyword [skip ci]" 0 '
  echo "x" > a.txt && git add . && git commit -q -m "fix [skip ci]"
'

# Case 2: WIP prefix → exit 0
run_case "WIP prefix" 0 '
  echo "x" > a.txt && git add . && git commit -q -m "WIP: refactor"
'

# NOTE (#1125): HEAD^ fallback 제거 후로는 base 를 못 구하면 무조건 build (fail-safe) 다.
# 따라서 "skip 이 나와야 하는" 케이스는 반드시 base 를 하나 쥐어줘야 한다 (origin/main 또는 PREV).
# base 없는 케이스가 build 로 통과하면 IGNORE_RE 로직이 아니라 fail-safe 를 테스트하는 셈이라
# 가드가 조용히 죽는다 → 아래 케이스들은 init 직후 origin/main 을 심어준다.

# Case 3: code change (src/) → exit 1 (build)
run_case "code change → build" 1 '
  mkdir -p src && echo "x" > src/foo.ts && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > src/foo.ts && git add . && git commit -q -m "code change"
'

# Case 4: docs-only change → exit 0 (skip)
run_case "docs-only change → skip" 0 '
  mkdir -p docs && echo "x" > docs/a.md && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > docs/a.md && git add . && git commit -q -m "docs update"
'

# Case 5: VERCEL_GIT_PREVIOUS_SHA points to UNREACHABLE commit → exit 1 (build, fail-safe)
# 핵심 회귀 가드 — abandoned PR 또는 recreated branch 시나리오
run_case "VERCEL_GIT_PREVIOUS_SHA unreachable → build" 1 '
  echo "x" > a.txt && git add . && git commit -q -m "init"
  export VERCEL_GIT_PREVIOUS_SHA="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
'

# Case 6: VERCEL_GIT_PREVIOUS_SHA valid + code change → exit 1 (build)
run_case "VERCEL_GIT_PREVIOUS_SHA valid + code → build" 1 '
  mkdir -p src && echo "x" > src/foo.ts && git add . && git commit -q -m "init"
  PREV=$(git rev-parse HEAD)
  echo "y" > src/foo.ts && git add . && git commit -q -m "change"
  export VERCEL_GIT_PREVIOUS_SHA="$PREV"
'

# Case 7: VERCEL_GIT_PREVIOUS_SHA valid + docs-only → exit 0 (skip)
run_case "VERCEL_GIT_PREVIOUS_SHA valid + docs → skip" 0 '
  mkdir -p docs && echo "x" > docs/a.md && git add . && git commit -q -m "init"
  PREV=$(git rev-parse HEAD)
  echo "y" > docs/a.md && git add . && git commit -q -m "docs"
  export VERCEL_GIT_PREVIOUS_SHA="$PREV"
'

# Case 8: empty diff (HEAD == BASE) → exit 1 (fail-safe)
run_case "empty diff → build (fail-safe)" 1 '
  echo "x" > a.txt && git add . && git commit -q -m "init"
  PREV=$(git rev-parse HEAD)
  export VERCEL_GIT_PREVIOUS_SHA="$PREV"
'

# Case 9: no parent (initial commit, no origin) → exit 1 (build, fail-safe)
run_case "no parent, no origin → build (fail-safe)" 1 '
  echo "x" > a.txt && git add . && git commit -q -m "init"
'

# Case 10: image-only change → exit 0 (skip)
run_case "image-only change → skip" 0 '
  echo "x" > a.txt && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > pic.png && git add . && git commit -q -m "img"
'

# Case 11: mixed code + docs → exit 1 (build, code wins)
run_case "mixed code + docs → build" 1 '
  mkdir -p src docs && echo "x" > src/a.ts && echo "x" > docs/a.md && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > src/a.ts && echo "y" > docs/a.md && git add . && git commit -q -m "mixed"
'

# Case 12: VERCEL_GIT_PREVIOUS_SHA unreachable + origin/main valid → fallback to merge-base → 정상 동작
run_case "VERCEL_GIT_PREVIOUS_SHA unreachable + origin/main valid → fallback" 1 '
  mkdir -p src && echo "x" > src/a.ts && git add . && git commit -q -m "init"
  git remote add origin "$PWD"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > src/a.ts && git add . && git commit -q -m "code"
  export VERCEL_GIT_PREVIOUS_SHA="deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
'

# Case 13: public/ 자산(이미지)-only change → exit 1 (build) — #954/#955 로고 회귀 가드.
# public/ 밑 자산은 배포돼야 prod 반영 → 이미지여도 빌드해야 함 (Case 10 루트 png 스킵과 대비).
run_case "public/ image-only change → build" 1 '
  mkdir -p public/images && echo "x" > public/images/logo.png && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > public/images/logo.png && git add . && git commit -q -m "logo update"
'

# Case 14: public/ 매니페스트/favicon 변경 → exit 1 (build)
run_case "public/ manifest change → build" 1 '
  mkdir -p public && echo "x" > public/favicon.png && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  printf "%s" "{}" > public/manifest.webmanifest && git add . && git commit -q -m "manifest"
'

# Case 15: public/ 변경 + 루트 잡png 섞임 → exit 1 (public 가 빌드 트리거, 루트 png 스킵에도 우선)
run_case "public/ asset + root png → build" 1 '
  mkdir -p public/icons && echo "x" > public/icons/icon.png && git add . && git commit -q -m "init"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > public/icons/icon.png && echo "z" > screenshot.png && git add . && git commit -q -m "mixed"
'

# Case 16: 멀티커밋 푸시 + origin/main unreachable + 마지막 커밋만 ignorable → exit 1 (build)
# 핵심 회귀 가드 — PR #1125 사고. Vercel shallow clone 에는 origin/main 이 없어서
# merge-base 경로가 불발하고 HEAD^ 로 떨어졌다. 그 결과 PR 전체(api/·src/ 35파일)가 아니라
# 마지막 tests/ 커밋 하나만 보고 빌드를 통째로 스킵 → 프리뷰 URL 소실 → sandbox 결제 e2e 차단.
# HEAD^ 는 "이번 푸시의 새 커밋 전체"를 대표하지 못하므로 스킵 근거가 될 수 없다.
run_case "multi-commit + origin/main unreachable + last commit ignorable → build" 1 '
  mkdir -p src tests && echo "x" > src/a.ts && git add . && git commit -q -m "init"
  echo "y" > src/a.ts && git add . && git commit -q -m "feat: code change"
  mkdir -p tests && echo "t" > tests/a.test.ts && git add . && git commit -q -m "test: add coverage"
'

# Case 17: 멀티커밋 + origin/main reachable + 마지막 커밋만 ignorable → exit 1 (build)
# merge-base 경로가 살아있으면 PR 전체 diff(code 포함)를 보므로 당연히 build.
run_case "multi-commit + origin/main reachable + last commit ignorable → build" 1 '
  mkdir -p src && echo "x" > src/a.ts && git add . && git commit -q -m "init"
  git remote add origin "$PWD"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > src/a.ts && git add . && git commit -q -m "feat: code change"
  mkdir -p tests && echo "t" > tests/a.test.ts && git add . && git commit -q -m "test: add coverage"
'

# Case 18: 과잉수정 방지 — PR 전체가 ignorable 이면 여전히 skip 해야 한다 (비용).
# 목표는 "항상 빌드" 가 아니라 "PR 전체 diff 로 판단".
run_case "multi-commit docs-only PR + origin/main reachable → skip" 0 '
  mkdir -p docs && echo "x" > docs/a.md && git add . && git commit -q -m "init"
  git remote add origin "$PWD"
  git update-ref refs/remotes/origin/main HEAD
  echo "y" > docs/a.md && git add . && git commit -q -m "docs: update"
  echo "z" > docs/b.md && git add . && git commit -q -m "docs: more"
'

# Summary
echo
echo "== Summary =="
echo "Total: $TOTAL, Pass: $PASS, Fail: $FAIL"

if [ "$FAIL" = "0" ]; then
  exit 0
else
  exit 1
fi
