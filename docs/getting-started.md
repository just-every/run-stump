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

On your own computer, mail is not sent. Sign-in links for other people work once you deploy and set up mail.

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
