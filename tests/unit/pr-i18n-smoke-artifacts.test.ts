import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/pr-i18n-smoke.yml'), 'utf8');

describe('PR i18n smoke artifact isolation', () => {
  it('retains distinct HTML and test output folders for each sequential Playwright call', () => {
    const stepNames = [
      'Run i18n locale smoke against preview URL (3 viewports)',
      'Run SPA nav smoke against preview URL (3 viewports)',
      'Run analytics guard + charter entry friction against preview URL (3 viewports)',
    ];
    const htmlFolders: string[] = [];
    const testFolders: string[] = [];

    for (const name of stepNames) {
      const step = workflow.split(`- name: ${name}`)[1].split('\n      - name: ')[0];
      const htmlFolder = step.match(/PLAYWRIGHT_HTML_OUTPUT_DIR:\s*(\S+)/)?.[1];
      const testFolder = step.match(/--output\s+(\S+)/)?.[1];
      expect(htmlFolder, `${name} must isolate its HTML report`).toBeTruthy();
      expect(testFolder, `${name} must isolate traces and test artifacts`).toBeTruthy();
      expect(htmlFolder?.startsWith('tests/report/'), `${name} HTML report must stay under the upload root`).toBe(true);
      htmlFolders.push(htmlFolder || '');
      testFolders.push(testFolder || '');
    }

    expect(new Set(htmlFolders).size).toBe(3);
    expect(new Set(testFolders).size).toBe(3);
  });

  it('always uploads isolated HTML reports containing failed-test attachments', () => {
    const upload = workflow.split('- name: Upload Playwright report')[1];

    expect(workflow).toContain("if: always() && github.event_name == 'deployment_status'");
    expect(upload).toContain('path: tests/report/');
    expect(upload).not.toContain('test-results/');
    expect(upload).not.toMatch(/(?:^|\s)auth(?:\/|\s|$)/i);
    expect(upload).not.toContain('**');
    expect(upload).not.toMatch(/path:\s*\|/);
    expect(upload).toContain('retention-days: 14');
  });
});
