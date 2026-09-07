/**
 * Owner notification rules verification. No deployment or document APIs are used.
 * Offline: node scripts/verify-owner-notification-rules.mjs
 * Explicit simulation with an already installed/authenticated Firebase CLI:
 * node scripts/verify-owner-notification-rules.mjs --simulate \
 *   --firebase-tools-root="<npm global root>/firebase-tools" \
 *   --expected-ruleset="projects/planning-with-ai-a0801/rulesets/<current-id>"
 *
 * The simulation tests the full local file AND the current deployed source with
 * only the approved GET clause added in memory. Never deploy the local file as a
 * substitute: it may contain unrelated, previously unshipped rules.
 * All requests/resources are synthetic. No get()/exists() service calls are
 * used by the scoped rule. Output excludes credentials and source contents.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ID = 'planning-with-ai-a0801';
export const OWNER_GET_CLAUSE = `      allow get: if isSignedIn()
        && docId.size() > request.auth.uid.size() + 1
        && docId[0:request.auth.uid.size() + 1] == request.auth.uid + '_'
        && docId.split('_').size() == request.auth.uid.split('_').size() + 1
        && (resource == null || ('uid' in resource.data && resource.data.uid == request.auth.uid));`;
const OLD_ALLOW = `allow read, write, delete: if isSignedIn()
  && docId.matches(request.auth.uid + '_.*')
  && (!('uid' in request.resource.data) || request.resource.data.uid == request.auth.uid);`;
const normalize = (value) => value.replace(/\r\n/g, '\n');
const compact = (value) => value.replace(/\s+/g, ' ').trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function pushBlock(source) {
  const marker = 'match /push_subscriptions/{docId}';
  const start = source.indexOf(marker);
  assert.ok(start >= 0 && source.indexOf(marker, start + 1) === -1, 'push-block-must-be-unique');
  const open = source.indexOf('{', start + marker.length);
  let depth = 1;
  let end = open + 1;
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth += 1;
    if (source[end] === '}') depth -= 1;
    end += 1;
  }
  assert.equal(depth, 0, 'push-block-unclosed');
  return { start, end, text: source.slice(start, end) };
}

export function assertOwnerRuleContract(source) {
  const block = normalize(pushBlock(source).text);
  assert.equal(block.split(OWNER_GET_CLAUSE).length - 1, 1, 'approved-get-clause-must-match-exactly');
  const before = block.replace(OWNER_GET_CLAUSE, '');
  const body = before.slice(before.indexOf('{', before.indexOf('{docId}') + 7) + 1, -1);
  assert.equal(compact(body), compact(OLD_ALLOW), 'existing-push-permissions-must-stay-unchanged');
  return true;
}

export function removeOwnerGetClause(source) {
  assertOwnerRuleContract(source);
  // A Windows checkout can briefly mix CRLF with apply_patch's LF insertion.
  // Match only the approved clause; retain every unrelated byte as received.
  const clause = new RegExp(OWNER_GET_CLAUSE.split('\n')
    .map((line) => line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n') + '\\r?\\n');
  assert.ok(clause.test(source), 'approved-clause-newline-missing');
  return source.replace(clause, '');
}

export function addOwnerGetClause(source) {
  const block = pushBlock(source);
  assert.ok(!/allow\s+get\s*:/.test(block.text), 'deployed-get-already-present-or-unexpected');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const closingLine = source.lastIndexOf('\n', block.end - 2) + 1;
  const candidate = source.slice(0, closingLine)
    + OWNER_GET_CLAUSE.replace(/\n/g, eol) + eol + source.slice(closingLine);
  assertOwnerRuleContract(candidate);
  assert.equal(removeOwnerGetClause(candidate), source, 'candidate-must-only-add-approved-clause');
  return candidate;
}

/** Expected outputs come from the ownership contract, not a JS emulation of Rules. */
export function ownerRuleCases(baseline = false) {
  const stored = (uid) => ({ data: { uid } });
  const cases = [
    ['own-existing', 'dry-owner', 'dry-owner_DEVICE', stored('dry-owner'), 'get', 'ALLOW'],
    ['own-absent', 'dry-owner', 'dry-owner_DEVICE', null, 'get', 'ALLOW'],
    ['other-existing', 'dry-owner', 'different-owner_DEVICE', stored('different-owner'), 'get', 'DENY'],
    ['other-absent', 'dry-owner', 'different-owner_DEVICE', null, 'get', 'DENY'],
    ['signed-out', null, 'dry-owner_DEVICE', stored('dry-owner'), 'get', 'DENY'],
    ['stored-owner-mismatch', 'dry-owner', 'dry-owner_DEVICE', stored('different-owner'), 'get', 'DENY'],
    ['stored-owner-missing', 'dry-owner', 'dry-owner_DEVICE', { data: {} }, 'get', 'DENY'],
    ['stored-owner-null', 'dry-owner', 'dry-owner_DEVICE', stored(null), 'get', 'DENY'],
    ['stored-owner-number', 'dry-owner', 'dry-owner_DEVICE', stored(123), 'get', 'DENY'],
    ['custom-uid-underscore', 'dry_owner', 'dry_owner_DEVICE', stored('dry_owner'), 'get', 'ALLOW'],
    ['custom-uid-prefix-existing', 'dry', 'dry_owner_DEVICE', stored('dry_owner'), 'get', 'DENY'],
    ['custom-uid-prefix-absent', 'dry', 'dry_owner_DEVICE', null, 'get', 'DENY'],
    ['custom-uid-regex-literal', 'dry.owner+[]', 'dry.owner+[]_DEVICE', stored('dry.owner+[]'), 'get', 'ALLOW'],
    ['custom-uid-regex-crossover', 'dry.owner', 'dryXowner_DEVICE', stored('dry.owner'), 'get', 'DENY'],
    ['custom-uid-case-mismatch', 'Dry-owner', 'dry-owner_DEVICE', stored('Dry-owner'), 'get', 'DENY'],
    ['empty-suffix', 'dry-owner', 'dry-owner_', stored('dry-owner'), 'get', 'DENY'],
    ['short-doc', 'dry-owner', 'dry', stored('dry-owner'), 'get', 'DENY'],
    ['own-list', 'dry-owner', 'dry-owner_DEVICE', stored('dry-owner'), 'list', 'DENY'],
    ['other-list', 'dry-owner', 'different-owner_DEVICE', stored('different-owner'), 'list', 'DENY'],
    ['signed-out-list', null, 'dry-owner_DEVICE', stored('dry-owner'), 'list', 'DENY'],
    ['own-delete-preserved', 'dry-owner', 'dry-owner_DEVICE', stored('dry-owner'), 'delete', 'DENY'],
    ['other-delete-preserved', 'dry-owner', 'different-owner_DEVICE', stored('different-owner'), 'delete', 'DENY'],
    ['own-create-preserved', 'dry-owner', 'dry-owner_DEVICE', null, 'create', 'ALLOW', stored('dry-owner')],
    ['own-update-preserved', 'dry-owner', 'dry-owner_DEVICE', stored('dry-owner'), 'update', 'ALLOW', stored('dry-owner')],
    ['other-create-preserved', 'dry-owner', 'different-owner_DEVICE', null, 'create', 'DENY', stored('dry-owner')],
    ['uid-free-create-preserved', 'dry-owner', 'dry-owner_DEVICE', null, 'create', 'ALLOW', { data: {} }],
    ['signed-out-create-preserved', null, 'dry-owner_DEVICE', null, 'create', 'DENY', stored('dry-owner')],
    ['mismatched-write-uid-preserved', 'dry-owner', 'dry-owner_DEVICE', stored('dry-owner'), 'update', 'DENY', stored('different-owner')],
  ];
  return cases.map(([id, uid, docId, resource, method, expectation, newResource]) => {
    const request = {
      auth: uid ? { uid, token: {} } : null,
      method,
      path: '/databases/(default)/documents/push_subscriptions/' + docId,
      time: '2026-09-07T00:00:00Z',
    };
    if (newResource) request.resource = newResource;
    return {
      id,
      test: { expectation: baseline && method === 'get' ? 'DENY' : expectation,
        request, resource, pathEncoding: 'PLAIN', expressionReportLevel: 'VISITED' },
    };
  });
}

