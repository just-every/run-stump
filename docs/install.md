Run Stump on your own computer with one line. Git is required; the installer brings Node and pnpm.

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-stump
```

Already have Node 22 or later? This does the same:

```sh
npx -y @runeditrun/rer dev just-every/run-stump
```

It clones Stump into `./run-stump`, installs what it needs, sets up a local owner and starts the app.

## Sign in

The command prints a private sign-in link for this computer. Open it to sign in as the owner. The first time, Stump asks you to confirm the owner account at `/setup`; then it opens the app.

On your own computer, mail is not sent. To act as a teammate you invited, open `/signin` in the same browser and choose **Sign in as <name>**, or start with `rer dev --as person@example.com`. Emailed sign-in links for other people work once you deploy and set up mail.

## Turn on drafting

Drafts from a changelog or a prompt use your own AI provider. Set it in **Settings › Connections › AI provider**; see [AI provider](/docs/ai-provider).

## Start it again

```sh
cd run-stump && rer dev
```

## Install the command once

To have `rer` in every terminal:

```sh
npx -y @runeditrun/rer cli install
```

Next: [deploy Stump](/docs/deploy) for your team, or [connect your accounts](/docs/accounts).
