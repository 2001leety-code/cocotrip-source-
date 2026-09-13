import { createECDH } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inspectVapidPair } from '../../api/_shared/owner-vapid-diagnostics.js';

function syntheticPair() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const publicBytes = ecdh.getPublicKey();
  const privateBytes = ecdh.getPrivateKey();
  try {
    return { publicKey: publicBytes.toString('base64url'), privateKey: privateBytes.toString('base64url') };
  } finally {
    publicBytes.fill(0);
    privateBytes.fill(0);
  }
}

describe('owner VAPID pair diagnostics', () => {
  it('accepts a matching synthetic P-256 pair', () => {
    const pair = syntheticPair();
    expect(inspectVapidPair(pair.publicKey, pair.privateKey)).toEqual({
      publicKeyValid: true, privateKeyValid: true, pairMatches: true,
    });
  });

  it('separates valid same-length keys from a mismatched pair', () => {
    const first = syntheticPair();
    const second = syntheticPair();
    expect(inspectVapidPair(first.publicKey, second.privateKey)).toEqual({
      publicKeyValid: true, privateKeyValid: true, pairMatches: false,
    });
  });

  it('keeps malformed public and private key classifications separate', () => {
    const pair = syntheticPair();
    expect(inspectVapidPair('not-base64url!', pair.privateKey)).toEqual({
      publicKeyValid: false, privateKeyValid: true, pairMatches: false,
    });
    expect(inspectVapidPair(pair.publicKey, 'not-base64url!')).toEqual({
      publicKeyValid: true, privateKeyValid: false, pairMatches: false,
    });
  });

  it('rejects a zero private scalar despite its encoded length', () => {
    const pair = syntheticPair();
    const zeroScalar = Buffer.alloc(32).toString('base64url');
    expect(inspectVapidPair(pair.publicKey, zeroScalar)).toEqual({
      publicKeyValid: true, privateKeyValid: false, pairMatches: false,
    });
  });

  it('uses the existing trim behavior for newline-wrapped keys', () => {
    const pair = syntheticPair();
    expect(inspectVapidPair(`\n${pair.publicKey}\n`, `\r\n${pair.privateKey}\n`)).toEqual({
      publicKeyValid: true, privateKeyValid: true, pairMatches: true,
    });
  });

  it('accepts canonical base64 padding', () => {
    const pair = syntheticPair();
    const paddedPublic = `${pair.publicKey}=`;
    const paddedPrivate = `${pair.privateKey}=`;
    expect(inspectVapidPair(paddedPublic, paddedPrivate)).toEqual({
      publicKeyValid: true, privateKeyValid: true, pairMatches: true,
    });
  });
});
