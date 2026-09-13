function base64url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = atob(normalized + pad);
  const out = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    out[i] = decoded.charCodeAt(i);
  }
  return out;
}

export function getConfiguredVapidPublicKey(): { value: string; bytes: Uint8Array } | null {
  const configured = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  const value = typeof configured === 'string' ? configured.trim() : '';
  const bytes = parseVapidPublicKey(value);
  return bytes ? { value, bytes } : null;
}

export function parseVapidPublicKey(value: string | undefined): Uint8Array | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || !/^[A-Za-z0-9_-]+={0,2}$/.test(normalized)) return null;
  try {
    const bytes = urlBase64ToUint8Array(normalized);
    if (bytes.length !== 65 || bytes[0] !== 4 || base64url(bytes) !== normalized.replace(/=+$/, '')) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function getPushSubscriptionApplicationServerKeyBytes(value: unknown): Uint8Array | null {
  let bytes: Uint8Array | null = null;
  if (value instanceof ArrayBuffer) bytes = new Uint8Array(value.slice(0));
  else if (value instanceof Uint8Array) bytes = new Uint8Array(value);
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  if (typeof value === 'string') {
    return parseVapidPublicKey(value);
  }
  return bytes && bytes.length === 65 && bytes[0] === 4 ? bytes : null;
}

export function isSameVapidPublicKey(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
