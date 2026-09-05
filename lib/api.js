'use strict';

/**
 * Thin helpers over the MailKite REST API, shared by every trigger and create.
 *
 * All paths are relative; `beforeRequest` in index.js prefixes BASE_URL and adds the
 * Bearer header. Every endpoint here is the same one the n8n community node and the
 * Pipedream components call, so the three integrations stay behaviourally identical.
 */

const BASE_URL = 'https://api.mailkite.dev';

/**
 * List the account's domains — `GET /api/domains` (a bare array of domain rows).
 * @param {object} z - Zapier's z object.
 * @returns {Promise<object[]>} Domain rows.
 */
async function listDomains(z) {
  const response = await z.request({ url: '/api/domains' });
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * Fetch one domain — `GET /api/domains/:id`. The response is `{ domain, dns }`; only the
 * domain is returned. Its `webhookUrl` / `webhookAckMode` describe the current catch-all
 * webhook route.
 * @param {object} z - Zapier's z object.
 * @param {string} domainId - Domain id (`dom_…`).
 * @returns {Promise<object|null>} The domain row, or null.
 */
async function getDomain(z, domainId) {
  const response = await z.request({ url: `/api/domains/${encodeURIComponent(domainId)}` });
  return (response.data && response.data.domain) || null;
}

/**
 * Register (or replace) the domain's catch-all inbound webhook — `PUT /api/domains/:id/webhook`.
 * Returns the route's `signingSecret`, the HMAC key for `x-mailkite-signature`.
 * @param {object} z - Zapier's z object.
 * @param {string} domainId - Domain id.
 * @param {{url: string, ackMode: string}} data - Webhook URL + acknowledgement mode.
 * @returns {Promise<string|null>} The signing secret, or null if the API did not return one.
 */
async function setWebhook(z, domainId, data) {
  const response = await z.request({
    method: 'PUT',
    url: `/api/domains/${encodeURIComponent(domainId)}/webhook`,
    body: data,
  });
  return (response.data && response.data.signingSecret) || null;
}

/**
 * Remove the domain's catch-all inbound webhook — `DELETE /api/domains/:id/webhook`.
 * @param {object} z - Zapier's z object.
 * @param {string} domainId - Domain id.
 * @returns {Promise<void>}
 */
async function deleteWebhook(z, domainId) {
  await z.request({
    method: 'DELETE',
    url: `/api/domains/${encodeURIComponent(domainId)}/webhook`,
  });
}

/**
 * List stored messages, newest first — `GET /api/messages`. No domain or direction
 * filter exists, so callers filter client-side. List rows omit the bodies.
 * @param {object} z - Zapier's z object.
 * @param {{limit?: number, before?: number}} [opts] - Page size (1–200) and cursor.
 * @returns {Promise<object[]>} Message list rows.
 */
async function listMessages(z, opts = {}) {
  const params = {};
  if (opts.limit !== undefined) params.limit = opts.limit;
  if (opts.before !== undefined) params.before = opts.before;
  const response = await z.request({ url: '/api/messages', params });
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * Fetch one stored message with its attachments — `GET /api/messages/:id`.
 * @param {object} z - Zapier's z object.
 * @param {string} messageId - Message id (`msg_…`).
 * @returns {Promise<{message: object, attachments: object[]}>} Full row + attachments.
 */
async function getMessage(z, messageId) {
  const response = await z.request({ url: `/api/messages/${encodeURIComponent(messageId)}` });
  const data = response.data || {};
  return { message: data.message, attachments: data.attachments || [] };
}

/**
 * Turn a Zapier list field (array) or comma-separated string into what `/v1/send`
 * accepts for `to`/`cc`/`bcc`: one string when there is one recipient, an array when
 * there are several, undefined when empty.
 * @param {string|string[]|undefined} value - Raw input.
 * @returns {string|string[]|undefined} Normalised recipients.
 */
function toRecipients(value) {
  const raw = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  const list = raw.map((s) => String(s == null ? '' : s).trim()).filter((s) => s !== '');
  if (list.length === 0) return undefined;
  return list.length === 1 ? list[0] : list;
}

/**
 * Drop empty-string / null values from a Zapier dict field so a blank row is not sent.
 * @param {object|undefined} dict - A Zapier `dict: true` field value.
 * @returns {object|undefined} The dict without empty values, or undefined if nothing is left.
 */
function cleanDict(dict) {
  if (!dict || typeof dict !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(dict)) {
    const key = String(k).trim();
    if (key === '' || v === undefined || v === null || v === '') continue;
    out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Build the `POST /v1/send` body from a Send Email step's inputData. Only fields the user
 * actually set are included — omitting a field is meaningfully different from sending it
 * (tracking flags: omitted = domain default, explicit off = off), the same rule the n8n
 * node and Pipedream action pin.
 * @param {object} input - `bundle.inputData`.
 * @returns {object} The request body.
 */
function buildSendBody(input) {
  const body = {
    from: String(input.from || '').trim(),
    to: toRecipients(input.to),
  };

  const strings = {
    subject: 'subject',
    html: 'html',
    text: 'text',
    reply_to: 'replyTo',
    in_reply_to: 'inReplyTo',
    template_id: 'templateId',
    sequence: 'sequence',
    scheduled_at: 'scheduledAt',
  };
  for (const [inKey, outKey] of Object.entries(strings)) {
    const value = input[inKey];
    if (value === undefined || value === null) continue;
    const trimmed = String(value).trim();
    if (trimmed !== '') body[outKey] = trimmed;
  }

  for (const key of ['cc', 'bcc']) {
    const value = toRecipients(input[key]);
    if (value !== undefined) body[key] = value;
  }

  const dicts = {
    template_data: 'templateData',
    headers: 'headers',
    metadata: 'metadata',
    sequence_input: 'sequenceInput',
  };
  for (const [inKey, outKey] of Object.entries(dicts)) {
    const value = cleanDict(input[inKey]);
    if (value) body[outKey] = value;
  }

  if (input.track_opens === 'on') body.trackOpens = true;
  else if (input.track_opens === 'off') body.trackOpens = false;
  if (input.track_clicks === 'on') body.trackClicks = true;
  else if (input.track_clicks === 'off') body.trackClicks = false;

  // One attachment per step, by URL: MailKite fetches it at send time. Zapier hands a file
  // field over as a (time-limited) URL, so a `file` input maps straight onto `url`.
  const attachmentUrl = String(input.attachment || '').trim();
  if (attachmentUrl !== '') {
    const attachment = {
      filename: String(input.attachment_filename || '').trim() || 'attachment',
      url: attachmentUrl,
    };
    const contentType = String(input.attachment_content_type || '').trim();
    if (contentType !== '') attachment.contentType = contentType;
    body.attachments = [attachment];
  }

  return body;
}

module.exports = {
  BASE_URL,
  listDomains,
  getDomain,
  setWebhook,
  deleteWebhook,
  listMessages,
  getMessage,
  toRecipients,
  cleanDict,
  buildSendBody,
};
