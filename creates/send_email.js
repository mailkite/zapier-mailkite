'use strict';

const { buildSendBody } = require('../lib/api');

/**
 * Send Email — `POST /v1/send`. Field for field the published send-request schema
 * (sdks/spec/schemas/send-request.json), with the same omitted-vs-explicit rule for the
 * tracking flags that the n8n node and the Pipedream action pin.
 */
module.exports = {
  key: 'send_email',
  noun: 'Email',
  display: {
    label: 'Send Email',
    description: 'Sends an email from one of your verified MailKite domains.',
  },
  operation: {
    inputFields: [
      {
        key: 'from',
        label: 'From',
        required: true,
        type: 'string',
        helpText: 'An address on a verified MailKite domain, e.g. `hello@myapp.ai` or `Ada <ada@myapp.ai>`.',
      },
      {
        key: 'to',
        label: 'To',
        required: true,
        type: 'string',
        list: true,
        helpText: 'One recipient per line, or comma-separated.',
      },
      {
        key: 'subject',
        label: 'Subject',
        type: 'string',
        helpText: 'Required unless the template supplies one.',
      },
      { key: 'html', label: 'HTML Body', type: 'text' },
      { key: 'text', label: 'Plain-Text Body', type: 'text' },
      { key: 'cc', label: 'CC', type: 'string', list: true },
      { key: 'bcc', label: 'BCC', type: 'string', list: true },
      { key: 'reply_to', label: 'Reply-To', type: 'string' },
      {
        key: 'in_reply_to',
        label: 'In Reply To',
        type: 'string',
        helpText: 'A `threadId` from a received email, to answer in-thread.',
      },
      {
        key: 'template_id',
        label: 'Template ID',
        type: 'string',
        helpText: 'A saved template (`tpl_…` or `base_…`). Explicit subject/html/text here override it.',
      },
      {
        key: 'template_data',
        label: 'Template Data',
        dict: true,
        helpText: 'Values for the template\'s `{{merge_tags}}`.',
      },
      {
        key: 'headers',
        label: 'Extra Headers',
        dict: true,
        helpText: 'Extra raw MIME headers, e.g. `List-Unsubscribe`, `X-Entity-Ref-ID`.',
      },
      {
        key: 'metadata',
        label: 'Metadata',
        dict: true,
        helpText: 'Stored server-side on the message and echoed back on reads; never sent as headers.',
      },
      {
        key: 'sequence',
        label: 'Sequence',
        type: 'string',
        helpText: 'Name or ID of an ACTIVE sequence to enrol the recipient in when the send succeeds.',
      },
      { key: 'sequence_input', label: 'Sequence Input', dict: true },
      {
        key: 'scheduled_at',
        label: 'Send At',
        type: 'string',
        helpText: 'Send later: ISO 8601, or simple relative text like `in 2 hours`. Leave empty to send now.',
      },
      {
        key: 'track_opens',
        label: 'Track Opens',
        choices: { default: 'Use domain default', on: 'On', off: 'Off' },
        default: 'default',
        helpText: 'HTML only. Leave on the domain default unless this send needs an override.',
      },
      {
        key: 'track_clicks',
        label: 'Track Clicks',
        choices: { default: 'Use domain default', on: 'On', off: 'Off' },
        default: 'default',
        helpText: 'HTML only. Leave on the domain default unless this send needs an override.',
      },
      {
        key: 'attachment',
        label: 'Attachment',
        type: 'file',
        helpText: 'One file, fetched by MailKite at send time.',
      },
      { key: 'attachment_filename', label: 'Attachment Filename', type: 'string' },
      {
        key: 'attachment_content_type',
        label: 'Attachment Content Type',
        type: 'string',
        helpText: 'MIME type; defaults to application/octet-stream.',
      },
    ],
    perform: async (z, bundle) => {
      const body = buildSendBody(bundle.inputData);
      if (!body.from) {
        throw new z.errors.Error('From is required.', 'InvalidInput', 400);
      }
      if (body.to === undefined) {
        throw new z.errors.Error('At least one To recipient is required.', 'InvalidInput', 400);
      }
      const response = await z.request({ method: 'POST', url: '/v1/send', body });
      return response.data;
    },
    sample: {
      id: 'msg_minimal',
      status: 'queued',
    },
    outputFields: [
      { key: 'id', label: 'Message ID', type: 'string' },
      { key: 'status', label: 'Status', type: 'string' },
      { key: 'scheduledAt', label: 'Scheduled At (ms epoch)', type: 'integer' },
    ],
  },
};
