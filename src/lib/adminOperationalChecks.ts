export const operationalWorkflowNames = [
  "daily-health.yml",
  "scenario-matrix.yml",
  "weekly-design-ops-audit.yml",
  "weekly-i18n-audit.yml",
  "security-audit.yml",
  "vercel-cost-audit.yml",
] as const;

export type OperationalWorkflowName = (typeof operationalWorkflowNames)[number];

export type OperationalRun = {
  id: number;
  status: string;
  conclusion: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  url: string;
};

export type OperationalCheck = {
  key: string;
  workflow: OperationalWorkflowName;
  latestRun: OperationalRun | null;
  lastSuccessfulRun: OperationalRun | null;
  freshness: "fresh" | "stale" | "unknown";
  checkedAtMs: number | null;
  runHealth: "ok" | "failed" | "running" | "overdue" | "unknown";
  maxAgeMs: number;
  reason: string | null;
};

export type OperationalChecksData = {
  generatedAtMs: number;
  checks: OperationalCheck[];
  source: "github-actions";
  historyScope: "latest-100-scheduled-main-runs";
  readOnly: true;
};

type CopyReason =
  | "GITHUB_TIMEOUT"
  | "GITHUB_RATE_LIMIT"
  | "GITHUB_RESPONSE_INVALID"
  | "GITHUB_HTTP_ERROR"
  | "GITHUB_RESPONSE_TOO_LARGE"
  | "GITHUB_UNAVAILABLE";

const GH_STATUS = [
  "queued",
  "in_progress",
  "completed",
  "waiting",
  "requested",
  "pending",
] as const;
type GHStatus = (typeof GH_STATUS)[number];

const GH_CONCLUSION = [
  null,
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
  "startup_failure",
] as const;
type GHConclusion = (typeof GH_CONCLUSION)[number];

const RUN_URL_PREFIX =
  "https://github.com/2001leety-code/cocotrip-source-/actions/runs/";

const RUNNING_STATUSES = new Set<GHStatus>([
  "queued",
  "in_progress",
  "waiting",
  "requested",
  "pending",
]);

const ALLOWED_REASONS = new Set<CopyReason>([
  "GITHUB_TIMEOUT",
  "GITHUB_RATE_LIMIT",
  "GITHUB_RESPONSE_INVALID",
  "GITHUB_HTTP_ERROR",
  "GITHUB_RESPONSE_TOO_LARGE",
  "GITHUB_UNAVAILABLE",
]);

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FUTURE_ALLOWANCE_MS = 60 * 1000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.keys(obj).length !== keys.length) return false;
  for (let i = 0; i < keys.length; i++) {
    if (!(keys[i] in obj)) return false;
  }
  return true;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNotFarFuture(ms: number, now: number): boolean {
  return ms <= now + FUTURE_ALLOWANCE_MS;
}

function isSafeEpochMs(value: unknown, now: number): value is number {
  return isPositiveSafeInteger(value) && isNotFarFuture(value, now);
}

function isGHStatus(value: unknown): value is GHStatus {
  return (
    typeof value === "string" &&
    (GH_STATUS as readonly string[]).indexOf(value) !== -1
  );
}

function isGHConclusion(value: unknown): value is GHConclusion {
  return value === null || (typeof value === "string" && (GH_CONCLUSION as readonly (string | null)[]).indexOf(value as string) !== -1);
}

function isRun(value: unknown, now: number): value is OperationalRun {
  if (!isObject(value)) return false;
  if (
    !hasExactKeys(value, [
      "id",
      "status",
      "conclusion",
      "createdAtMs",
      "updatedAtMs",
      "url",
    ])
  ) {
    return false;
  }

  if (!isPositiveSafeInteger(value.id)) return false;
  if (!isGHStatus(value.status)) return false;
  if (!isGHConclusion(value.conclusion)) return false;
  if (!isSafeEpochMs(value.createdAtMs, now)) return false;
  if (!isSafeEpochMs(value.updatedAtMs, now)) return false;
  if (value.updatedAtMs < value.createdAtMs) return false;
  if (typeof value.url !== "string") return false;
  if (value.url !== `${RUN_URL_PREFIX}${value.id}`) return false;

  if (value.status === "completed") {
    if (value.conclusion === null) return false;
  } else if (value.conclusion !== null) {
    return false;
  }

  return true;
}

