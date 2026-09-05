'use strict';

const { listDomains } = require('./lib/api');

/**
 * Custom auth: one API key, sent as `Authorization: Bearer <key>` by the beforeRequest
 * middleware in index.js. The test hits `GET /api/domains` — the lightest authenticated
 * endpoint; a bad key 401s, so the test is real.
 */
module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'api_key',
      label: 'API Key',
      required: true,
      type: 'password',
      helpText:
        'Your MailKite API key (starts with `mk_live_`). Create one in the [MailKite dashboard](https://app.mailkite.dev) under Settings → API Keys.',
    },
  ],
  test: async (z, bundle) => {
    const domains = await listDomains(z);
    return { domains: domains.length };
  },
  connectionLabel: (z, bundle) =>
    bundle.inputData && bundle.inputData.domains !== undefined
      ? `MailKite (${bundle.inputData.domains} domain${bundle.inputData.domains === 1 ? '' : 's'})`
      : 'MailKite',
};
