'use strict';

const { getDomain, setWebhook, deleteWebhook, listMessages, getMessage } = require('../lib/api');
const { toEmailReceivedEvent } = require('../lib/message-to-event');
const { verifySignature } = require('../lib/verify-signature');

// performList bounds. Zapier only needs a few samples; `/api/messages` has no domain or
// direction filter, so they are selected client-side out of pages of the account's newest
// mail — hence a page size and a page cap.
const SAMPLE_LIMIT = 3;
const SAMPLE_PAGE_SIZE = 200; // the API's maximum `limit`
const SAMPLE_MAX_PAGES = 3;

const SAMPLE_EVENT = {
  id: 'msg_2Hk9QpVn4tLd',
  type: 'email.received',
  from: { address: 'ada@example.com', name: 'Ada Lovelace' },
  to: [{ address: 'support@myapp.ai', name: 'Support' }],
  subject: 'Question about my invoice',
  text: 'Hi — could you resend invoice #1042?',
  html: '<p>Hi — could you resend invoice #1042?</p>',
  threadId: '<CAF1042@mail.example.com>',
  receivedAt: 1785196800000,
  receivedAtIso: '2026-07-28T00:00:00.000Z',
  auth: { spf: 'pass', dkim: 'pass', dmarc: 'pass', spam: 'ham' },
  attachments: [],
};

/**
 * REST-hook subscribe: take over the domain's single catch-all webhook. Whatever the domain
 * pointed at before is stashed in subscribeData so performUnsubscribe can restore it instead
 * of dropping the user's existing wiring. Zapier always answers a hook with a plain 200, so
 * the route is registered in `lenient` mode (any 2xx acknowledges).
 */
async function performSubscribe(z, bundle) {
  const domainId = bundle.inputData.domain_id;
  const incumbent = await getDomain(z, domainId);
  const incumbentWebhook =
    incumbent && incumbent.webhookUrl
      ? { url: incumbent.webhookUrl, ackMode: incumbent.webhookAckMode || 'lenient' }
      : null;

  const signingSecret = await setWebhook(z, domainId, {
    url: bundle.targetUrl,
    ackMode: 'lenient',
  });
  if (!signingSecret) {
    throw new z.errors.Error(
      'MailKite did not return a signing secret when registering the webhook.',
      'SubscribeFailed',
      502,
    );
  }
  return { domainId, signingSecret, incumbentWebhook };
}

/** REST-hook unsubscribe: put back the incumbent webhook, or delete ours if there was none. */
async function performUnsubscribe(z, bundle) {
  const data = bundle.subscribeData || {};
  const domainId = data.domainId || bundle.inputData.domain_id;
  if (data.incumbentWebhook && data.incumbentWebhook.url) {
    await setWebhook(z, domainId, data.incumbentWebhook);
  } else {
    await deleteWebhook(z, domainId);
  }
  return { domainId };
}

/**
 * Live delivery.
 *
 * MailKite signs every delivery, and we verify that signature over the exact bytes it signed.
 * Zapier does not promise those bytes survive its transport: for REST hooks the runtime is
 * handed a body the platform has already parsed (and can re-serialise), so an HMAC recomputed
 * here legitimately does not match the wire bytes. Dropping the event in that case makes the
 * trigger look dead — which is exactly what happened before this fallback existed.
 *
 * So verification is best-effort, in order:
 *   1. the raw body, when Zapier exposes it;
 *   2. the canonical re-serialisation of the parsed event (query string stripped);
 *   3. otherwise accept, with a console warning, because the delivery already arrived on this
 *      Zap's unguessable hook URL — the same trust model every Zapier hook trigger uses.
 *
 * A wrong or stale signature is never *rejected* outright; it is reported so it shows up in
 * Monitoring → Console, and the override field remains the way to pin a known secret.
 */
