/**
 * 플랜 스모크 신선도 감시견 (2026-08-07, #1216 후속).
 *
 * 🔴 왜 필요한가 — "스킵이 초록으로 보이는" 병.
 *   월요일에만 도는 플랜→번역→PDF 스모크는 월요일 실행이 통째로 유실되면(8/3 실측:
 *   cron 교체 머지가 00:00Z 틱의 지연 처리와 겹침) 0회가 되는데, 수·금 실행은 그 스텝을
 *   skip(초록)으로 지나간다. 스킵 자체는 정상이라 "스텝이 빨간가" 로는 못 잡는다 —
 *   "마지막 시도가 언제였나" 를 봐야 한다.
 *
 * 무엇을 하나: daily-health 워크플로 실행 이력(GitHub API)에서 플랜 스모크 스텝이
 *   skip 이 아니었던(=시도된) 가장 최근 실행을 찾아, MAX_AGE_DAYS(월요일 주기 7일 +
 *   지연 여유 1일)를 넘겼으면 exit 1 로 잡을 빨갛게 죽인다.
 *
 * 성공/실패는 구분하지 않는다 — 시도됐다가 실패했다면 그 실행 자체가 이미 빨갛다.
 * 수동 실행(workflow_dispatch)의 시도도 신선도로 친다 — 목적은 "검사가 주기적으로
 * 실제 실행되는 것" 이지 "cron 이 발화하는 것" 이 아니다.
 */
import { pathToFileURL } from 'node:url';

/** daily-health.yml 의 스텝 이름과 글자까지 같아야 한다 — 파리티 테스트가 잠근다. */
export const SMOKE_STEP_NAME = 'E2E PROD smoke (Plan + Translation + PDF)';
/** 월요일 주기 7일 + 스케줄 지연 여유 1일. */
export const MAX_AGE_DAYS = 8;
/** 이만큼 최근 실행 안에 시도가 하나도 없으면 스텝 이름 불일치/스모크 사망으로 본다. */
export const LOOKBACK_RUNS = 20;

/**
 * 최신순 실행 목록에서 스모크가 시도된(skip 아님) 가장 최근 것을 찾는다.
 * @param {Array<{created_at: string, steps: Array<{name: string, conclusion: string|null}>}>} runs
 * @param {number} nowMs
 */
export function newestSmokeAttempt(runs, nowMs = Date.now()) {
  for (const r of runs) {
    const step = (r.steps || []).find((s) => s.name === SMOKE_STEP_NAME);
    if (step && step.conclusion && step.conclusion !== 'skipped') {
      return {
        createdAt: r.created_at,
        ageDays: (nowMs - Date.parse(r.created_at)) / 86_400_000,
        conclusion: step.conclusion,
      };
    }
  }
  return null;
}

async function gh(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    throw new Error('GITHUB_REPOSITORY 없음 — GitHub Actions 밖에서는 GITHUB_REPOSITORY=owner/repo 를 줘야 한다');
  }
  // status 필터 없이 나열 — 지금 도는 실행(자기 자신)의 스모크 시도도 봐야
  // 월요일 실행이 자기 자신을 신선하다고 판정할 수 있다(감시견 스텝은 스모크 뒤에 온다).
  const list = await gh(`/repos/${repo}/actions/workflows/daily-health.yml/runs?per_page=${LOOKBACK_RUNS}`);
  const runs = [];
  for (const r of (list.workflow_runs || []).slice(0, LOOKBACK_RUNS)) {
    const jobs = await gh(`/repos/${repo}/actions/runs/${r.id}/jobs?per_page=10`);
    runs.push({
      created_at: r.created_at,
      steps: (jobs.jobs || []).flatMap((j) => j.steps || []),
    });
  }
  const hit = newestSmokeAttempt(runs);
  if (!hit) {
    console.error(
      `[watchdog] 최근 ${runs.length}개 실행에 "${SMOKE_STEP_NAME}" 시도가 하나도 없다 — ` +
      '스텝 이름이 바뀌었거나 스모크가 죽어 있다.',
    );
    process.exit(1);
  }
  console.log(`[watchdog] 마지막 플랜 스모크 시도: ${hit.createdAt} (${hit.ageDays.toFixed(1)}일 전, ${hit.conclusion})`);
  if (hit.ageDays > MAX_AGE_DAYS) {
    console.error(
      `[watchdog] ${MAX_AGE_DAYS}일 초과 — 월요일 플랜 스모크가 조용히 유실되고 있다. ` +
      'cron·게이트(daily-health.yml weekday 스텝)를 확인하라.',
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[watchdog] 실행 실패:', e.message);
    process.exit(1);
  });
}
