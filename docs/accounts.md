Connect the network accounts Stump publishes to. Each account belongs to one person or to the company, and there is no pool of shared accounts.

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

Each X post shows its charge from your price table before it goes out, and the charge is recorded on its ledger entry. An agent publishes to an X account only when the account carries X's Automated label with its operator named in the bio. Prices and limits are in [Networks](/docs/networks).

## Mastodon

Name the instance by its https address on the public web, such as mastodon.social. Stump checks the address before it sends the instance anything, and talks only to that address: an instance that answers with a redirect to another address is refused, so name the address the instance itself answers on.

The connection records the account's bot flag and whether the instance's rules require it. An agent publishes to that account only when the flag is set where the rules ask for it.
