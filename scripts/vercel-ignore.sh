#!/usr/bin/env bash
# Vercel ignoreCommand — 빌드 스킵 결정 스크립트.
# vercel.json 의 ignoreCommand 가 256자 제한을 넘어 별도 파일로 분리 (PR after #243).
#
# 종료 코드:
#   0 = 빌드 스킵
#   1 = 빌드 진행
#
# 트리거:
# 1) 커밋 메시지에 [skip ci], [skip vercel], [no deploy], WIP prefix 포함 → 스킵
# 2) 변경된 파일이 모두 빌드 무관 영역(docs/, scripts/, 이미지 등)이면 → 스킵
# 3) 그 외 → 빌드
#
# Fail-safe 원칙: 어떤 비정상 상황에서도 exit 0/1 만 반환 (non-binary exit = Vercel "Error").
# set -e 사용 안 함 — 명시적 fallback 으로 BASE-unreachable 등 케이스 대응.
# 회귀 차단: scripts/test-vercel-ignore.sh + P94 lint + 메모리 (#PR after 477).

# 1) 커밋 메시지 키워드 체크
if git log -1 --pretty=%B 2>/dev/null | grep -qiE '\[skip ci\]|\[skip vercel\]|\[no deploy\]|^WIP'; then
  echo "[ignore] commit message has skip keyword → skip build"
  exit 0
fi

# 2) 변경 파일 diff base — Vercel 멀티커밋 푸시 + 신규 PR 정확도.
# Preference order:
#   a) VERCEL_GIT_PREVIOUS_SHA (Vercel 이 직전 deploy 기준 비교용으로 제공)
#      ⚠️ abandoned/recreated PR 의 경우 shallow clone 에 없을 수 있음 → 도달 가능성 검증 후 사용
#   b) origin/main 머지 base (신규 PR — 전체 PR diff 평가)
#   c) HEAD^ (단일 커밋 fallback)
BASE=""

# is_commit_reachable <sha> — 로컬 (shallow) clone 에 commit object 있는지 확인. set -e 없이도 안전.
is_commit_reachable() {
  git rev-parse --verify --quiet "$1^{commit}" >/dev/null 2>&1
}

if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && is_commit_reachable "$VERCEL_GIT_PREVIOUS_SHA"; then
  BASE="$VERCEL_GIT_PREVIOUS_SHA"
elif git rev-parse origin/main >/dev/null 2>&1; then
  MB=$(git merge-base HEAD origin/main 2>/dev/null)
  if [ -n "$MB" ] && is_commit_reachable "$MB"; then
    BASE="$MB"
  elif HEAD_PARENT=$(git rev-parse HEAD^ 2>/dev/null) && is_commit_reachable "$HEAD_PARENT"; then
    BASE="$HEAD_PARENT"
  fi
elif HEAD_PARENT=$(git rev-parse HEAD^ 2>/dev/null) && is_commit_reachable "$HEAD_PARENT"; then
  BASE="$HEAD_PARENT"
fi

if [ -z "$BASE" ]; then
  echo "[ignore] no diff base resolvable → build (fail-safe)"
  exit 1
fi

# git diff 가 실패하면 (BASE 가 갑자기 unreachable 되는 등) build (fail-safe).
# command substitution + set -e 미사용 패턴이라 git diff 실패 시 CHANGED 가 빈 문자열로 떨어지고 아래 분기에서 build 진행.
CHANGED=$(git diff --name-only "$BASE" HEAD 2>/dev/null || true)
GIT_DIFF_EXIT=$?

if [ "$GIT_DIFF_EXIT" -ne 0 ] || [ -z "$CHANGED" ]; then
  echo "[ignore] git diff failed or empty (BASE=$BASE) → build (fail-safe)"
  exit 1
fi

# 빌드 무관 패턴 (모든 변경이 이 패턴이면 스킵)
IGNORE_RE='^(docs/|\.github/|\.agent/|\.claude/|\.idx/|\.vscode/|tests/|scripts/|reports/|outputs/|food_data/|preview/)'
IGNORE_RE="${IGNORE_RE}|^(deploys\.txt|error\.log|\.gitignore|\.gitattributes|\.editorconfig|\.claudeignore)$"
IGNORE_RE="${IGNORE_RE}|.+\.md$"
IGNORE_RE="${IGNORE_RE}|.+\.(png|jpe?g|webp|svg|gif|ico|bmp|tiff?)$"
IGNORE_RE="${IGNORE_RE}|.+\.(txt|log)$"

if echo "$CHANGED" | grep -qvE "$IGNORE_RE"; then
  echo "[ignore] code changes detected → build"
  exit 1
else
  echo "[ignore] all changes ignorable → skip build"
  exit 0
fi
