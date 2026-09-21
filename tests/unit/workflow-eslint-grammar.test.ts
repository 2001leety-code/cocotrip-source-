import { readFile } from 'node:fs/promises';
import { ESLint } from 'eslint';
import { expect, it } from 'vitest';

it('parses the Workflow return without ignoring the file or permitting invalid syntax elsewhere', async () => {
  const filePath = '.claude/skills/verify-surfaces/cross-surface-audit.js';
  const source = await readFile(filePath, 'utf8');
  const eslint = new ESLint();
  expect(await eslint.isPathIgnored(filePath)).toBe(false);
  const [valid] = await eslint.lintText(source, { filePath });
  expect(valid.messages).toEqual([]);
  const [invalid] = await eslint.lintText(`${source}\nconst broken = ;`, { filePath });
  expect(invalid.fatalErrorCount).toBe(1);
  const [ordinaryModule] = await eslint.lintText('return 1;', { filePath: 'scripts/synthetic-workflow-grammar.js' });
  expect(ordinaryModule.fatalErrorCount).toBe(1);
});
