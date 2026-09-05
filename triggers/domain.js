'use strict';

const { listDomains } = require('../lib/api');

/**
 * Hidden trigger that feeds the "Domain" dynamic dropdown. Only MX-verified domains are
 * offered — that is the gate for inbound mail and webhooks. Sending needs a verified
 * domain too, so the same list serves both the trigger and the Send Email create.
 */
module.exports = {
  key: 'domain',
  noun: 'Domain',
  display: {
    label: 'New Domain',
    description: 'Lists your verified MailKite domains (used for dropdowns).',
    hidden: true,
  },
  operation: {
    perform: async (z, bundle) => {
      const domains = await listDomains(z);
      return domains
        .filter((d) => d && d.id && Number(d.mx_verified) === 1)
        .map((d) => ({
          id: d.id,
          domain: d.domain,
          status: d.status,
          mx_verified: true,
        }));
    },
    sample: {
      id: 'dom_2VbXqTpN8rKw',
      domain: 'myapp.ai',
      status: 'verified',
      mx_verified: true,
    },
  },
};