function isOperationalCheck(value: unknown, now: number): value is OperationalCheck {
  if (!isObject(value)) return false;
  if (
    !hasExactKeys(value, [
      "key",
      "workflow",
      "latestRun",
      "lastSuccessfulRun",
      "freshness",
      "checkedAtMs",
      "runHealth",
      "maxAgeMs",
      "reason",
    ])
  ) {
    return false;
  }

  if (typeof value.key !== "string" || value.key.length === 0) return false;
  const isAllowedWorkflow =
    operationalWorkflowNames.indexOf(
      value.workflow as OperationalWorkflowName
    ) !== -1;
  if (!isAllowedWorkflow) return false;
  const workflow = value.workflow as OperationalWorkflowName;

  if (workflow.slice(0, -4) !== value.key) return false;

  if (!isPositiveSafeInteger(value.maxAgeMs)) return false;
  if (value.maxAgeMs > MAX_AGE_MS) return false;

  if (!isPositiveSafeInteger(value.checkedAtMs)) {
    if (value.checkedAtMs !== null) return false;
    if (value.freshness !== "unknown") return false;
  } else {
    if (!isSafeEpochMs(value.checkedAtMs, now)) return false;
    if (value.freshness === "unknown") return false;
  }

  if (
    typeof value.freshness !== "string" ||
    (value.freshness !== "fresh" &&
      value.freshness !== "stale" &&
      value.freshness !== "unknown")
  ) {
    return false;
  }

  if (
    typeof value.runHealth !== "string" ||
    (value.runHealth !== "ok" &&
      value.runHealth !== "failed" &&
      value.runHealth !== "running" &&
      value.runHealth !== "overdue" &&
      value.runHealth !== "unknown")
  ) {
    return false;
  }

  if (value.freshness === "unknown" && value.runHealth !== "unknown") return false;

  if (!isRun(value.latestRun, now) && value.latestRun !== null) return false;
  if (!isRun(value.lastSuccessfulRun, now) && value.lastSuccessfulRun !== null) return false;

  if (value.lastSuccessfulRun !== null) {
    if (
      value.lastSuccessfulRun.status !== "completed" ||
      value.lastSuccessfulRun.conclusion !== "success"
    ) {
      return false;
    }
  }

  const latest = value.latestRun;

  if (value.runHealth === "unknown") {
    if (latest !== null) return false;
  } else {
    if (latest === null) return false;
  }

  // Cache freshness is independent of the age or outcome of a scheduled run.
  if (value.runHealth === "ok") {
    if (
      latest === null ||
      latest.status !== "completed" ||
      latest.conclusion !== "success"
    ) {
      return false;
    }
  }

  if (value.runHealth === "running") {
    if (latest === null || !RUNNING_STATUSES.has(latest.status as GHStatus)) return false;
  }

  if (value.runHealth === "failed") {
    if (
      latest === null ||
      (latest.status !== "completed" || latest.conclusion === "success")
    ) {
      return false;
    }
  }


  if (value.reason !== null) {
    if (typeof value.reason !== "string") return false;
    if (!ALLOWED_REASONS.has(value.reason as CopyReason)) return false;
  }

  return true;
}

export function isOperationalChecksData(
  value: unknown
): value is OperationalChecksData {
  if (!isObject(value)) return false;
  if (
    !hasExactKeys(value, [
      "generatedAtMs",
      "checks",
      "source",
      "historyScope",
      "readOnly",
    ])
  ) {
    return false;
  }

  const now = Date.now();

  if (value.source !== "github-actions") return false;
  if (value.historyScope !== "latest-100-scheduled-main-runs") return false;
  if (value.readOnly !== true) return false;
  if (!isSafeEpochMs(value.generatedAtMs, now)) return false;

  if (!Array.isArray(value.checks)) return false;
  if (value.checks.length !== operationalWorkflowNames.length) return false;

  const seen = new Set<string>();
  const seenWorkflow = new Set<OperationalWorkflowName>();

  for (let i = 0; i < value.checks.length; i++) {
    const check = value.checks[i];
    if (!isOperationalCheck(check, now)) return false;
    seen.add(check.key);
    seenWorkflow.add(check.workflow as OperationalWorkflowName);
  }

  if (seen.size !== operationalWorkflowNames.length) return false;

  for (let i = 0; i < operationalWorkflowNames.length; i++) {
    const expected = operationalWorkflowNames[i];
    if (!seenWorkflow.has(expected)) return false;
    if (!seen.has(expected.slice(0, -4))) return false;
  }

  return true;
}

