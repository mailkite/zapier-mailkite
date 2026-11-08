'use strict';

const crypto = require('crypto');
const nock = require('nock');
const zapier = require('zapier-platform-core');
const App = require('../index');

const appTester = zapier.createAppTester(App);
zapier.tools.env.inject();

const BASE = 'https://api.mailkite.dev';
const authData = { api_key: 'mk_live_test' };
const DOMAIN = { id: 'dom_1', domain: 'myapp.ai', status: 'verified', mx_verified: 1, webhookUrl: null, webhookAckMode: null };

beforeEach(() => nock.disableNetConnect());
afterEach(() => {
  expect(nock.isDone()).toBe(true);
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('authentication', () => {
  test('test hits GET /api/domains with the Bearer key', async () => {
    nock(BASE, { reqheaders: { authorization: 'Bearer mk_live_test' } })
      .get('/api/domains')
      .reply(200, [DOMAIN, { ...DOMAIN, id: 'dom_2', mx_verified: 0 }]);
    const result = await appTester(App.authentication.test, { authData });
    expect(result).toEqual({ domains: 2 });
  });
  test('a rejected key becomes a readable error', async () => {
    nock(BASE).get('/api/domains').reply(401, { error: 'unauthorized' });
    await expect(appTester(App.authentication.test, { authData })).rejects.toThrow(/rejected the API key/);
  });
});

describe('domain dropdown', () => {
  test('only MX-verified domains are offered', async () => {
    nock(BASE).get('/api/domains').reply(200, [DOMAIN, { ...DOMAIN, id: 'dom_2', domain: 'pending.ai', mx_verified: 0 }]);
    const rows = await appTester(App.triggers.domain.operation.perform, { authData });
    expect(rows).toEqual([{ id: 'dom_1', domain: 'myapp.ai', status: 'verified', mx_verified: true }]);
  });
});

describe('send_email', () => {
  test('POSTs the schema-shaped body and returns the send response', async () => {
    let sent;
    nock(BASE)
      .post('/v1/send', (body) => {
        sent = body;
        return true;
      })
      .reply(202, { id: 'msg_minimal', status: 'queued' });
    const result = await appTester(App.creates.send_email.operation.perform, {
      authData,
      inputData: { from: 'hello@app.mailkite.dev', to: ['ada@example.com'], subject: 'Hi', text: 'It works.', track_opens: 'default', track_clicks: 'off' },
    });
    expect(result).toEqual({ id: 'msg_minimal', status: 'queued' });
    expect(sent).toEqual({ from: 'hello@app.mailkite.dev', to: 'ada@example.com', subject: 'Hi', text: 'It works.', trackClicks: false });
  });
  test('surfaces the API error message', async () => {
    nock(BASE).post('/v1/send').reply(400, { error: 'from must be on a verified domain' });
    await expect(
      appTester(App.creates.send_email.operation.perform, { authData, inputData: { from: 'x@nope.io', to: ['a@b.io'] } }),
    ).rejects.toThrow(/from must be on a verified domain/);
  });
  test('refuses to send with no recipient without touching the API', async () => {
    await expect(
      appTester(App.creates.send_email.operation.perform, { authData, inputData: { from: 'x@nope.io', to: [' '] } }),
    ).rejects.toThrow(/At least one To recipient/);
  });
});

describe('new_inbound_email', () => {
  const op = App.triggers.new_inbound_email.operation;
  const targetUrl = 'https://hooks.zapier.com/hooks/standard/1/abc/';

  test('subscribe stashes the incumbent webhook and returns the signing secret', async () => {
    nock(BASE).get('/api/domains/dom_1').reply(200, { domain: { ...DOMAIN, webhookUrl: 'https://old.example/hook', webhookAckMode: 'ack' }, dns: [] });
    nock(BASE)
      .put('/api/domains/dom_1/webhook', { url: targetUrl, ackMode: 'lenient' })
      .reply(200, { webhookUrl: targetUrl, signingSecret: 'whsec_abc' });
    const data = await appTester(op.performSubscribe, { authData, targetUrl, inputData: { domain_id: 'dom_1' } });
    expect(data).toEqual({ domainId: 'dom_1', signingSecret: 'whsec_abc', incumbentWebhook: { url: 'https://old.example/hook', ackMode: 'ack' } });
  });

  test('unsubscribe restores the incumbent, or deletes when there was none', async () => {
    nock(BASE).put('/api/domains/dom_1/webhook', { url: 'https://old.example/hook', ackMode: 'ack' }).reply(200, { webhookUrl: 'https://old.example/hook', signingSecret: 'whsec_x' });
    await appTester(op.performUnsubscribe, { authData, inputData: { domain_id: 'dom_1' }, subscribeData: { domainId: 'dom_1', signingSecret: 'whsec_abc', incumbentWebhook: { url: 'https://old.example/hook', ackMode: 'ack' } } });

    nock(BASE).delete('/api/domains/dom_1/webhook').reply(200, { ok: true });
    await appTester(op.performUnsubscribe, { authData, inputData: { domain_id: 'dom_1' }, subscribeData: { domainId: 'dom_1', signingSecret: 'whsec_abc', incumbentWebhook: null } });
  });

  test('perform emits a verified email.received and drops anything else', async () => {
    const event = { ...op.sample };
    const content = JSON.stringify(event);
    const t = Date.now();
    const v1 = crypto.createHmac('sha256', 'whsec_abc').update(`${t}.${content}`).digest('hex');
    const bundle = (sig, body = content, cleaned = event) => ({
      authData,
      inputData: { domain_id: 'dom_1' },
      subscribeData: { domainId: 'dom_1', signingSecret: 'whsec_abc', incumbentWebhook: null },
      cleanedRequest: cleaned,
      rawRequest: { method: 'POST', headers: { 'x-mailkite-signature': sig }, querystring: '', content: body },
    });
    expect(await appTester(op.perform, bundle(`t=${t},v1=${v1}`))).toEqual([event]);
    expect(await appTester(op.perform, bundle(`t=${t},v1=${'0'.repeat(64)}`))).toEqual([]);
    expect(await appTester(op.perform, bundle(undefined))).toEqual([]);
    const other = { ...event, type: 'email.bounced' };
    const otherBody = JSON.stringify(other);
    const v1b = crypto.createHmac('sha256', 'whsec_abc').update(`${t}.${otherBody}`).digest('hex');
    expect(await appTester(op.perform, bundle(`t=${t},v1=${v1b}`, otherBody, other))).toEqual([]);
  });

  // Zapier's hook pipeline sometimes hands over only the parsed body. The trigger must still
  // emit the event (it cannot recompute the HMAC without the raw bytes), otherwise every live
  // delivery is silently dropped.
  test('perform accepts the parsed event when Zapier omits the raw body', async () => {
    const event = { ...op.sample };
    const result = await appTester(op.perform, {
      authData,
      inputData: { domain_id: 'dom_1' },
      subscribeData: { domainId: 'dom_1', signingSecret: 'whsec_abc', incumbentWebhook: null },
      cleanedRequest: event,
      rawRequest: { method: 'POST', headers: {}, querystring: '' },
    });
    expect(result).toEqual([event]);
  });

  test('performList maps inbound rows for the chosen domain into events', async () => {
    nock(BASE).get('/api/domains/dom_1').reply(200, { domain: DOMAIN, dns: [] });
    nock(BASE)
      .get('/api/messages')
      .query({ limit: 200 })
      .reply(200, [
        { id: 'msg_out', direction: 'outbound', to_addr: 'x@other.io', received_at: 3 },
        { id: 'msg_enc', direction: 'inbound', to_addr: 'a@myapp.ai', received_at: 2, enc_key_fp: 'fp' },
        { id: 'msg_in', direction: 'inbound', to_addr: 'support@myapp.ai', received_at: 1785196800000 },
      ]);
    nock(BASE).get('/api/messages/msg_in').reply(200, {
      message: { id: 'msg_in', from: { address: 'ada@example.com' }, to: [{ address: 'support@myapp.ai' }], subject: 'Hi', text_body: 'hello', received_at: 1785196800000, spf: 'pass' },
      attachments: [],
    });
    const events = await appTester(op.performList, { authData, inputData: { domain_id: 'dom_1' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: 'msg_in', type: 'email.received', subject: 'Hi', text: 'hello', receivedAtIso: '2026-07-28T00:00:00.000Z', auth: { spf: 'pass', dkim: null, dmarc: null, spam: null }, attachments: [] });
  });
});
