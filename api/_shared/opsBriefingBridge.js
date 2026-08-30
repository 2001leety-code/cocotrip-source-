/**
 * ops.v1 -> 기존 모닝 브리핑 읽기 전용 브리지.
 *
 * 입력은 호출자가 주입한 객체 또는 JSON 문자열만 받는다. Vercel 런타임에서
 * 로컬 Brain 경로나 Firestore를 읽고 쓰지 않는다. 변경, 실패/경보, 아직 승인
 * 전인 finding만 꺼내며 성공/무변경 실행은 기존 브리핑을 그대로 반환한다.
 */

const OPS_SCHEMA_VERSION = 'ops.v1';
const MAX_JSON_CHARS = 1024 * 1024;
const MAX_TITLE_CHARS = 180;
const MAX_SUMMARY_CHARS = 500;

const RUN_STATUS = new Set([
  'queued', 'claimed', 'running', 'validating', 'awaiting_approval',
  'succeeded', 'partial', 'blocked', 'failed', 'skipped', 'stale',
]);
const SUMMARY_STATUS = new Set(['ok', 'warning', 'critical', 'unknown']);
const FAILURE_STATUS = new Set(['partial', 'blocked', 'failed', 'stale']);
const OPEN_APPROVAL_STATUS = new Set(['observed', 'proposed']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function cleanText(value, maxLength) {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function unixSecondsToMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

function errorMessage(error) {
  if (!isObject(error)) return '';
  const code = cleanText(error.code, 80);
  const message = cleanText(error.message, MAX_SUMMARY_CHARS);
  if (code && message) return `${code}: ${message}`;
  return message || code;
}

/**
 * ops.v1 객체/JSON을 브리핑에 필요한 최소 자료로 정규화한다.
 * 전체 JSON Schema 검증기는 Brain 생산단에 두고, 여기서는 소비 필드만 fail-closed 검증한다.
 */
export function normalizeOpsV1Input(input) {
  if (input == null || input === '') return { ok: true, empty: true };

  let value = input;
  if (typeof input === 'string') {
    if (input.length > MAX_JSON_CHARS) return { ok: false, reason: 'too-large' };
    try { value = JSON.parse(input); } catch { return { ok: false, reason: 'invalid-json' }; }
  }

  if (!isObject(value) || value.schema_version !== OPS_SCHEMA_VERSION) {
    return { ok: false, reason: 'invalid-schema' };
  }
  if (!isObject(value.job) || !isObject(value.run) || !isObject(value.summary)
    || !Array.isArray(value.sources) || !Array.isArray(value.findings)) {
    return { ok: false, reason: 'invalid-shape' };
  }

  const project = cleanText(value.project, 100);
  const jobKey = cleanText(value.job.key, 120);
  const jobTitle = cleanText(value.job.title, MAX_TITLE_CHARS);
  const runId = cleanText(value.run.id, 160);
  const runDedupeKey = cleanText(value.run.dedupe_key, 200);
  const runStatus = cleanText(value.run.status, 40);
  const summaryStatus = cleanText(value.summary.status, 40);
  const generatedAtMs = unixSecondsToMs(value.generated_at);

  if (!project || !jobKey || !jobTitle || !runId || !runDedupeKey || generatedAtMs == null
    || !RUN_STATUS.has(runStatus) || !SUMMARY_STATUS.has(summaryStatus)) {
    return { ok: false, reason: 'invalid-required-field' };
  }

  const changes = value.run.changed === true
    ? [{
        dedupeKey: runDedupeKey,
        title: jobTitle,
        project,
        createdAtMs: generatedAtMs,
      }]
    : [];

  const hasRunFailure = FAILURE_STATUS.has(runStatus);
  const hasSummaryAlert = summaryStatus === 'warning' || summaryStatus === 'critical';
  const failures = hasRunFailure || hasSummaryAlert
    ? [{
        dedupeKey: runDedupeKey,
        title: jobTitle,
        project,
        runStatus,
        severity: summaryStatus,
        summary: errorMessage(value.run.error),
        createdAtMs: generatedAtMs,
      }]
    : [];

  const approvals = [];
  const seenApprovalKeys = new Set();
  for (const finding of value.findings) {
    if (!isObject(finding) || finding.approval_required !== true || !OPEN_APPROVAL_STATUS.has(finding.status)) continue;
    const dedupeKey = cleanText(finding.dedupe_key, 200);
    const title = cleanText(finding.fact || finding.key, MAX_TITLE_CHARS);
    if (!dedupeKey || !title || seenApprovalKeys.has(dedupeKey)) continue;
    seenApprovalKeys.add(dedupeKey);
    const lastSeenAtMs = unixSecondsToMs(finding.last_seen_at);
    approvals.push({
      status: 'pending',
      type: 'ops',
      title,
      summary: cleanText(finding.proposed_action || finding.current, MAX_SUMMARY_CHARS),
      link: '',
      dedupeKey,
      createdAtMs: lastSeenAtMs == null ? generatedAtMs : lastSeenAtMs,
    });
  }

  return {
    ok: true,
    empty: false,
    schemaVersion: OPS_SCHEMA_VERSION,
    project,
    jobKey,
    runId,
    changes,
    failures,
    approvals,
  };
}

const titleKey = (value) => cleanText(value, MAX_TITLE_CHARS).toLocaleLowerCase('en-US');

function mergeApprovalSummary(base, approvals, existingDecisionDocs) {
  const docs = Array.isArray(existingDecisionDocs) ? existingDecisionDocs : [];
  const pendingDocs = docs.filter((doc) => doc && doc.status === 'pending');
  const existingKeys = new Set(pendingDocs.map((doc) => cleanText(doc.dedupeKey, 200)).filter(Boolean));
  const existingTitles = new Set(pendingDocs.map((doc) => titleKey(doc.title)).filter(Boolean));
  const accepted = [];

  for (const item of approvals) {
    const key = cleanText(item.dedupeKey, 200);
    const title = titleKey(item.title);
    if ((key && existingKeys.has(key)) || (title && existingTitles.has(title))) continue;
    if (key) existingKeys.add(key);
    if (title) existingTitles.add(title);
    accepted.push(item);
  }
  if (accepted.length === 0) return { decisions: base, accepted };

  const baseTop = Array.isArray(base && base.top) ? base.top : [];
  const candidates = pendingDocs.length > 0
    ? pendingDocs.map((doc) => ({
        title: cleanText(doc.title, MAX_TITLE_CHARS),
        type: cleanText(doc.type, 80) || 'general',
        createdAtMs: Number(doc.createdAtMs) || 0,
      }))
    : baseTop.map((item) => ({
        title: cleanText(item && item.title, MAX_TITLE_CHARS),
        type: cleanText(item && item.type, 80) || 'general',
        createdAtMs: 0,
      }));

  candidates.push(...accepted.map((item) => ({
    title: item.title,
    type: item.type,
    createdAtMs: item.createdAtMs,
  })));
  candidates.sort((a, b) => b.createdAtMs - a.createdAtMs);

  const byType = { ...((base && base.byType) || {}) };
  byType.ops = (Number(byType.ops) || 0) + accepted.length;
  const queueTotal = Number(base && base.total) || 0;
  return {
    decisions: {
      ...(base || {}),
      total: queueTotal + accepted.length,
      byType,
      top: candidates.slice(0, 3).map(({ title, type }) => ({ title, type })),
      queueTotal,
      opsTotal: accepted.length,
    },
    accepted,
  };
}

/**
 * 기존 `{ agg, decisions }` 브리핑 구조에 ops.v1의 조치 필요 자료만 합친다.
 * 입력 없음/무변경 성공/유효하지 않은 입력은 원본 객체 참조까지 그대로 돌려준다.
 */
export function mergeOpsV1IntoBriefing(briefing, input, { existingDecisionDocs = [] } = {}) {
  const normalized = normalizeOpsV1Input(input);
  if (!normalized.ok || normalized.empty) return briefing;

  const mergedApproval = mergeApprovalSummary(briefing && briefing.decisions, normalized.approvals, existingDecisionDocs);
  const hasOpsLines = normalized.changes.length > 0 || normalized.failures.length > 0;
  if (!hasOpsLines && mergedApproval.accepted.length === 0) return briefing;

  return {
    ...(briefing || {}),
    decisions: mergedApproval.decisions,
    ops: {
      schemaVersion: normalized.schemaVersion,
      project: normalized.project,
      jobKey: normalized.jobKey,
      runId: normalized.runId,
      changes: normalized.changes,
      failures: normalized.failures,
      approvals: mergedApproval.accepted,
    },
  };
}
