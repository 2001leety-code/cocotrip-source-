// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOperationalChecks } from '@/components/AdminOperationalChecks';
import { adminOperationalChecksCopy, operationalWorkflowNames, type OperationalChecksData } from '@/lib/adminOperationalChecks';
void React;

const auth = vi.hoisted(() => ({ user: null as { uid: string; getIdToken: ReturnType<typeof vi.fn> } | null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const NOW = Date.now() - 60_000;
const run = (id: number, status: string, conclusion: string | null) => ({ id, status, conclusion,
  createdAtMs: NOW - 120_000, updatedAtMs: NOW - 60_000,
  url: `https://github.com/2001leety-code/cocotrip-source-/actions/runs/${id}` });
const fixture: OperationalChecksData = {
  generatedAtMs: NOW, source: 'github-actions', historyScope: 'latest-100-scheduled-main-runs', readOnly: true,
  checks: operationalWorkflowNames.map((workflow, index) => ({
    key: workflow.slice(0, -4), workflow, latestRun: run(index + 1, 'completed', 'success'), lastSuccessfulRun: run(index + 1, 'completed', 'success'),
    freshness: 'fresh' as const, checkedAtMs: NOW, runHealth: 'ok' as const, maxAgeMs: 4 * 24 * 60 * 60 * 1000, reason: null,
  })),
};
fixture.checks[1] = { ...fixture.checks[1], latestRun: run(12, 'completed', 'failure'), lastSuccessfulRun: null,
  freshness: 'stale', runHealth: 'failed', reason: 'GITHUB_TIMEOUT' };
fixture.checks[2] = { ...fixture.checks[2], latestRun: run(13, 'in_progress', null), lastSuccessfulRun: null,
  freshness: 'fresh', runHealth: 'running', reason: null };
fixture.checks[3] = { ...fixture.checks[3], latestRun: run(14, 'completed', 'success'), lastSuccessfulRun: run(14, 'completed', 'success'),
  freshness: 'fresh', runHealth: 'overdue', reason: null };
fixture.checks[4] = { ...fixture.checks[4], latestRun: null, lastSuccessfulRun: null,
  freshness: 'unknown', checkedAtMs: null, runHealth: 'unknown', reason: 'GITHUB_TIMEOUT' };

const network = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const control = (label: string) => screen.getByText(label).closest('button')!;

beforeEach(() => {
  auth.user = { uid: 'synthetic-owner', getIdToken: vi.fn().mockResolvedValue('synthetic-token') };
  network.mockReset().mockResolvedValue(ok(fixture));
  vi.stubGlobal('fetch', network);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('admin operational checks presentation', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as const)('keeps the %s synthetic preview fully local', language => {
    const copy = adminOperationalChecksCopy[language];
    render(<AdminOperationalChecks language={language} previewMode previewData={fixture} />);
    fireEvent.click(control(copy.expand));
    expect(screen.getByText(copy.synthetic)).toBeTruthy();
    expect(screen.getByText(copy.scope)).toBeTruthy();
    expect(screen.getByRole('button', { name: copy.refresh })).toBeDisabled();
    expect(network).not.toHaveBeenCalled();
    expect(auth.user?.getIdToken).not.toHaveBeenCalled();
  });

  it('expands and collapses while showing fetch freshness separately from run health', () => {
    const copy = adminOperationalChecksCopy.en;
    render(<AdminOperationalChecks language="en" previewMode previewData={fixture} />);
    const toggle = control(copy.expand);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(control(copy.collapse)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(copy.stale)).toBeTruthy();
    expect(screen.getByText(copy.states.failed)).toBeTruthy();
    expect(screen.getByText(copy.states.running)).toBeTruthy();
    expect(screen.getByText(copy.states.overdue)).toBeTruthy();
    const health = screen.getByText(copy.workflowLabels['daily-health.yml']).closest('div')!;
    expect(within(health).queryByText(copy.stale)).toBeNull();
    fireEvent.click(control(copy.collapse));
    expect(screen.queryByText(copy.scope)).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });

  it('rejects malformed server data instead of presenting it as an empty or healthy dashboard', async () => {
    network.mockResolvedValue(ok({ ...fixture, checks: [] }));
    render(<AdminOperationalChecks language="ko" />);
    await screen.findByRole('alert');
    fireEvent.click(control(adminOperationalChecksCopy.ko.expand));
    expect(screen.getByRole('alert')).toHaveTextContent(adminOperationalChecksCopy.ko.unknown);
    expect(screen.queryByText(adminOperationalChecksCopy.ko.states.ok)).toBeNull();
  });

  it('drops a late response after logout and never renders the former owner snapshot', async () => {
    let finish: (value: ReturnType<typeof ok>) => void = () => {};
    network.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<AdminOperationalChecks language="ko" />);
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    auth.user = null;
    view.rerender(<AdminOperationalChecks language="ko" />);
    await act(async () => { finish(ok(fixture)); });
    fireEvent.click(control(adminOperationalChecksCopy.ko.expand));
    expect(screen.queryByText(adminOperationalChecksCopy.ko.workflowLabels['daily-health.yml'])).toBeNull();
    expect(screen.getByRole('button', { name: adminOperationalChecksCopy.ko.refresh })).toBeDisabled();
  });

  it('clears prior data and reports a refresh failure without exposing provider detail', async () => {
    let current = NOW;
    vi.spyOn(Date, 'now').mockImplementation(() => current);
    render(<AdminOperationalChecks language="ko" />);
    await screen.findByText(adminOperationalChecksCopy.ko.title);
    await waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    fireEvent.click(control(adminOperationalChecksCopy.ko.expand));
    expect(screen.getByText(adminOperationalChecksCopy.ko.workflowLabels['daily-health.yml'])).toBeTruthy();
    current += 1001;
    network.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_DETAIL'));
    fireEvent.click(screen.getByRole('button', { name: adminOperationalChecksCopy.ko.refresh }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(adminOperationalChecksCopy.ko.unknown);
    expect(screen.queryByText(adminOperationalChecksCopy.ko.workflowLabels['daily-health.yml'])).toBeNull();
    expect(document.body.textContent).not.toContain('PRIVATE_PROVIDER_DETAIL');
  });
});
