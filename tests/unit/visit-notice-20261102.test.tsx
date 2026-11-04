// @vitest-environment jsdom
import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { projectPublicPlan } from '../../src/lib/publicPlanProjection.js';
import { visitNotice } from '../../src/lib/visitNotice.js';
import { VisitNotice } from '../../src/pages/PlanDetailPage/components/VisitNotice';
import { buildPlanHtml } from '../../api/pdf/generate.js';

describe('visit notice across plan surfaces', () => {
  it('adds dietary guidance only for actual supported restrictions and respects canonical empty values', () => {
    const base = visitNotice('en').body;
    expect(visitNotice('en', { dietaryRestrictions: ['Halal'] }).body).toContain('preparation methods');
    expect(visitNotice('en', { dietary: ['vegan'] }).body).toContain('preparation methods');
    expect(visitNotice('en', { allergies: ['Vegetarian'] }).body).toContain('preparation methods');
    expect(visitNotice('en', { dietaryRestrictions: [], dietary: ['Halal'] }).body).toBe(base);
    expect(visitNotice('en', { foodStyles: ['Seafood'], allergies: ['Peanut'] }).body).toBe(base);
  });
  it('retains shared dietary guidance as a display flag without publishing raw dietary fields', () => {
    const input = { language: 'en', dietaryRestrictions: ['Halal'], allergies: ['Peanut'] };
    const shared = projectPublicPlan({ input, itinerary: { days: [] } });
    expect(shared.input.visitDietaryRequest).toBe(true);
    expect(shared.input).not.toHaveProperty('dietaryRestrictions'); expect(shared.input).not.toHaveProperty('allergies');
    expect(visitNotice('en', shared.input).body).toBe(visitNotice('en', input).body);
    expect(buildPlanHtml(shared)).toContain(visitNotice('en', input).body);
    expect(projectPublicPlan(shared).input.visitDietaryRequest).toBe(true);
    expect(visitNotice('en', { dietaryRestrictions: [], visitDietaryRequest: true }).body).toBe(visitNotice('en').body);
    expect(visitNotice('en', { allergies: ['Peanut'], visitDietaryRequest: true }).body).toBe(visitNotice('en').body);
  });
  it.each(['ko', 'en', 'ja', 'zh'])('shows matching copy on plan and server PDF in %s', (language) => {
    const notice = visitNotice(language);
    const screen = renderToStaticMarkup(<VisitNotice language={language} />);
    const pdf = buildPlanHtml({ input: { language }, itinerary: { tour_title: 'Fixture', days: [] } });
    expect(screen).toContain(notice.title);
    expect(notice.items).toHaveLength(3);
    for (const item of notice.items) { expect(screen).toContain(item.title); expect(screen).toContain(item.body); }
    expect(visitNotice(language, { dietaryRestrictions: ['Halal'] }).items).toHaveLength(4);
    expect(screen).toContain('text-[15px]');
    expect(screen).toContain('md:text-base');
    expect(pdf).toContain(notice.title);
    expect(pdf).toContain(notice.body);
    expect(pdf.indexOf(notice.title)).toBeLessThan(pdf.indexOf('</body>'));
  });
});