export const adminOperationalChecksCopy = {
  ko: {
    locale: "ko",
    title: "정기 점검",
    summary: "정기검사의 최근 결과",
    refresh: "새로고침",
    loading: "불러오는 중",
    failed: "실패",
    unknown: "알 수 없음",
    stale: "새 조회에 실패해 이전 결과를 표시합니다.",
    updated: "가져온 시각",
    latest: "최신 실행",
    lastSuccess: "최근 성공",
    noSuccess: "조회 범위 내 성공 없음",
    openRun: "실행 결과 열기",
    scope: "main 브랜치의 최근 정기 실행 100건 범위입니다. 수동·PR 검사는 제외합니다.",
    costCaveat: "배포비용 점검은 실제 과금 영수증이 아닙니다.",
    ageCaveat:
      "지연 표시는 기본 건강검사 4일, 주간검사 9일 기준입니다. 실제 검사 일정을 바꾸는 설정은 아닙니다.",
    notificationCaveat: "이 화면 보기만으로 휴대폰 알림이 켜지지 않습니다.",
    synthetic: "합성 시험 화면이며 실제 실행 결과가 아닙니다.",
    states: {
      ok: "통과",
      failed: "확인 필요",
      running: "진행중",
      overdue: "실행 지연",
      unknown: "미확인",
    },
    workflowLabels: {
      "daily-health.yml": "기본 건강검사",
      "scenario-matrix.yml": "여행 일정 생성",
      "weekly-design-ops-audit.yml": "디자인 운영",
      "weekly-i18n-audit.yml": "번역·문구",
      "security-audit.yml": "보안",
      "vercel-cost-audit.yml": "배포비용",
    },
    expand: "점검 보기",
    collapse: "점검 접기",
  },
  en: {
    locale: "en",
    title: "Scheduled checks",
    summary: "Latest scheduled results",
    refresh: "Refresh",
    loading: "Loading",
    failed: "Failed",
    unknown: "Unknown",
    stale: "Latest fetch failed; showing previously fetched results.",
    updated: "Fetched at",
    latest: "Latest run",
    lastSuccess: "Last success",
    noSuccess: "No success in this window",
    openRun: "Open run",
    scope: "Latest 100 scheduled main-branch runs only; manual and PR tests excluded.",
    costCaveat: "Deployment-cost check is not an actual invoice.",
    ageCaveat:
      "Delay hints use 4 days for health and 9 days for weekly checks; schedules are unchanged.",
    notificationCaveat: "Viewing here does not enable phone notifications.",
    synthetic: "Synthetic preview; not a live result.",
    states: {
      ok: "Passed",
      failed: "Needs attention",
      running: "Running",
      overdue: "Overdue",
      unknown: "Unknown",
    },
    workflowLabels: {
      "daily-health.yml": "Health",
      "scenario-matrix.yml": "Planner scenarios",
      "weekly-design-ops-audit.yml": "Design",
      "weekly-i18n-audit.yml": "Translations",
      "security-audit.yml": "Security",
      "vercel-cost-audit.yml": "Deployment cost",
    },
    expand: "Show scheduled checks",
    collapse: "Hide scheduled checks",
  },
  ja: {
    locale: "ja",
    title: "定期チェック",
    summary: "定期チェックの最新結果",
    refresh: "再取得",
    loading: "読み込み中",
    failed: "失敗",
    unknown: "不明",
    stale: "最新取得に失敗したため、以前の結果を表示しています。",
    updated: "取得時刻",
    latest: "最新実行",
    lastSuccess: "直近成功",
    noSuccess: "この表示範囲に成功なし",
    openRun: "実行結果を開く",
    scope: "main ブランチの定期実行100件のみ（手動/PR除外）",
    costCaveat: "デプロイ費用チェックは実際の請求書ではありません。",
    ageCaveat:
      "遅延表示は健康チェック4日・週次9日の目安です。実行日程は変更しません。",
    notificationCaveat: "この画面の表示で電話通知は有効になりません。",
    synthetic: "サンプル表示で、実行結果そのものではありません。",
    states: {
      ok: "合格",
      failed: "要確認",
      running: "実行中",
      overdue: "遅延",
      unknown: "不明",
    },
    workflowLabels: {
      "daily-health.yml": "ヘルス",
      "scenario-matrix.yml": "旅行プラン生成",
      "weekly-design-ops-audit.yml": "デザイン",
      "weekly-i18n-audit.yml": "翻訳",
      "security-audit.yml": "セキュリティ",
      "vercel-cost-audit.yml": "デプロイ費用",
    },
    expand: "定期チェックを表示",
    collapse: "定期チェックを非表示",
  },
  zh: {
    locale: "zh",
    title: "定时检查",
    summary: "最近定时结果",
    refresh: "刷新",
    loading: "加载中",
    failed: "失败",
    unknown: "未知",
    stale: "最新获取失败，正在显示先前结果。",
    updated: "获取时间",
    latest: "最近执行",
    lastSuccess: "上次成功",
    noSuccess: "当前范围无成功",
    openRun: "查看执行",
    scope: "仅最近 100 条 main 分支定时运行（排除手动/PR）",
    costCaveat: "部署成本检查不等同于真实账单。",
    ageCaveat: "延迟提示以健康检查4天、每周检查9天为参考，不更改实际运行计划。",
    notificationCaveat: "该页面仅展示，不会开启手机推送。",
    synthetic: "演示视图，不代表实时结果。",
    states: {
      ok: "通过",
      failed: "需检查",
      running: "进行中",
      overdue: "超时",
      unknown: "未知",
    },
    workflowLabels: {
      "daily-health.yml": "健康",
      "scenario-matrix.yml": "旅行计划生成",
      "weekly-design-ops-audit.yml": "设计",
      "weekly-i18n-audit.yml": "翻译",
      "security-audit.yml": "安全",
      "vercel-cost-audit.yml": "部署成本",
    },
    expand: "展开检查",
    collapse: "收起检查",
  },
} as const;
