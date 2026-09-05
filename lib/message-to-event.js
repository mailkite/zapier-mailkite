'use strict';

// Turn a stored MailKite message into the exact `email.received` event body the webhook
// delivers, so a sample fetched by performList and a live hook delivery are the same shape.
//
// Ported verbatim (ESM → CJS) from the Pipedream components' `common/message-to-event.mjs`,
// which targets `buildWebhookPayload()` in MailKite's api/src/index.ts, published as
// sdks/spec/schemas/email-received-event.json. That schema is `additionalProperties: false`
// on the event AND on each attachment, so mapping is mostly dropping REST-only extras.

/** Every field the published event schema defines, in emission order. */
const EVENT_FIELDS = [
  'id',
  'type',
  'from',
  'to',
  'subject',
  'text',
  'html',
  'threadId',
  'receivedAt',
  'receivedAtIso',
  'auth',
  'attachments',
];

/** The only attachment fields the schema allows. */
const EVENT_ATTACHMENT_FIELDS = ['id', 'filename', 'contentType', 'size', 'url', 'content'];

/**
 * Normalize one address to the event's `{ address, name? }` shape. `name` is OMITTED,
 * never null, when unknown.
 * @param {object|string} addr - A structured address from the API, or a bare string.
 * @returns {{address: string, name?: string}} The event address.
 */
function toEventAddress(addr) {
  const address = typeof addr === 'string' ? addr : addr && addr.address;
  if (typeof address !== 'string' || !address) {
    throw new TypeError('cannot map an address with no `address`');
  }
  const name = typeof addr === 'object' && addr ? addr.name : undefined;
  return typeof name === 'string' && name ? { address, name } : { address };
}

/**
 * Map one attachment from `GET /api/messages/:id` onto the webhook's attachment shape.
 * Drops `contentId` / `disposition`; keeps exactly one of `url` / `content`.
 * @param {object} att - An attachment as the detail endpoint returns it.
 * @returns {object} The attachment as the webhook sends it.
 */
function toEventAttachment(att) {
  const a = att || {};
  const out = {
    filename: a.filename === undefined ? null : a.filename,
    contentType: a.contentType === undefined ? null : a.contentType,
    size: Number(a.size == null ? 0 : a.size),
  };
  if (typeof a.id === 'string' && a.id) out.id = a.id;
  if (typeof a.url === 'string' && a.url) out.url = a.url;
  else if (typeof a.content === 'string') out.content = a.content;
  return out;
}

/**
 * Build an `email.received` event from a stored message plus its attachments.
 * @param {object} message - The stored message row (`GET /api/messages/:id` → `message`).
 * @param {object[]} [attachments=[]] - Its attachments, from the same detail response.
 * @returns {object} An event body matching sdks/spec/schemas/email-received-event.json.
 */
function toEmailReceivedEvent(message, attachments = []) {
  if (!message || !message.id) {
    throw new TypeError('cannot map a message with no `id`');
  }
  // `Number(null)` is 0, not NaN — a null timestamp must be rejected, not mapped to 1970.
  const rawTs = message.received_at;
  const receivedAt =
    typeof rawTs === 'number'
      ? rawTs
      : typeof rawTs === 'string' && rawTs.trim()
        ? Number(rawTs)
        : NaN;
  if (!Number.isFinite(receivedAt)) {
    throw new TypeError(`message ${message.id} has no usable \`received_at\``);
  }
  const to = (Array.isArray(message.to) && message.to.length ? message.to : [message.to_addr]).map(
    toEventAddress,
  );
  return {
    id: message.id,
    type: 'email.received',
    from: toEventAddress(message.from === undefined ? message.from_addr : message.from),
    to,
    subject: message.subject === undefined ? null : message.subject,
    text: message.text_body === undefined ? null : message.text_body,
    html: message.html_body === undefined ? null : message.html_body,
    threadId: message.thread_id === undefined ? null : message.thread_id,
    receivedAt,
    receivedAtIso: new Date(receivedAt).toISOString(),
    auth: {
      spf: message.spf === undefined ? null : message.spf,
      dkim: message.dkim === undefined ? null : message.dkim,
      dmarc: message.dmarc === undefined ? null : message.dmarc,
      spam: message.spam === undefined ? null : message.spam,
    },
    attachments: (attachments || []).map(toEventAttachment),
  };
}

module.exports = {
  EVENT_FIELDS,
  EVENT_ATTACHMENT_FIELDS,
  toEventAddress,
  toEventAttachment,
  toEmailReceivedEvent,
};
