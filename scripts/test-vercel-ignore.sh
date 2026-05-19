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

# Case 3: code change (src/) → exit 1 (build)
run_case "code change → build" 1 '
  mkdir -p src && echo "x" > src/foo.ts && git add . && git commit -q -m "init"
  echo "y" > src/foo.ts && git add . && git commit -q -m "code change"
'

# Case 4: docs-only change → exit 0 (skip)
run_case "docs-only change → skip" 0 '
  mkdir -p docs && echo "x" > docs/a.md && git add . && git commit -q -m "init"
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
  echo "y" > pic.png && git add . && git commit -q -m "img"
'

# Case 11: mixed code + docs → exit 1 (build, code wins)
run_case "mixed code + docs → build" 1 '
  mkdir -p src docs && echo "x" > src/a.ts && echo "x" > docs/a.md && git add . && git commit -q -m "init"
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

# Summary
echo
echo "== Summary =="
echo "Total: $TOTAL, Pass: $PASS, Fail: $FAIL"

if [ "$FAIL" = "0" ]; then
  exit 0
else
  exit 1
fi
