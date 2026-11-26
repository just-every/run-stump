Put Stump on your own Cloudflare account so your team can sign in from anywhere. Your data stays in your account's own database.

## Deploy

From your checkout:

```sh
rer deploy
```

Nothing is deployed until everything below is in place, and `rer deploy --dry-run` lists whatever is still missing.

### What rer makes for you

- **`SESSION_SECRET` and `INSTALLATION_KEY`.** rer generates both on the first deploy and keeps them in `.rer/deploy/production.secrets.env` in your checkout (private, and Git ignores it), so every redeploy reuses them. To deploy the same installation from another checkout, copy that file there. `INSTALLATION_KEY_PREVIOUS` is set only while the installation key is being rotated.
- **`SETUP_TOKEN`.** A one-time token rer issues for the deploy, uses to claim the owner on the deployed app, and then removes.
- **`OWNER_EMAIL`.** The owner you set up on this computer with `rer setup` or `rer dev`.

### What you supply

Put these in your environment or an owned `--env-file`, never in a tracked file:

- **`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`**, a token with Workers Scripts: Edit and D1: Edit.
- **`MAIL_PROVIDER=none`** for a Business without a mail provider. Leave `MAIL_FROM` and `MAIL_API_KEY` unset.
- **For email sign-in and invitations**, set `MAIL_PROVIDER` to a supported provider (`resend`, `sendgrid` or `cloudflare`), supply its `MAIL_API_KEY`, and set `MAIL_FROM` to a verified sender. Use a bare address or `Display Name <address>`.
- **Optionally `AI_ENABLED=true`, `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`** for your [AI provider](/docs/ai-provider). You can instead set the provider after the deploy, in Settings › Connections.

### Before you deploy

**Stop the local app first.** `rer deploy`, `rer deploy --dry-run`, `rer export` and `rer import` each need the installation to themselves, so while `rer dev` runs they stop with "An active local operation owns the state". Stop it with Ctrl-C in its terminal, or `rer dev --stop`, then run the deploy.

Then `rer deploy --dry-run` builds and prints the Worker, its database and migrations, its secrets and the scheduled check, and changes nothing.

## After the deploy

- With mail off, run `rer signin` from the deployment checkout using the Cloudflare credentials that deployed it. Open the one-time link and confirm the owner account. Keep the link private.
- With mail configured, sign in by email and [invite your team](/docs/team). Email sign-in, email invitations, and email confirmation links require a provider.
- [Set up each network's app](/docs/accounts) with your own keys, then connect accounts.

## Scheduled posts

The deployed app checks for due posts every minute. A [Pause](/docs/pause) stops every scheduled post until someone resumes.