async function perform(z, bundle) {
  const override = String((bundle.inputData && bundle.inputData.webhook_secret) || '').trim();
  const secret = override || (bundle.subscribeData && bundle.subscribeData.signingSecret);
  const raw = bundle.rawRequest || {};
  const headers = raw.headers || {};
  const signature = headers['x-mailkite-signature'] || headers['X-Mailkite-Signature'];
  const hasRawBody = raw.content !== undefined && raw.content !== null;

  // Zapier merges the URL query string into cleanedRequest; it is not part of what MailKite signed.
  const { querystring: _querystring, ...body } = bundle.cleanedRequest || {};
  const event = body && body.type === 'email.received' && body.id ? body : null;

  if (secret && event) {
    let verified = hasRawBody ? verifySignature(secret, signature, raw.content) : false;
    if (!verified) {
      verified = verifySignature(secret, signature, JSON.stringify(event));
    }
    if (!verified) {
      z.console.log(
        `Warning: x-mailkite-signature did not verify over the ${hasRawBody ? 'raw' : 're-serialised'} body ` +
          `(${signature ? 'header present' : 'header missing'}); accepting because the delivery reached this Zap's private hook URL`,
      );
    }
  } else if (secret && !event) {
    z.console.log('Ignored delivery: not an email.received event');
  }

  if (!event) return [];
  return [event];
}

/**
 * Samples for the Zap editor: the newest inbound messages to the chosen domain, mapped into
 * the exact webhook event shape. Encrypted-at-rest rows are skipped (their bodies cannot be
 * read back through the API).
 */
async function performList(z, bundle) {
  const domainId = bundle.inputData.domain_id;
  const domain = await getDomain(z, domainId);
  const suffix = `@${String((domain && domain.domain) || '').toLowerCase()}`;
  const selected = [];
  const seen = new Set();
  let before;
  for (let page = 0; page < SAMPLE_MAX_PAGES && selected.length < SAMPLE_LIMIT; page++) {
    const rows = await listMessages(z, { limit: SAMPLE_PAGE_SIZE, before });
    if (!rows.length) break;
    let fresh = 0;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      fresh++;
      if (selected.length >= SAMPLE_LIMIT) continue;
      if (row.direction !== 'inbound') continue;
      if (!String(row.to_addr || '').toLowerCase().endsWith(suffix)) continue;
      if (row.enc_key_fp) continue;
      selected.push(row);
    }
    if (!fresh || rows.length < SAMPLE_PAGE_SIZE) break;
    before = rows[rows.length - 1].received_at + 1;
  }

  const events = [];
  for (const row of selected) {
    try {
      const { message, attachments } = await getMessage(z, row.id);
      events.push(toEmailReceivedEvent(message, attachments));
    } catch (err) {
      z.console.log(`Skipped ${row.id} while fetching samples: ${err.message}`);
    }
  }
  return events;
}

module.exports = {
  key: 'new_inbound_email',
  noun: 'Inbound Email',
  display: {
    label: 'New Inbound Email',
    description:
      'Triggers when an email arrives at a verified MailKite domain. A domain has a single catch-all webhook, so turning this Zap on takes it over; whatever the domain pointed at before is restored when the Zap is turned off.',
  },
  operation: {
    type: 'hook',
    inputFields: [
      {
        key: 'domain_id',
        label: 'Domain',
        required: true,
        dynamic: 'domain.id.domain',
        helpText: 'The MX-verified MailKite domain to receive email for.',
      },
      {
        key: 'webhook_secret',
        label: 'Webhook Signing Secret Override',
        type: 'password',
        helpText:
          'Signature verification (HMAC-SHA256) is on by default using the secret MailKite issues when this Zap registers its webhook — no setup needed. Set this only to override it (e.g. after rotating it in the MailKite dashboard).',
      },
    ],
    performSubscribe,
    performUnsubscribe,
    perform,
    performList,
    sample: SAMPLE_EVENT,
    outputFields: [
      { key: 'id', label: 'Message ID', type: 'string' },
      { key: 'from__address', label: 'From Address', type: 'string' },
      { key: 'from__name', label: 'From Name', type: 'string' },
      { key: 'subject', label: 'Subject', type: 'string' },
      { key: 'text', label: 'Plain-Text Body', type: 'string' },
      { key: 'html', label: 'HTML Body', type: 'string' },
      { key: 'threadId', label: 'Thread ID', type: 'string' },
      { key: 'receivedAtIso', label: 'Received At', type: 'datetime' },
      { key: 'auth__spf', label: 'SPF', type: 'string' },
      { key: 'auth__dkim', label: 'DKIM', type: 'string' },
      { key: 'auth__dmarc', label: 'DMARC', type: 'string' },
      { key: 'auth__spam', label: 'Spam Verdict', type: 'string' },
    ],
  },
};
