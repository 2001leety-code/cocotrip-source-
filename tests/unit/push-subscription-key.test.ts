import { describe, expect, it } from 'vitest';
import { getPushSubscriptionApplicationServerKeyBytes, parseVapidPublicKey } from '@/lib/pushSubscriptionKey';

const validKey = () => {
  const bytes = new Uint8Array(65);
  bytes[0] = 4;
  for (let index = 1; index < bytes.length; index++) bytes[index] = index;
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

describe('push subscription VAPID key format', () => {
  it('accepts an uncompressed 65-byte base64url public key and surrounding whitespace', () => {
    expect(parseVapidPublicKey(`\n${validKey()}\n`)).toHaveLength(65);
  });

  it('rejects malformed, wrong-length, and non-uncompressed configured keys', () => {
    expect(parseVapidPublicKey('bad!')).toBeNull();
    expect(parseVapidPublicKey(btoa('short'))).toBeNull();
    const wrongPrefix = new Uint8Array(65);
    expect(getPushSubscriptionApplicationServerKeyBytes(wrongPrefix)).toBeNull();
  });
});
