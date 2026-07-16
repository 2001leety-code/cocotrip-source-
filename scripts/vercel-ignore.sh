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
#      직전 배포 시점 프리뷰가 이미 존재하고, 그 이후 커밋을 "누적" 으로 보므로
#      멀티커밋 푸시에서도 앞 커밋을 놓치지 않는다.
#      ⚠️ abandoned/recreated PR 의 경우 shallow clone 에 없을 수 있음 → 도달 가능성 검증 후 사용 (#477)
#   b) main 머지 base (신규 PR — 전체 PR diff 평가)
#   c) base 를 못 구하면 build (fail-safe)
#
# ⚠️ HEAD^ fallback 은 의도적으로 제거됨 (#1125). HEAD^ 는 "이번 푸시로 들어온 새 커밋 전체"를
# 대표하지 못한다 — 멀티커밋 푸시면 마지막 커밋 하나만 보게 된다. 실제 사고:
# feat/payment-p0-capture-integrity 가 api/·src/·firestore.rules 35파일을 바꿨는데
# 마지막 커밋이 tests/ 하나뿐이라 IGNORE_RE 에 걸려 PR 전체 빌드가 스킵 → 프리뷰 URL 소실 →
# 운영자 sandbox 결제 e2e(머지 게이트) 차단. base 불명이면 스킵하지 말고 빌드해야 한다.
BASE=""
BASE_SRC=""

# is_commit_reachable <sha> — 로컬 (shallow) clone 에 commit object 있는지 확인. set -e 없이도 안전.
is_commit_reachable() {
  git rev-parse --verify --quiet "$1^{commit}" >/dev/null 2>&1
}

# resolve_main_ref — main 을 가리키는 사용 가능한 ref 를 stdout 으로 반환. 없으면 비어있음.
#
# 2026-07-15 Vercel 빌드 환경 실측 (#1125 진단 배포):
#   shallow=true / `git remote` = 빈 값 / refs/remotes/* = 없음
# → Vercel clone 에는 remote 자체가 없어서 origin/main 이 영영 안 잡히고, `git fetch origin` 은
#   exit 128 로 죽는다. 그래서 owner/slug 로 URL 을 직접 만들어 익명 fetch 한다 (public repo).
# repo 가 private 로 바뀌거나 GitHub 장애면 fetch 실패 → base 없음 → build (fail-safe).
resolve_main_ref() {
  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    echo "origin/main"
    return 0
  fi
  # stdout 은 ref 이름 전용 — 진단은 stderr 로 (Vercel 빌드 로그에 같이 남는다).
  if [ -n "$VERCEL_GIT_REPO_OWNER" ] && [ -n "$VERCEL_GIT_REPO_SLUG" ]; then
    # --depth=50: PR 분기점이 main 최근 50커밋 안에 있으면 merge-base 성립.
    # 그보다 오래된 브랜치면 merge-base 불발 → build (fail-safe) 로 떨어진다.
    if git fetch --quiet --depth=50 \
        "https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git" main >/dev/null 2>&1; then
      echo "FETCH_HEAD"
      return 0
    fi
    echo "[ignore] main fetch failed (repo private/GitHub 장애?) → base 불명" >&2
  else
    echo "[ignore] VERCEL_GIT_REPO_OWNER/SLUG unset → main ref 복원 불가" >&2
  fi
  return 1
}

if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && is_commit_reachable "$VERCEL_GIT_PREVIOUS_SHA"; then
  BASE="$VERCEL_GIT_PREVIOUS_SHA"
  BASE_SRC="VERCEL_GIT_PREVIOUS_SHA"
else
  MAIN_REF=$(resolve_main_ref)
  if [ -n "$MAIN_REF" ]; then
    MB=$(git merge-base HEAD "$MAIN_REF" 2>/dev/null)
    if [ -n "$MB" ] && is_commit_reachable "$MB"; then
      BASE="$MB"
      BASE_SRC="merge-base($MAIN_REF)"
    fi
  fi
fi

if [ -z "$BASE" ]; then
  echo "[ignore] no PR-wide diff base resolvable → build (fail-safe)"
  exit 1
fi

# 어느 base 로 판단했는지 항상 남긴다 — #1125 때 이 로그가 없어서 (a)/(c) 중 무엇을 탔는지
# 빌드 로그만으로 알 수 없었고 원인 추정에 시간이 갈렸다.
echo "[ignore] diff base=$BASE (via $BASE_SRC)"

# git diff 가 실패하면 (BASE 가 갑자기 unreachable 되는 등) build (fail-safe).
# command substitution + set -e 미사용 패턴이라 git diff 실패 시 CHANGED 가 빈 문자열로 떨어지고 아래 분기에서 build 진행.
# (P94: || true 는 의도된 fail-safe — BASE unreachable 시 non-binary exit 방지. GIT_DIFF_EXIT 분기가
#  사실상 -z "$CHANGED" 와 겹쳐도 그대로 둠. 버그헌트 '데드코드' 지적은 P94 규칙상 false positive.)
CHANGED=$(git diff --name-only "$BASE" HEAD 2>/dev/null || true)
GIT_DIFF_EXIT=$?

if [ "$GIT_DIFF_EXIT" -ne 0 ] || [ -z "$CHANGED" ]; then
  echo "[ignore] git diff failed or empty (BASE=$BASE) → build (fail-safe)"
  exit 1
fi

# public/ 정적 자산(로고·아이콘·favicon·매니페스트 등)은 빌드+배포돼야 prod 에 반영됨.
# 이미지(.png 등)여도 public/ 밑이면 스킵하면 안 됨 — 스킵하면 CDN 이 옛 자산을 계속 서빙해서
# 변경이 영영 prod 에 안 뜸. 회귀: #954/#955 (공식 로고·아이콘 교체)가 .png-only 라 아래
# IGNORE_RE 이미지 규칙에 걸려 4회 연속 빌드 스킵(CANCELED) → prod 미반영 → 이 가드 추가.
# (루트의 잡다한 스크린샷 png 는 여전히 스킵 — public/ 밑만 빌드.)
if echo "$CHANGED" | grep -qE '^public/'; then
  echo "[ignore] public/ asset changed → build (deploy needed)"
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
