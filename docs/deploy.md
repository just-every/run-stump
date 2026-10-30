Put Stump on your own Cloudflare account so your team can sign in from anywhere. Your data stays in your account's own database.

## Deploy

From your checkout:

```sh
rer deploy
```

`rer setup` lists what a deploy still needs before it can run: the Cloudflare account ID and an API token, and the secrets the app reads, such as the owner's email and the mail provider's key. Nothing is deployed until those are in place.

## After the deploy

- Sign in as the owner from the deployed address, and confirm the owner account.
- [Invite your team](/docs/team), each with their role and their connection to the company.
- [Set up each network's app](/docs/accounts) with your own keys, then connect accounts.

## Scheduled posts

The deployed app checks for due posts every minute. A [Pause](/docs/pause) stops every scheduled post until someone resumes.
