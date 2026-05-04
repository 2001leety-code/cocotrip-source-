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

set -e

# 1) 커밋 메시지 키워드 체크
if git log -1 --pretty=%B | grep -qiE '\[skip ci\]|\[skip vercel\]|\[no deploy\]|^WIP'; then
  echo "[ignore] commit message has skip keyword → skip build"
  exit 0
fi

# 2) 변경 파일 diff base — Vercel 멀티커밋 푸시 + 신규 PR 정확도.
# Preference order:
#   a) VERCEL_GIT_PREVIOUS_SHA (Vercel 이 직전 deploy 기준 비교용으로 제공)
#   b) origin/main 머지 base (신규 PR — 전체 PR diff 평가)
#   c) HEAD^ (단일 커밋 fallback)
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ]; then
  BASE="$VERCEL_GIT_PREVIOUS_SHA"
elif git rev-parse origin/main >/dev/null 2>&1; then
  BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD^)
else
  BASE=$(git rev-parse HEAD^ 2>/dev/null || echo "")
fi

if [ -z "$BASE" ]; then
  echo "[ignore] no diff base resolvable → build (fail-safe)"
  exit 1
fi

CHANGED=$(git diff --name-only "$BASE" HEAD 2>/dev/null)

# 빈 diff → 빌드 (fail-safe). HEAD == BASE 이거나 mode-only change 등.
if [ -z "$CHANGED" ]; then
  echo "[ignore] empty diff vs base → build (fail-safe)"
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
