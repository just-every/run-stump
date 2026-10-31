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
- **`MAIL_API_KEY`**, your mail provider's key. `MAIL_PROVIDER` in `deploy.json` names the provider, `resend` by default.
- **`MAIL_FROM`**, the sender for sign-in links and invitations: a real address on your mail provider's verified domain, bare or with a display name (`Display Name <address>`). A real deploy refuses a placeholder address.
- **Optionally `AI_ENABLED=true`, `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`** for your [AI provider](/docs/ai-provider). You can instead set the provider after the deploy, in Settings › Connections.

### Before you deploy

**Stop the local app first.** `rer deploy`, `rer deploy --dry-run`, `rer export` and `rer import` each need the installation to themselves, so while `rer dev` runs they stop with "An active local operation owns the state". Stop it with Ctrl-C in its terminal, or `rer dev --stop`, then run the deploy.

Then `rer deploy --dry-run` builds and prints the Worker, its database and migrations, its secrets and the scheduled check, and changes nothing.

## After the deploy

- Sign in as the owner from the deployed address, and confirm the owner account.
- [Invite your team](/docs/team), each with their role and their connection to the company.
- [Set up each network's app](/docs/accounts) with your own keys, then connect accounts.

## Scheduled posts

The deployed app checks for due posts every minute. A [Pause](/docs/pause) stops every scheduled post until someone resumes.
