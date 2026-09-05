'use strict';

const { version: platformVersion } = require('zapier-platform-core');
const { version } = require('./package.json');
const authentication = require('./authentication');
const { BASE_URL } = require('./lib/api');
const sendEmail = require('./creates/send_email');
const newInboundEmail = require('./triggers/new_inbound_email');
const domain = require('./triggers/domain');

/** Prefix relative URLs with the API base and attach the Bearer key. */
const addAuthAndBase = (request, z, bundle) => {
  if (request.url && request.url.startsWith('/')) {
    request.url = `${BASE_URL}${request.url}`;
  }
  request.headers = request.headers || {};
  request.headers.Accept = 'application/json';
  if (bundle.authData && bundle.authData.api_key) {
    request.headers.Authorization = `Bearer ${bundle.authData.api_key}`;
  }
  return request;
};

/** Turn MailKite's error envelope into a readable Zapier error. */
const handleErrors = (response, z) => {
  if (response.status === 401 || response.status === 403) {
    throw new z.errors.Error(
      'MailKite rejected the API key. Check it in the MailKite dashboard under Settings → API Keys.',
      'AuthenticationError',
      response.status,
    );
  }
  if (response.status >= 400) {
    const data = response.data || {};
    const message = data.error || data.message || response.content || `HTTP ${response.status}`;
    throw new z.errors.Error(`MailKite API error: ${message}`, 'APIError', response.status);
  }
  return response;
};

module.exports = {
  version,
  platformVersion,
  authentication,
  beforeRequest: [addAuthAndBase],
  afterResponse: [handleErrors],
  triggers: {
    [newInboundEmail.key]: newInboundEmail,
    [domain.key]: domain,
  },
  creates: {
    [sendEmail.key]: sendEmail,
  },
};
