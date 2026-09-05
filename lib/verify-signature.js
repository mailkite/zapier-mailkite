'use strict';

const crypto = require('crypto');

/**
 * How far (either direction) a delivery's signature timestamp may drift from now before it
 * is rejected as stale. Same window the MailKite SDKs enforce (`DEFAULT_TOLERANCE_MS`).
 */
const FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Verify an `x-mailkite-signature: t=<ms>,v1=<hex>` header over the exact bytes MailKite
 * signed. Mirrors `MailKite.verifyWebhook` in the Node SDK: `v1` is
 * `HMAC-SHA256(secret, "<t>.<rawBody>")` as lowercase hex; comparison is constant-time over
 * decoded bytes.
 * @param {string} secret - The webhook signing secret (`whsec_…`).
 * @param {string|undefined} signatureHeader - Raw `x-mailkite-signature` header value.
 * @param {string|Buffer} rawBody - The unparsed request body, byte-for-byte as delivered.
 * @param {number} [toleranceMs] - Replay window in ms; `0` disables the freshness check.
 * @returns {boolean} `true` only if the header is well-formed, fresh, and authentic.
 */
function verifySignature(secret, signatureHeader, rawBody, toleranceMs = FRESHNESS_MS) {
  if (typeof signatureHeader !== 'string' || !signatureHeader) return false;
  const parts = {};
  for (const seg of signatureHeader.split(',')) {
    const i = seg.indexOf('=');
    if (i !== -1) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  const t = Number(parts.t);
  if (!parts.t || !parts.v1 || !Number.isFinite(t)) return false;
  if (toleranceMs > 0 && Math.abs(Date.now() - t) > toleranceMs) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.`)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { FRESHNESS_MS, verifySignature };
