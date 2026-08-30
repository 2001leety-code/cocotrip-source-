import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inquiryApi = readFileSync(resolve(process.cwd(), 'api/inquiry-submit.js'), 'utf8');
const planModal = readFileSync(
  resolve(process.cwd(), 'src/pages/PlanDetailPage/components/ads/CharterInquireModal.tsx'),
  'utf8',
);
const chatApi = readFileSync(resolve(process.cwd(), 'api/chat.js'), 'utf8');
const pollApi = readFileSync(resolve(process.cwd(), 'api/chat-poll.js'), 'utf8');
const chatHook = readFileSync(resolve(process.cwd(), 'src/hooks/useChatSession.ts'), 'utf8');

describe('inquiry server contract normalization', () => {
  it('routes the plan-detail form through the server API instead of direct Firestore writes', () => {
    expect(planModal).toMatch(/(?:authFetch|fetch)\(['"]\/api\/inquiry-submit['"]/);
    expect(planModal).not.toMatch(/addDoc\s*\(/);
    expect(planModal).not.toMatch(/collection\(\s*db\s*,\s*['"]charter_inquiries['"]\s*\)/);
  });

  it('uses one canonical NEW status while keeping legacy plan fields', () => {
    expect(inquiryApi).toMatch(/status:\s*'NEW'/);
    for (const field of [
      'notes', 'planId', 'recommendedTour', 'quotedKRW', 'hours', 'startDate',
      'dayCount', 'itinerarySummary', 'source',
    ]) {
      expect(inquiryApi).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(planModal).toMatch(/vehicle:\s*['"]charter['"]/);
  });
});

describe('chat ownership and server-side limits', () => {
  it('does not trust body userId and resolves a signed server session', () => {
    expect(chatApi).not.toMatch(/const\s*\{[^}]*\buserId\b[^}]*\}\s*=\s*body/);
    expect(chatApi).toContain('resolveChatSessionForPost');
    expect(chatApi).toMatch(/checkRateLimit\s*\(\s*uid\s*,\s*ip\s*\)/);
  });

  it('protects polling with ownership verification and a server-side counter', () => {
    expect(pollApi).toContain('authorizeChatSessionRead');
    expect(pollApi).toContain('checkChatPollRateLimit');
    expect(pollApi).not.toContain('sessionId itself acts as access token');
  });

  it('sends Firebase bearer auth for signed-in users and never sends body userId', () => {
    expect(chatHook).toMatch(/getIdToken\s*\(/);
    expect(chatHook).toMatch(/Authorization/);
    expect(chatHook).not.toMatch(/userId:\s*user/);
  });
});