export async function runOwnerRulesSimulation({ cliRoot, expectedRuleset, source }) {
  assert.ok(cliRoot && expectedRuleset, 'explicit-cli-root-and-current-ruleset-required');
  const require = createRequire(import.meta.url);
  const moduleAt = (name) => require(resolve(cliRoot, 'lib', name));
  const { logger } = moduleAt('logger.js');
  logger.silent = true;
  const auth = moduleAt('auth.js');
  const { requireAuth } = moduleAt('requireAuth.js');
  const rules = moduleAt('gcp/rules.js');
  const { Client } = moduleAt('apiv2.js');
  const account = auth.getProjectDefaultAccount(workspace);
  assert.ok(account, 'existing-firebase-cli-login-required');
  const options = { project: PROJECT_ID, nonInteractive: true };
  auth.setActiveAccount(options, account);
  await requireAuth(options, true);
  const releases = await rules.listAllReleases(PROJECT_ID);
  const release = releases.find((item) => item.name === `projects/${PROJECT_ID}/releases/cloud.firestore`);
  assert.equal(release?.rulesetName, expectedRuleset, 'deployed-ruleset-changed-stop-and-review');
  const files = await rules.getRulesetContent(release.rulesetName);
  assert.equal(files.length, 1, 'unexpected-deployed-rules-file-count');
  assert.equal(files[0].name, 'firestore.rules', 'unexpected-deployed-rules-file-name');
  const deployedSource = files[0].content;
  const deployedIncludesApprovedGet = /allow\s+get\s*:/.test(pushBlock(deployedSource).text);
  const deployedBaseline = deployedIncludesApprovedGet ? removeOwnerGetClause(deployedSource) : deployedSource;
  const deployedCandidate = deployedIncludesApprovedGet ? deployedSource : addOwnerGetClause(deployedSource);
  const localBaseline = removeOwnerGetClause(source);
  const client = new Client({ urlPrefix: 'https://firebaserules.googleapis.com', apiVersion: 'v1' });
  const reports = [];
  for (const [label, content, baseline] of [
    ['deployed-baseline', deployedBaseline, true],
    ['deployed-candidate', deployedCandidate, false],
    ['local-baseline', localBaseline, true],
    ['local-candidate', source, false],
  ]) {
    const cases = ownerRuleCases(baseline);
    const response = await client.post(`/projects/${PROJECT_ID}:test`, {
      source: { files: [{ name: 'firestore.rules', content }] },
      testSuite: { testCases: cases.map((item) => item.test) },
    }, { skipLog: { body: true, resBody: true } });
    const issues = response.body.issues || [];
    const results = response.body.testResults || [];
    const serviceFunctionCalls = results.reduce((sum, result) => sum + (result.functionCalls || []).length, 0);
    const failures = results.flatMap((result, index) => result.state === 'SUCCESS' ? [] : [cases[index].id]);
    const report = {
      label, sourceSha256: sha256(content), httpStatus: response.status,
      cases: cases.length, results: results.length, failures, serviceFunctionCalls,
      issues: issues.map((issue) => ({ severity: issue.severity, line: issue.sourcePosition?.line })),
      caseResults: results.map((result, index) => ({
        id: cases[index].id, expected: cases[index].test.expectation, state: result.state,
      })),
    };
    console.log(JSON.stringify(report));
    assert.ok(issues.every((issue) => issue.severity !== 'ERROR'), 'rules-compile-error');
    assert.equal(results.length, cases.length, 'simulation-result-count-mismatch');
    assert.equal(failures.length, 0, 'simulation-expectation-failed');
    assert.equal(serviceFunctionCalls, 0, 'unexpected-service-function-call');
    reports.push(report);
  }
  return { mode: 'simulation-only', project: PROJECT_ID, rulesetName: release.rulesetName,
    deployedIncludesApprovedGet,
    deployedSha256: sha256(deployedSource), deployedCandidateSha256: sha256(deployedCandidate),
    localSha256: sha256(source), localMatchesDeployedCandidate: source === deployedCandidate,
    totalCases: reports.reduce((sum, report) => sum + report.cases, 0), serviceFunctionCalls: 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const source = readFileSync(resolve(workspace, 'firestore.rules'), 'utf8');
  assertOwnerRuleContract(source);
  if (!args.includes('--simulate')) {
    console.log(JSON.stringify({ mode: 'offline-source-contract-only', passed: true,
      note: 'Does not prove Firebase authorization behavior; use explicit --simulate for that.' }));
    return;
  }
  const option = (name) => (args.find((item) => item.startsWith(name + '=')) || '').slice(name.length + 1);
  console.log(JSON.stringify(await runOwnerRulesSimulation({
    cliRoot: option('--firebase-tools-root'), expectedRuleset: option('--expected-ruleset'), source,
  })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Firebase errors can contain source or authentication context; never dump them.
    console.error(JSON.stringify({ mode: 'owner-rules-verification', passed: false,
      note: 'Verification stopped. Check the preceding safe report, CLI login, and expected ruleset.' }));
    process.exitCode = 1;
  });
}
