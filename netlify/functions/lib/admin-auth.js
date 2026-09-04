// Shared helper for the admin dashboard's simple password auth.
//
// There's one shared password (env var ADMIN_PASSWORD), not per-user
// accounts. On successful login we issue a signed, expiring token
// (HMAC-SHA256 over an expiry timestamp, keyed with the password itself
// so no extra secret needs to be configured). The browser stores that
// token and sends it back as the `x-admin-token` header on every admin
// request; we just recompute the HMAC and compare.
//
// Required env var:
//   ADMIN_PASSWORD   the password for the admin dashboard login screen

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function getSecret() {
  const password = (process.env.ADMIN_PASSWORD || '').trim();
  if (!password) throw new Error('Missing ADMIN_PASSWORD env var');
  return password;
}

function sign(expiry) {
  const secret = getSecret();
  return crypto.createHmac('sha256', secret).update(String(expiry)).digest();
}

function checkPassword(candidate) {
  const secret = getSecret();
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(secret);
  // Constant-time-ish compare (lengths differ often enough that this isn't
  // perfectly constant time, but it avoids the most naive early-exit
  // comparison for a low-stakes single-shared-password login).
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueToken() {
  const expiry = Date.now() + TOKEN_TTL_MS;
  const sig = sign(expiry);
  return `${base64url(String(expiry))}.${base64url(sig)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [expiryPart, sigPart] = token.split('.');
  let expiry;
  try {
    expiry = parseInt(fromBase64url(expiryPart).toString('utf8'), 10);
  } catch (e) {
    return false;
  }
  if (!expiry || Date.now() > expiry) return false;

  let expectedSig, actualSig;
  try {
    expectedSig = sign(expiry);
    actualSig = fromBase64url(sigPart);
  } catch (e) {
    return false;
  }
  if (expectedSig.length !== actualSig.length) return false;
  return crypto.timingSafeEqual(expectedSig, actualSig);
}

// Pulls the token from the request and returns true/false. Netlify Functions
// (classic `event` handlers) lowercase header names.
function isAuthorized(event) {
  const header = (event.headers && (event.headers['x-admin-token'] || event.headers['X-Admin-Token'])) || '';
  return verifyToken(header);
}

function unauthorizedResponse() {
  return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
}

module.exports = { checkPassword, issueToken, verifyToken, isAuthorized, unauthorizedResponse };
