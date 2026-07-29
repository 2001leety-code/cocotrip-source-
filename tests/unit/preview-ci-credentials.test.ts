import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Vercel Preview CI 자격증명 분리', () => {
  for (const workflow of [
    '.github/workflows/pr-pdf-golden.yml',
    '.github/workflows/pr-visual-regression.yml',
  ]) {
    it(`${workflow}는 Preview Firebase fixture만 사용한다`, () => {
      const source = read(workflow);
      for (const secret of [
        'PREVIEW_FIREBASE_WEB_API_KEY',
        'PREVIEW_HEALTH_CHECK_EMAIL',
        'PREVIEW_HEALTH_CHECK_PASSWORD',
        'PREVIEW_PDF_GOLDEN_PLAN_ID',
      ]) {
        expect(source).toContain(`secrets.${secret}`);
      }
      expect(source).not.toMatch(/\$\{\{\s*secrets\.HEALTH_CHECK_(EMAIL|PASSWORD)\s*\}\}/);
      expect(source).not.toMatch(/\$\{\{\s*secrets\.PDF_GOLDEN_PLAN_ID\s*\}\}/);
      expect(source).not.toMatch(/\$\{\{\s*secrets\.FIREBASE_WEB_API_KEY\s*\}\}/);
      expect(source).not.toMatch(/\$\{\{\s*secrets\.VITE_FIREBASE_API_KEY\s*\}\}/);
    });
  }
});
