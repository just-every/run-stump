Put Stump on your own Cloudflare account so your team can sign in from anywhere. Your data stays in your account's own database.

## Deploy

From your checkout:

```sh
rer deploy
```

`rer setup` lists what a deploy still needs before it can run: the Cloudflare account ID and an API token, and the secrets the app reads, such as the owner's email and the mail provider's key. Nothing is deployed until those are in place.

### Before you deploy

- **Stop the local app first.** `rer deploy`, `rer deploy --dry-run`, `rer export` and `rer import` each need the installation to themselves, so while `rer dev` runs they stop with "An active local operation owns the state". Stop it with Ctrl-C in its terminal, or `rer dev --stop`, then run the deploy.
- **Set your sender.** Sign-in links and invitations go out from `MAIL_FROM`, a real address on your mail provider's verified domain, bare or with a display name (`Display Name <address>`). Set it in your environment or an owned `--env-file`, beside `MAIL_API_KEY`; nothing in the checkout changes. `rer deploy --dry-run` names it while it is missing, and a real deploy refuses a placeholder address.
- **Your mail provider's key** goes in `MAIL_API_KEY` (in your environment or an owned `--env-file`, never in a tracked file). `MAIL_PROVIDER` in `deploy.json` names the provider, `resend` by default.
- Cloudflare needs `CLOUDFLARE_ACCOUNT_ID` and an API token, `CLOUDFLARE_API_TOKEN`, with Workers Scripts: Edit and D1: Edit.

`rer deploy --dry-run` then builds and prints the Worker, its database and migrations, its secrets and the scheduled check, and changes nothing.

## After the deploy

- Sign in as the owner from the deployed address, and confirm the owner account.
- [Invite your team](/docs/team), each with their role and their connection to the company.
- [Set up each network's app](/docs/accounts) with your own keys, then connect accounts.

## Scheduled posts

The deployed app checks for due posts every minute. A [Pause](/docs/pause) stops every scheduled post until someone resumes.
