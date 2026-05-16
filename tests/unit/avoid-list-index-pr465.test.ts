/**
 * PR #465 — Audit X-H7 regression slot.
 *
 * Pre-fix: api/_ai_core/avoidListQuery.js issued composite
 * Firestore queries
 *   plans.where('uid', '==', uid).orderBy('createdAt', 'desc').limit(3)
 *   plans.where('email', '==', email).orderBy('createdAt', 'desc').limit(3)
 * but firestore.indexes.json defined neither index — only
 * `userEmail+createdAt` existed (legacy). Firestore threw
 * FAILED_PRECONDITION on EVERY user. The catch was console.warn-only
 * and returned '' → the AVOID clause never reached Gemini → users got
 * the same top-rated restaurants over and over ("왜 매번 같은 식당
 * 추천?" CS complaints). Operator had no signal.
 *
 * Post-fix:
 *  1. firestore.indexes.json — added the two missing plans indexes
 *     (uid+createdAt, email+createdAt).
 *  2. avoidListQuery.js — `isFirestoreIndexMissingError` detector and
 *     `extractIndexCreationUrl` helper exported. On detection, fires
 *     an admin Telegram alert (once per query-kind per 5-min window)
 *     with the Firebase-provided 1-click index-creation URL.
 *  3. Behavior unchanged: returns '' (fail-OPEN — AVOID clause is
 *     non-critical to plan delivery; user gets a plan, just with
 *     repeat-restaurant risk until operator deploys indexes).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const avoidSrc = readFileSync(
  resolve(process.cwd(), 'api/_ai_core/avoidListQuery.js'),
  'utf8',
);
const indexesSrc = readFileSync(
  resolve(process.cwd(), 'firestore.indexes.json'),
  'utf8',
);
const indexes = JSON.parse(indexesSrc);

const alertCalls: any[] = [];
vi.mock('../../api/_shared/telegram-throttle.js', () => ({
  throttledTelegramAlert: vi.fn(async (args: any) => {
    alertCalls.push(args);
    return { ok: true, alerted: true };
  }),
}));

import {
  buildAvoidClause,
  isFirestoreIndexMissingError,
  extractIndexCreationUrl,
} from '../../api/_ai_core/avoidListQuery.js';

describe('PR #465 X-H7 — isFirestoreIndexMissingError detector', () => {
  it('matches FAILED_PRECONDITION code + "requires an index" message', () => {
    const err = Object.assign(new Error('The query requires an index. Create here: https://x'), {
      code: 'FAILED_PRECONDITION',
    });
    expect(isFirestoreIndexMissingError(err)).toBe(true);
  });

  it('matches gRPC numeric code 9 + matching message', () => {
    const err = Object.assign(new Error('FAILED_PRECONDITION: The query requires an index'), {
      code: 9,
    });
    expect(isFirestoreIndexMissingError(err)).toBe(true);
  });

  it('matches message-only when code is absent (defensive)', () => {
    const err = new Error('The query requires an index. Visit https://...');
    expect(isFirestoreIndexMissingError(err)).toBe(true);
  });

  it('does NOT match unrelated errors', () => {
    expect(isFirestoreIndexMissingError(new Error('permission denied'))).toBe(false);
    expect(isFirestoreIndexMissingError(new Error('deadline exceeded'))).toBe(false);
    expect(isFirestoreIndexMissingError(null)).toBe(false);
    expect(isFirestoreIndexMissingError(undefined)).toBe(false);
  });

  it('does NOT false-match on a permission error that contains the word "index"', () => {
    const err = new Error('reindexing in progress; permission denied');
    expect(isFirestoreIndexMissingError(err)).toBe(false);
  });
});

describe('PR #465 X-H7 — extractIndexCreationUrl helper', () => {
  it('pulls the console.firebase.google.com URL out of the error message', () => {
    const err = new Error(
      'The query requires an index. You can create it here: https://console.firebase.google.com/project/cocotrip/firestore/indexes?create_composite=ABC123 — please deploy.',
    );
    const url = extractIndexCreationUrl(err);
    expect(url).toBe('https://console.firebase.google.com/project/cocotrip/firestore/indexes?create_composite=ABC123');
  });

  it('returns empty string when the URL is not present', () => {
    expect(extractIndexCreationUrl(new Error('no url here'))).toBe('');
    expect(extractIndexCreationUrl(null)).toBe('');
    expect(extractIndexCreationUrl(undefined)).toBe('');
  });

  it('handles trailing punctuation correctly (stops at whitespace or `)`)', () => {
    const err = new Error('Create here: https://console.firebase.google.com/x?y=z) Not part of url');
    expect(extractIndexCreationUrl(err)).toBe('https://console.firebase.google.com/x?y=z');
  });
});

describe('PR #465 X-H7 — buildAvoidClause alert on index missing', () => {
  beforeEach(() => {
    alertCalls.length = 0;
  });

  function makeIndexMissingDb(): any {
    return {
      collection: () => ({
        orderBy: () => ({
          limit: () => ({
            where: () => ({
              get: async () => {
                const err = Object.assign(new Error(
                  'The query requires an index. You can create it here: https://console.firebase.google.com/project/cocotrip/firestore/indexes?create_composite=XYZ',
                ), { code: 'FAILED_PRECONDITION' });
                throw err;
              },
            }),
          }),
        }),
      }),
    };
  }

  it('uid query + index missing → returns "" AND fires admin alert with URL', async () => {
    const db = makeIndexMissingDb();
    const result = await buildAvoidClause(db, { uid: 'user-1', requestEmail: undefined });
    expect(result).toBe('');
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('avoid-list-index-missing:uid');
    expect(alertCalls[0].channel).toBe('admin');
    expect(alertCalls[0].severity).toBe('high');
    expect(alertCalls[0].message).toMatch(/AVOID list Firestore index missing/);
    expect(alertCalls[0].message).toMatch(/console\.firebase\.google\.com/);
    expect(alertCalls[0].message).toMatch(/1-click create/);
  });

  it('email query + index missing → fires alert with kind=email (separate dedup)', async () => {
    const db = makeIndexMissingDb();
    const result = await buildAvoidClause(db, { uid: undefined, requestEmail: 'guest@example.com' });
    expect(result).toBe('');
    expect(alertCalls.length).toBe(1);
    expect(alertCalls[0].key).toBe('avoid-list-index-missing:email');
  });

  it('non-index error (e.g. permission denied) → returns "" but NO alert', async () => {
    const db = {
      collection: () => ({
        orderBy: () => ({
          limit: () => ({
            where: () => ({
              get: async () => { throw new Error('permission denied'); },
            }),
          }),
        }),
      }),
    } as any;
    const result = await buildAvoidClause(db, { uid: 'user-1', requestEmail: undefined });
    expect(result).toBe('');
    expect(alertCalls.length).toBe(0);
  });

  it('happy path (no error) → returns AVOID clause AND no alert', async () => {
    const db = {
      collection: () => ({
        orderBy: () => ({
          limit: () => ({
            where: () => ({
              get: async () => ({
                size: 2,
                forEach: (cb: any) => {
                  cb({ data: () => ({ itinerary: { days: [{ stops: [{ category: 'food', name: '광장시장 김밥' }] }] } }) });
                  cb({ data: () => ({ itinerary: { days: [{ stops: [{ category: 'food', name: '부근진토 갈비' }] }] } }) });
                },
              }),
            }),
          }),
        }),
      }),
    } as any;
    const result = await buildAvoidClause(db, { uid: 'user-1', requestEmail: undefined });
    expect(result).toMatch(/광장시장 김밥/);
    expect(result).toMatch(/부근진토 갈비/);
    expect(result).toMatch(/AVOID LIST/);
    expect(alertCalls.length).toBe(0);
  });

  it('no adminDb or no identifier → returns "" without throwing', async () => {
    expect(await buildAvoidClause(null, { uid: 'u' })).toBe('');
    expect(await buildAvoidClause({} as any, {})).toBe('');
    expect(alertCalls.length).toBe(0);
  });
});

describe('PR #465 X-H7 — firestore.indexes.json has the required composite indexes', () => {
  function hasIndex(collectionGroup: string, fields: Array<{ fieldPath: string; order: string }>) {
    return indexes.indexes.some((idx: any) =>
      idx.collectionGroup === collectionGroup &&
      idx.fields.length === fields.length &&
      idx.fields.every((f: any, i: number) =>
        f.fieldPath === fields[i].fieldPath && f.order === fields[i].order,
      ),
    );
  }

  it('plans.uid + createdAt DESC index is defined', () => {
    expect(hasIndex('plans', [
      { fieldPath: 'uid', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true);
  });

  it('plans.email + createdAt DESC index is defined', () => {
    expect(hasIndex('plans', [
      { fieldPath: 'email', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true);
  });

  it('legacy plans.userEmail + createdAt DESC index is preserved', () => {
    expect(hasIndex('plans', [
      { fieldPath: 'userEmail', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
    ])).toBe(true);
  });
});

describe('PR #465 X-H7 — source-level invariants', () => {
  it('imports throttledTelegramAlert from shared helper', () => {
    expect(avoidSrc).toMatch(/from\s+['"]\.\.\/_shared\/telegram-throttle\.js['"]/);
  });

  it('exports the two new helpers', () => {
    expect(avoidSrc).toMatch(/export\s+function\s+isFirestoreIndexMissingError\s*\(/);
    expect(avoidSrc).toMatch(/export\s+function\s+extractIndexCreationUrl\s*\(/);
  });

  it('alert key follows the canonical dedup form', () => {
    expect(avoidSrc).toMatch(/avoid-list-index-missing:\$\{queryKind\}/);
  });

  it('alert is fire-and-forget (.catch swallow)', () => {
    expect(avoidSrc).toMatch(/throttledTelegramAlert\(\{[\s\S]*?avoid-list-index-missing[\s\S]*?\}\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
  });

  it('detector matches FAILED_PRECONDITION OR gRPC code 9', () => {
    expect(avoidSrc).toMatch(/code\s*===\s*['"]FAILED_PRECONDITION['"]\s*\|\|\s*code\s*===\s*['"]9['"]/);
  });

  it('AVOID-clause fail-OPEN preserved: catch ends with return ""', () => {
    // Read the catch block — it must still terminate with `return '';` (the
    // non-critical-path contract). The alert call is fire-and-forget; the
    // function must NEVER throw.
    const catchBlock = avoidSrc.slice(avoidSrc.indexOf('} catch (err) {'), avoidSrc.indexOf('}\n}'));
    expect(catchBlock).toMatch(/return\s+['"]['"]\s*;\s*\}/);
  });
});
