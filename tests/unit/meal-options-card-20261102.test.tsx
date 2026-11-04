import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MealOptionsCard, type MealOptionsCardProps, type MealOptionsStatus } from '../../src/components/MealOptionsCard';
import { mealOptionMessages, type MealOptionLanguage } from '../../src/lib/mealOptionMessages';

const options = [
  { id: 'a', name: 'First Restaurant', verificationStatus: 'evidence_level_original', sourceUrl: 'javascript:alert(1)', repeatReason: 'verified_repeat' },
  { id: 'b', name: 'Second Restaurant', verificationStatus: 'reported', sourceUrl: 'https://example.com/source', repeatReason: 'internal_unknown_reason' },
  { id: 'c', name: 'Third Restaurant', verificationStatus: 'unverified' },
  { id: 'd', name: 'Fourth Restaurant', verificationStatus: 'unverified' },
];
const props: MealOptionsCardProps = { options, baselineId: 'a', selectedId: null, busy: false, onSelect: vi.fn(), status: 'feasible', lang: 'en' };
const render = (overrides: Partial<MealOptionsCardProps> = {}) => renderToStaticMarkup(<MealOptionsCard {...props} {...overrides} />);

describe('meal options card', () => {
  it('shows at most three, states no selection, preserves evidence, and blocks unsafe source schemes and raw codes', () => {
    const html = render();
    expect(html.match(/<button\b/g)).toHaveLength(3);
    expect(html).toContain('First Restaurant');
    expect(html).not.toContain('Fourth Restaurant');
    expect(html).toContain(mealOptionMessages.en.notSelected);
    expect(html).toContain('evidence_level_original');
    expect(html).toContain(mealOptionMessages.en.verifiedRepeat);
    expect(html).not.toContain('verified_repeat');
    expect(html).not.toContain('internal_unknown_reason');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.com/source');
    expect(html).toContain(mealOptionMessages.en.source);
    expect(html).not.toContain('limited options');
  });

  it.each(['no_match', 'information_unknown', 'route_failed', 'confirmation_required'] as MealOptionsStatus[])('%s disables selection and does not claim a missing baseline was calculated', (status) => {
    const html = render({ status, baselineId: null });
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3);
    expect(html).not.toContain(mealOptionMessages.en.baselineNote);
    expect(html).toContain(mealOptionMessages.en[status]);
  });

  it('disables selection while busy', () => {
    expect(render({ busy: true }).match(/<button[^>]*disabled=""/g)).toHaveLength(3);
  });

  it.each(['ko', 'en', 'ja', 'zh'] as MealOptionLanguage[])('renders the supported repeat explanation in %s', (lang) => {
    const html = render({ lang });
    expect(html).toContain(mealOptionMessages[lang].verifiedRepeat);
    expect(html).toContain(mealOptionMessages[lang].baselineNote);
    expect(html).toContain(mealOptionMessages[lang].notSelected);
    expect(html).toContain(mealOptionMessages[lang].source);
  });
  it('shows known candidate times without inventing unknown travel values', () => {
    const html = render({ options: [{ id: 'x', name: 'Timed', verificationStatus: 'verified', startMin: 720, endMin: 780, inboundMin: 0 }] });
    expect(html).toContain('Meal starts: 12:00');
    expect(html).toContain('Meal ends: 13:00');
    expect(html).toContain('Travel to meal: 0 min');
    expect(html).not.toContain('Travel after meal:');
  });

});
