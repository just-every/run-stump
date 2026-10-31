Connect the network accounts Stump publishes to, in **Settings › Accounts**. Each account belongs to one person or to the company, and there is no pool of shared accounts.

Connect at least one before you write a post: [Compose](/docs/compose) opens a variant for each connected account you pick, and with none connected it has nothing to open variants for. A Mastodon account needs no app of your own, so it is the quickest first one.

## Who owns an account

- **Your own account.** You connect it yourself, through the network's own consent screen.
- **The company's account.** An admin connects it and names it as the company's. It stays when that admin leaves.

Disconnecting an account takes every post queued on it off the schedule and lists them for whoever can reschedule them.

## Your own network apps

Stump runs with your company's own developer apps and keys, so nothing depends on anyone else's accounts.

| Network | What you need |
| --- | --- |
| Bluesky | Nothing: sign in through your Bluesky server, or with an app password where it has no OAuth |
| Mastodon | Nothing: Stump registers itself on each instance |
| X | A developer app on pay-per-use pricing |
| LinkedIn | An app with Share on LinkedIn, and Community Management API access for a company page |

The setup screen shows each app's callback URLs, scopes and state, and keeps your keys masked.

## X

Each X post's charge from your price table is kept on its ledger entry, and an agent's X post shows its charge on the approval before it goes out. An agent publishes to an X account only when the account carries X's Automated label with its operator named in the bio. Prices and limits are in [Networks](/docs/networks).

## Bluesky

Name the account by its handle or its DID. Stump reads who the account is from its public record, the PLC directory or, for a `did:web`, the account's own domain, and connects through the server that record names. Every address on the way, the record's domain, the server and its sign-in server, must be on the public web, and Stump checks each one before it sends it anything; an account whose record names a server off the public web is refused, and so is any answer that redirects to another address. A copy of Stump running on your own computer (`rer dev`) also accepts a test server on that computer when you name it as the server, such as `http://127.0.0.1:2583`.

## Mastodon

Name the instance by its https address on the public web, such as mastodon.social. Stump checks the address before it sends the instance anything, and talks only to that address: an instance that answers with a redirect to another address is refused, so name the address the instance itself answers on. A copy of Stump running on your own computer (`rer dev`) also accepts an instance on that computer, such as `http://127.0.0.1:3000`, so you can try publishing against a test server; a deployed Stump accepts only public instances.

The connection records the account's bot flag and whether the instance's rules require it. An agent publishes to that account only when the flag is set where the rules ask for it.
