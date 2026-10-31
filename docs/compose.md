Write a post once and Stump opens a variant for each account you pick, side by side. Each variant counts its text the way its network does and is checked against its network's limits and its venue's rules.

Variants open only for connected accounts, so connect one first in **Settings › Accounts** ([Accounts](/docs/accounts)). Until one is connected, **Accounts** in a new post says so with a link there, and **Open variants** stays off.

## One post, every network

1. Write the master post.
2. Pick the accounts: Bluesky, X, LinkedIn and Mastodon accounts the company or you own.
3. Choose the product it is for (with one product, that one), and, where you keep venues on that network, the venue each account's variant goes to, such as your Mastodon instance. The venue's rules then apply to the variant, and the ledger files the post under that venue and product. A venue whose rules let only members post is shown but cannot be picked. A Mastodon variant is offered only the venues on its account's own server: a hashtag or group on another server never receives the post, so a variant aimed at one (by an agent, say) holds until it is aimed at a venue on its own server or sent from an account there. Once the variants are open, the product and each variant's venue stay above them, so you can change either before scheduling: the variant's checks run again for its new venue and product.
4. Edit any variant on its own. Changing the master updates the variants nobody has edited, and marks the edited ones.
5. Schedule them all with one press, each at its account's time, or add them to each account's queue. The page then shows the exact text each account sends, its links with their [tags](/docs/links), and once posted, the text the network read back.

A variant that fails a check holds alone, naming the check, and the rest go ahead.

## Counting

| Network | Counted as | Limit |
| --- | --- | --- |
| Bluesky | Graphemes | 300 |
| X | Weighted characters | 280, or the account's longer limit |
| LinkedIn | Characters | 3,000 |
| Mastodon | Characters | The instance's own limit |

A long post splits into a thread at sentence boundaries. The full table of limits and prices is in [Networks](/docs/networks).

## Drafts waiting

With nothing open, Compose lists the drafts not yet scheduled, newest first, each with who wrote it ("Release agent for Dana Reyes"), the networks it goes to and its state. A draft an agent wrote for you lands here; open it to read, edit, check and schedule it. A draft that names no account yet asks which account it goes out from, then schedules or queues like any other. An item on a venue's page opens the same way, or its brief when it belongs to a hand-off.

## Drafts from a source

Point Stump at a changelog entry, a docs page or any URL, and it drafts posts for the accounts and venues you pick, through [your own AI provider](/docs/ai-provider). Each draft links its source and the claims it used. No provider yet? [A model on your own computer](/docs/ai-provider#a-model-on-your-own-computer) works too.

## Checks before a post moves on

- **Claims.** Every factual product claim must match a current claim with its proof. See [Brand and claims](/docs/brand).
- **Disclosure.** Where a connection to the company needs saying, it is said. See [Disclosure](/docs/disclosure).
- **Near-duplicates.** A post that nearly repeats one posted or queued elsewhere is held with links to its matches until it is rewritten.

## Revisions

Every save makes a revision. What publishes is always one exact revision.
