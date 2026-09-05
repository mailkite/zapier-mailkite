'use strict';

const crypto = require('crypto');
const { buildSendBody, toRecipients, cleanDict } = require('../lib/api');
const { toEmailReceivedEvent, toEventAttachment } = require('../lib/message-to-event');
const { verifySignature } = require('../lib/verify-signature');

describe('toRecipients', () => {
  test('one recipient stays a string, several become an array', () => {
    expect(toRecipients(['a@x.io'])).toBe('a@x.io');
    expect(toRecipients(['a@x.io', 'b@x.io'])).toEqual(['a@x.io', 'b@x.io']);
    expect(toRecipients('a@x.io, b@x.io')).toEqual(['a@x.io', 'b@x.io']);
  });
  test('blank input is undefined', () => {
    expect(toRecipients(undefined)).toBeUndefined();
    expect(toRecipients([' ', ''])).toBeUndefined();
  });
});

describe('cleanDict', () => {
  test('drops empty rows and returns undefined when nothing is left', () => {
    expect(cleanDict({ a: '1', b: '', ' ': 'x', c: null })).toEqual({ a: '1' });
    expect(cleanDict({ b: '' })).toBeUndefined();
    expect(cleanDict(undefined)).toBeUndefined();
  });
});

describe('buildSendBody', () => {
  test('minimal send carries only from/to and the set fields', () => {
    const body = buildSendBody({ from: 'hello@app.mailkite.dev', to: ['ada@example.com'], subject: 'Hi', text: 'It works.' });
    expect(body).toEqual({ from: 'hello@app.mailkite.dev', to: 'ada@example.com', subject: 'Hi', text: 'It works.' });
  });
  test('tracking flags: default is omitted, on/off are explicit booleans', () => {
    expect(buildSendBody({ from: 'a@x.io', to: ['b@x.io'], track_opens: 'default', track_clicks: 'default' })).not.toHaveProperty('trackOpens');
    const body = buildSendBody({ from: 'a@x.io', to: ['b@x.io'], track_opens: 'on', track_clicks: 'off' });
    expect(body.trackOpens).toBe(true);
    expect(body.trackClicks).toBe(false);
  });
  test('maps snake_case inputs to the schema keys and cleans dicts', () => {
    const body = buildSendBody({
      from: 'a@x.io',
      to: ['b@x.io', 'c@x.io'],
      cc: 'd@x.io',
      reply_to: 'r@x.io',
      in_reply_to: '<t@x>',
      template_id: 'tpl_1',
      template_data: { name: 'Ann', empty: '' },
      headers: { 'X-Tag': 'zap' },
      metadata: {},
      sequence: 'dunning',
      sequence_input: { invoiceId: 'inv_1' },
      scheduled_at: 'in 2 hours',
    });
    expect(body).toEqual({
      from: 'a@x.io',
      to: ['b@x.io', 'c@x.io'],
      cc: 'd@x.io',
      replyTo: 'r@x.io',
      inReplyTo: '<t@x>',
      templateId: 'tpl_1',
      templateData: { name: 'Ann' },
      headers: { 'X-Tag': 'zap' },
      sequence: 'dunning',
      sequenceInput: { invoiceId: 'inv_1' },
      scheduledAt: 'in 2 hours',
    });
  });
  test('one attachment by URL', () => {
    const body = buildSendBody({ from: 'a@x.io', to: ['b@x.io'], attachment: 'https://zapier.com/hydrate/x', attachment_filename: 'po.pdf', attachment_content_type: 'application/pdf' });
    expect(body.attachments).toEqual([{ filename: 'po.pdf', url: 'https://zapier.com/hydrate/x', contentType: 'application/pdf' }]);
    expect(buildSendBody({ from: 'a@x.io', to: ['b@x.io'], attachment_filename: 'x' })).not.toHaveProperty('attachments');
  });
});

describe('toEmailReceivedEvent', () => {
  const row = {
    id: 'msg_1',
    user_id: 'usr_1',
    direction: 'inbound',
    from: { address: 'ada@example.com', name: 'Ada' },
    to: [{ address: 'support@myapp.ai' }],
    subject: 'Hi',
    text_body: 'hello',
    html_body: null,
    thread_id: '<t@x>',
    received_at: 1785196800000,
    spf: 'pass',
    dkim: 'pass',
    dmarc: null,
    spam: 'ham',
  };
  test('maps a detail row onto the published event shape', () => {
    const event = toEmailReceivedEvent(row, [{ id: 'msg_1:0', filename: 'a.pdf', contentType: 'application/pdf', size: 10, url: 'https://x/att', contentId: 'drop', disposition: 'drop' }]);
    expect(event).toEqual({
      id: 'msg_1',
      type: 'email.received',
      from: { address: 'ada@example.com', name: 'Ada' },
      to: [{ address: 'support@myapp.ai' }],
      subject: 'Hi',
      text: 'hello',
      html: null,
      threadId: '<t@x>',
      receivedAt: 1785196800000,
      receivedAtIso: '2026-07-28T00:00:00.000Z',
      auth: { spf: 'pass', dkim: 'pass', dmarc: null, spam: 'ham' },
      attachments: [{ id: 'msg_1:0', filename: 'a.pdf', contentType: 'application/pdf', size: 10, url: 'https://x/att' }],
    });
  });
  test('falls back to raw address columns and rejects a null timestamp', () => {
    const event = toEmailReceivedEvent({ id: 'msg_2', from_addr: 'a@x.io', to_addr: 'b@myapp.ai', received_at: '1785196800000' });
    expect(event.from).toEqual({ address: 'a@x.io' });
    expect(event.to).toEqual([{ address: 'b@myapp.ai' }]);
    expect(() => toEmailReceivedEvent({ id: 'msg_3', from_addr: 'a@x.io', to_addr: 'b@x.io', received_at: null })).toThrow(/received_at/);
  });
  test('inlined attachment keeps content, not url', () => {
    expect(toEventAttachment({ filename: 'f', contentType: 't', size: 1, content: 'AA==' })).toEqual({ filename: 'f', contentType: 't', size: 1, content: 'AA==' });
  });
});

describe('verifySignature', () => {
  const secret = 'whsec_test';
  const body = '{"type":"email.received","id":"msg_1"}';
  const sign = (t, b = body, s = secret) => `t=${t},v1=${crypto.createHmac('sha256', s).update(`${t}.${b}`).digest('hex')}`;

  test('accepts a fresh, authentic signature', () => {
    expect(verifySignature(secret, sign(Date.now()), body)).toBe(true);
  });
  test('rejects tampered body, wrong secret, stale timestamp, malformed header', () => {
    const t = Date.now();
    expect(verifySignature(secret, sign(t), body + ' ')).toBe(false);
    expect(verifySignature(secret, sign(t, body, 'other'), body)).toBe(false);
    expect(verifySignature(secret, sign(t - 6 * 60 * 1000), body)).toBe(false);
    expect(verifySignature(secret, sign(t + 6 * 60 * 1000), body)).toBe(false);
    expect(verifySignature(secret, undefined, body)).toBe(false);
    expect(verifySignature(secret, 'v1=abc', body)).toBe(false);
    expect(verifySignature(secret, `t=${t},v1=zz`, body)).toBe(false);
  });
  test('tolerance 0 disables the freshness check', () => {
    expect(verifySignature(secret, sign(1000), body, 0)).toBe(true);
  });
});
