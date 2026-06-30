/**
 * Marketing opt-out (수신거부) infrastructure — #1021 follow-up.
 *
 * Covers:
 *   - HMAC unsubscribe-token round-trip (generate → verify) + forgery reject
 *   - normalizeEmail (lowercase/trim, doc-id key stability)
 *   - buildUnsubscribeUrl shape (email + token query, encoded)
 *   - recordOptOut writes marketing_optout/{emailLower} with merge
 *   - isMarketingOptedOut fail-closed semantics (no db / lookup error → true)
 *   - GUARD: no actual marketing-email SENDING code exists in the new files
 *     (this is opt-out infrastructure only; sending is OFF).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normalizeEmail,
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  recordOptOut,
  isMarketingOptedOut,
  OPTOUT_COLLECTION,
} from '../../api/_shared/marketing-optout.js';

const SECRET = 'test-unsubscribe-secret-0123456789abcdef';

describe('marketing-optout — normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
  it('returns empty string for non-string / empty', () => {
    expect(normalizeEmail(undefined as unknown as string)).toBe('');
    expect(normalizeEmail(null as unknown as string)).toBe('');
    expect(normalizeEmail(123 as unknown as string)).toBe('');
    expect(normalizeEmail('')).toBe('');
  });
});

describe('marketing-optout — HMAC token round-trip', () => {
  const prev = process.env.MARKETING_UNSUBSCRIBE_SECRET;
  beforeEach(() => { process.env.MARKETING_UNSUBSCRIBE_SECRET = SECRET; });
  afterEach(() => {
    if (prev === undefined) delete process.env.MARKETING_UNSUBSCRIBE_SECRET;
    else process.env.MARKETING_UNSUBSCRIBE_SECRET = prev;
  });

  it('generate → verify succeeds for the same email', () => {
    const token = generateUnsubscribeToken('User@Example.com');
    expect(token).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(verifyUnsubscribeToken('user@example.com', token)).toBe(true);
    // case-insensitive on the email side (normalized)
    expect(verifyUnsubscribeToken('USER@EXAMPLE.COM', token)).toBe(true);
  });

  it('rejects a token minted for a different email', () => {
    const token = generateUnsubscribeToken('alice@example.com');
    expect(verifyUnsubscribeToken('bob@example.com', token)).toBe(false);
  });

  it('rejects a tampered / empty / non-string token', () => {
    const token = generateUnsubscribeToken('alice@example.com');
    expect(verifyUnsubscribeToken('alice@example.com', token.slice(0, -1) + '0')).toBe(false);
    expect(verifyUnsubscribeToken('alice@example.com', '')).toBe(false);
    expect(verifyUnsubscribeToken('alice@example.com', undefined as unknown as string)).toBe(false);
  });

  it('fails closed when secret is unset (no token, every verify false)', () => {
    delete process.env.MARKETING_UNSUBSCRIBE_SECRET;
    expect(generateUnsubscribeToken('alice@example.com')).toBe('');
    expect(verifyUnsubscribeToken('alice@example.com', 'anything')).toBe(false);
  });
});

describe('marketing-optout — buildUnsubscribeUrl', () => {
  const prev = process.env.MARKETING_UNSUBSCRIBE_SECRET;
  beforeEach(() => { process.env.MARKETING_UNSUBSCRIBE_SECRET = SECRET; });
  afterEach(() => {
    if (prev === undefined) delete process.env.MARKETING_UNSUBSCRIBE_SECRET;
    else process.env.MARKETING_UNSUBSCRIBE_SECRET = prev;
  });

  it('builds a verifiable url with encoded email + token', () => {
    const url = buildUnsubscribeUrl('User+Tag@Example.com', { siteUrl: 'https://cocotripkr.com' });
    expect(url).toContain('https://cocotripkr.com/api/marketing-unsubscribe?');
    const u = new URL(url);
    const email = u.searchParams.get('email')!;
    const token = u.searchParams.get('token')!;
    expect(email).toBe('user+tag@example.com');
    expect(verifyUnsubscribeToken(email, token)).toBe(true);
  });

  it('returns empty string when no token can be minted', () => {
    delete process.env.MARKETING_UNSUBSCRIBE_SECRET;
    expect(buildUnsubscribeUrl('a@b.com')).toBe('');
  });
});

// Minimal in-memory Firestore double matching the .collection().doc().set/get() surface used.
function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    store,
    collection(name: string) {
      return {
        doc(id: string) {
          const key = `${name}/${id}`;
          return {
            async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
              const existing = opts?.merge ? store.get(key) || {} : {};
              store.set(key, { ...existing, ...data });
            },
            async get() {
              const data = store.get(key);
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
      };
    },
  };
}

describe('marketing-optout — recordOptOut + isMarketingOptedOut', () => {
  it('records under marketing_optout/{emailLower} and reads back as opted-out', async () => {
    const db = makeFakeDb();
    const r = await recordOptOut(db as never, '  Alice@Example.com ', { source: 'unsubscribe_link' });
    expect(r.ok).toBe(true);
    const stored = db.store.get(`${OPTOUT_COLLECTION}/alice@example.com`)!;
    expect(stored.email).toBe('alice@example.com');
    expect(stored.source).toBe('unsubscribe_link');
    expect(typeof stored.optedOutAt).toBe('string');
    expect(await isMarketingOptedOut(db as never, 'ALICE@example.com')).toBe(true);
  });

  it('isMarketingOptedOut false for an email with no record', async () => {
    const db = makeFakeDb();
    expect(await isMarketingOptedOut(db as never, 'never@seen.com')).toBe(false);
  });

  it('fails closed: no db / no email → opted-out (do not send)', async () => {
    expect(await isMarketingOptedOut(null as never, 'a@b.com')).toBe(true);
    const db = makeFakeDb();
    expect(await isMarketingOptedOut(db as never, '')).toBe(true);
  });

  it('recordOptOut rejects invalid email / missing db', async () => {
    const db = makeFakeDb();
    expect((await recordOptOut(db as never, '')).ok).toBe(false);
    expect((await recordOptOut(null as never, 'a@b.com')).ok).toBe(false);
  });

  it('defaults source to unsubscribe_link', async () => {
    const db = makeFakeDb();
    await recordOptOut(db as never, 'x@y.com');
    expect(db.store.get(`${OPTOUT_COLLECTION}/x@y.com`)!.source).toBe('unsubscribe_link');
  });
});

describe('marketing-optout — SENDING-OFF guard (no marketing email send code)', () => {
  const files = [
    'api/_shared/marketing-optout.js',
    'api/marketing-unsubscribe.js',
  ];
  for (const rel of files) {
    it(`${rel} contains no marketing email SENDING code`, () => {
      const src = readFileSync(resolve(process.cwd(), rel), 'utf8');
      // Must not import/define an actual mail sender or call the transactional
      // send helper. (Comments may mention "sendMarketingEmail" as a thing that
      // does NOT exist — so we only fail on real call/import/def patterns.)
      expect(src).not.toMatch(/sendMarketingEmail\s*\(/);
      expect(src).not.toMatch(/function\s+sendMarketingEmail/);
      expect(src).not.toMatch(/from\s+['"][^'"]*_send-email\.js['"]/);
      expect(src).not.toMatch(/nodemailer|sendgrid|@sendgrid|mailgun|resend/i);
    });
  }
});
