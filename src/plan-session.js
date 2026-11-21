import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const lifetime = 2 * 60 * 60 * 1000;
const maxTokenLength = 1000000;
const maxSessionBytes = 8 * 1024 * 1024;

function sessionKey(secret) {
  return hkdfSync('sha256', secret, '', 'domestic-travel-planner/session/v1', 32);
}

export function sealPlan(trip, context, secret) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sessionKey(secret), nonce);
  const data = JSON.stringify({
    expires: Date.now() + lifetime,
    trip,
    context: { ...context, places: [...context.places], routes: [...context.routes] },
  });
  if (Buffer.byteLength(data) > maxSessionBytes) throw new Error('Plan session too large');
  const ciphertext = Buffer.concat([cipher.update(gzipSync(data)), cipher.final()]);
  const token = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64url');
  if (token.length > maxTokenLength) throw new Error('Plan session too large');
  return token;
}

export function openPlan(token, secret) {
  if (typeof token !== 'string' || token.length > maxTokenLength || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const data = Buffer.from(token, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', sessionKey(secret), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const bytes = Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
    const session = JSON.parse(gunzipSync(bytes, { maxOutputLength: maxSessionBytes }));
    if (session.expires <= Date.now()) return null;
    session.context.places = new Map(session.context.places);
    session.context.routes = new Map(session.context.routes);
    return session;
  } catch {
    return null;
  }
}
