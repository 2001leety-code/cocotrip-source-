import { createECDH, timingSafeEqual } from 'node:crypto';

function decodeKey(input, bytes) {
  if (typeof input !== 'string') return null;
  const normalized = input.trim();
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(normalized)) return null;
  const decoded = Buffer.from(normalized, 'base64url');
  if (decoded.length !== bytes || decoded.toString('base64url') !== normalized.replace(/=+$/, '')) {
    decoded.fill(0);
    return null;
  }
  return decoded;
}

/** Runs beside the existing Secret in the server; never exports key material or changes dispatch. */
export function inspectVapidPair(publicKey, privateKey) {
  let publicBytes;
  let privateBytes;
  let derivedPublic;
  let publicKeyValid = false;
  let privateKeyValid = false;
  let pairMatches = false;
  try {
    publicBytes = decodeKey(publicKey, 65);
    privateBytes = decodeKey(privateKey, 32);
    if (publicBytes) {
      try { createECDH('prime256v1').setPublicKey(publicBytes); publicKeyValid = true; }
      catch { /* Invalid public curve point. No raw error. */ }
    }
    if (privateBytes) {
      try {
        const ecdh = createECDH('prime256v1');
        ecdh.setPrivateKey(privateBytes);
        derivedPublic = ecdh.getPublicKey();
        privateKeyValid = derivedPublic.length === 65;
      } catch { /* Invalid scalar. No raw error. */ }
    }
    if (publicKeyValid && privateKeyValid) pairMatches = timingSafeEqual(publicBytes, derivedPublic);
  } catch { /* Diagnostics never interrupt the existing worker. */ }
  finally {
    publicBytes?.fill(0);
    privateBytes?.fill(0);
    derivedPublic?.fill(0);
  }
  return { publicKeyValid, privateKeyValid, pairMatches };
}
