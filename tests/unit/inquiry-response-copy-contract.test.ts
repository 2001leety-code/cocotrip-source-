import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inquirySurfaces = [
  'src/components/tours/TourInquireModal.tsx',
  'src/pages/PlanDetailPage/components/ads/CharterInquireModal.tsx',
];

describe('customer inquiry response copy', () => {
  it.each(inquirySurfaces)('%s does not promise an unsupported response deadline', (path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/24\s*(?:시간|hours?|h\b|時間|小时)/i);
  });
});
