import { describe, expect, it } from 'vitest';
import {
  adminOperationalChecksCopy,
  isOperationalChecksData,
  operationalWorkflowNames,
  type OperationalChecksData,
} from '@/lib/adminOperationalChecks';

const NOW = Date.now() - 60_000;
const maxAge = 4 * 24 * 60 * 60 * 1000;
const run = (id: number, status: 'completed' | 'in_progress' = 'completed', conclusion: string | null = 'success') => ({
  id,
  status,
  conclusion,
  createdAtMs: NOW - 120_000,
  updatedAtMs: NOW - 60_000,
  url: `https://github.com/2001leety-code/cocotrip-source-/actions/runs/${id}`,
});

export const operationalFixture: OperationalChecksData = {
  generatedAtMs: NOW,
  source: 'github-actions',
  historyScope: 'latest-100-scheduled-main-runs',
  readOnly: true,
  checks: operationalWorkflowNames.map((workflow, index) => ({
    key: workflow.slice(0, -4), workflow,
    latestRun: run(index + 1), lastSuccessfulRun: run(index + 1),
    freshness: 'fresh' as const, checkedAtMs: NOW, runHealth: 'ok' as const,
    maxAgeMs: maxAge, reason: null,
  })),
};

describe('admin operational-checks public contract', () => {
  it('accepts the six-workflow safe public shape and keeps all four preview dictionaries complete', () => {
    expect(isOperationalChecksData(operationalFixture)).toBe(true);
    for (const language of ['ko', 'en', 'ja', 'zh'] as const) {
      const copy = adminOperationalChecksCopy[language];
      expect(copy.expand).toBeTruthy(); expect(copy.collapse).toBeTruthy();
      for (const workflow of operationalWorkflowNames) expect(copy.workflowLabels[workflow]).toBeTruthy();
    }
  });

  it.each([
    ['source', { ...operationalFixture, source: 'github-actions-private' }],
    ['count', { ...operationalFixture, checks: operationalFixture.checks.slice(0, 5) }],
    ['key', { ...operationalFixture, checks: [{ ...operationalFixture.checks[0], key: 'mismatched' }, ...operationalFixture.checks.slice(1)] }],
    ['unknown timestamp', { ...operationalFixture, checks: [{ ...operationalFixture.checks[0], freshness: 'unknown', checkedAtMs: NOW }, ...operationalFixture.checks.slice(1)] }],
    ['run URL', { ...operationalFixture, checks: [{ ...operationalFixture.checks[0], latestRun: { ...run(99), url: 'https://example.invalid/run' } }, ...operationalFixture.checks.slice(1)] }],
    ['reason', { ...operationalFixture, checks: [{ ...operationalFixture.checks[0], reason: 'PRIVATE_PROVIDER_DETAIL' }, ...operationalFixture.checks.slice(1)] }],
    ['future timestamp', { ...operationalFixture, generatedAtMs: Date.now() + 120_000 }],
    ['extra root key', { ...operationalFixture, extra: true }],
  ])('rejects broadened or inconsistent public payloads: %s', (_label, value) => {
    expect(isOperationalChecksData(value)).toBe(false);
  });

  it('keeps cache freshness separate from execution health', () => {
    const staleRunning = {
      ...operationalFixture,
      checks: [{ ...operationalFixture.checks[0], freshness: 'stale' as const, runHealth: 'running' as const,
        latestRun: run(77, 'in_progress', null), lastSuccessfulRun: null, reason: 'GITHUB_TIMEOUT' }, ...operationalFixture.checks.slice(1)],
    };
    expect(isOperationalChecksData(staleRunning)).toBe(true);
  });
});
