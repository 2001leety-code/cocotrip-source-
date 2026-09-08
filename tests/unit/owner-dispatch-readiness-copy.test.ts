import { describe, expect, it } from 'vitest';
import { ownerDispatchReadinessCopy } from '@/components/ownerDispatchReadinessCopy';
import type { Language } from '@/i18n';

describe('owner dispatch readiness four-language contract', () => {
  it.each(['ko', 'en', 'ja', 'zh'] as Language[])('%s contains complete, nonblank state and scope copy', (language) => {
    const copy = ownerDispatchReadinessCopy[language];
    expect(Object.keys(copy).sort()).toEqual(Object.keys(ownerDispatchReadinessCopy.ko).sort());
    expect(Object.keys(copy.labels).sort()).toEqual(['configuration_required', 'configured', 'off', 'unknown']);
    expect(Object.keys(copy.descriptions).sort()).toEqual(Object.keys(copy.labels).sort());
    const strings = [copy.title, copy.checking, copy.delivery, copy.unavailable, copy.details, copy.setup,
      ...Object.values(copy.labels), ...Object.values(copy.descriptions)];
    for (const text of strings) expect(text.trim().length).toBeGreaterThan(0);
    expect(copy.setup).toContain('Vercel');
    expect(copy.unavailable).toContain('WhatsApp');
    expect(copy.unavailable).toContain('API');
    expect(JSON.stringify(copy)).not.toMatch(/\uFFFD|OWNER_NOTIFICATION_UID|SUBSCRIPTION_ID|PRIVATE_KEY/);
  });
});
