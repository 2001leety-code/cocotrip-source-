// @vitest-environment jsdom
//
// PlannerEvidence renders a description list, so it has to be one (2026-08-11).
//
// The ledger under the wizard was marked up as `<dl>` → `<div>` → `<dd>` figure,
// `<dt>` label, `<p>` note. Two things are wrong with that and both are the same
// mistake: a grouping `<div>` inside a `<dl>` may hold one or more `<dt>`
// followed by one or more `<dd>`, and nothing else. Leading with the `<dd>`
// means the figure describes no term, and the bare `<p>` is not part of the list
// at all — so "3,166 · Restaurants in database · across 25 cities" reached an
// assistive reader as an orphaned value, an orphaned term, and a loose
// paragraph rather than one measurement.
//
// A render rather than a regex over the source: the property is the DOM the
// browser builds, and a source assertion would keep passing the day someone
// reorders the JSX. `PlannerMasthead.tsx` imports only a type, so this mounts
// without the planner's firebase / PayPal tree.
import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PlannerEvidence } from '../../src/pages/PlannerPage/components/PlannerMasthead';
import { PLANNER_COPY } from '../../src/pages/PlannerPage/plannerCopy';

afterEach(cleanup);

const LOCALES = ['en', 'ko', 'ja', 'zh'] as const;

describe('PlannerEvidence description list', () => {
  for (const lang of LOCALES) {
    for (const isMobile of [false, true]) {
      it(`is a valid dl in ${lang} (${isMobile ? 'mobile' : 'desktop'})`, () => {
        const { container } = render(
          <PlannerEvidence copy={PLANNER_COPY[lang]} isMobile={isMobile} />,
        );

        const dl = container.querySelector('dl');
        expect(dl).not.toBeNull();

        const groups = Array.from(dl!.children);
        expect(groups.length).toBe(PLANNER_COPY[lang].evidence.items.length);

        for (const group of groups) {
          // Only `div` may group inside a `dl`.
          expect(group.tagName).toBe('DIV');

          const tags = Array.from(group.children).map((el) => el.tagName);
          // At least one term and one description, and nothing that is neither.
          expect(tags).toContain('DT');
          expect(tags).toContain('DD');
          expect(tags.filter((t) => t !== 'DT' && t !== 'DD')).toEqual([]);

          // Every `dt` precedes every `dd` — no description before its term.
          const lastDt = tags.lastIndexOf('DT');
          const firstDd = tags.indexOf('DD');
          expect(`${lang}: dt@${lastDt} < dd@${firstDd}`).toBe(`${lang}: dt@${lastDt} < dd@${lastDt + 1}`);
        }
      });
    }
  }

  it('keeps the figure on top of the label, which is what a ledger reads like', () => {
    const { container } = render(<PlannerEvidence copy={PLANNER_COPY.en} isMobile={false} />);
    const group = container.querySelector('dl > div')!;
    const figure = group.querySelector('dd')!;
    // Correct reading order (term first) with the measurement still painted
    // above it — `order-first` on the figure, not a reshuffled DOM.
    expect(group.className).toContain('flex-col');
    expect(figure.className).toContain('order-first');
    expect(figure.textContent).toBe(PLANNER_COPY.en.evidence.items[0].figure);
  });
});
