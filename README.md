# zapier-mailkite

Zapier integration for [MailKite](https://mailkite.dev) — send email from a verified
domain with one step, and start Zaps when email arrives at your domain.

Built with the [Zapier Platform CLI](https://github.com/zapier/zapier-platform).

## What it does

| Kind | Key | What it calls |
|---|---|---|
| Authentication | `custom` (API key) | `GET /api/domains` as the connection test |
| Trigger (REST hook) | `new_inbound_email` — **New Inbound Email** | `PUT /api/domains/:id/webhook` on subscribe (restores the previous webhook on unsubscribe); verifies `x-mailkite-signature` (HMAC-SHA256 over the raw body, 5-minute freshness window) on every delivery; samples from `GET /api/messages` mapped into the exact `email.received` webhook shape |
| Trigger (hidden) | `domain` | `GET /api/domains`, MX-verified only — feeds the Domain dropdown |
| Create | `send_email` — **Send Email** | `POST /v1/send`, field for field the published send-request schema |

The endpoints, the payload builder and the signature verifier are the same ones the
[n8n community node](https://github.com/mailkite/n8n-nodes-mailkite) and the
[Pipedream components](https://github.com/mailkite/pipedream) use, so the three
integrations behave identically.

## Develop

```sh
npm install
npm test                       # jest — unit tests + appTester runs against nock'd HTTP
npm run validate               # zapier-platform validate --without-style: local schema validation, no Zapier account needed
```

Everything past `validate` (`zapier register`, `zapier push`, inviting testers, submitting
for public listing) needs a Zapier developer account and is done by a human.

## Notes

- A MailKite domain has one catch-all webhook. Turning the trigger on takes it over; the
  previous webhook URL and ack mode are stored in `subscribeData` and put back when the Zap is
  turned off (or the route is deleted if there was none).
- Zapier answers every hook with a plain 200, so the route is registered in `lenient` ack mode.
- Signature verification is on by default with the secret MailKite returns at subscribe time.
  The optional **Webhook Signing Secret Override** field only replaces it (e.g. after rotation).
- Tracking flags are tri-state: *Use domain default* omits the field, *On*/*Off* send an
  explicit boolean — omitted and explicit-off are different things to the API.

## License

MIT
