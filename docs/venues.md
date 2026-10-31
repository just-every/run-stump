A venue is any place the company could show up: a subreddit, a forum, a Slack or Discord community, a newsletter, a podcast, a directory, a publication or a journalist. Stump keeps each one with its rules, and reads those rules before every post.

## What a venue holds

- Its kind, name, URL, platform and audience, and the products it fits.
- Its status: candidate, join first, ready, editorial, paid, hold or excluded.
- Its priority, why it matters and what its readers get. Its kind reads with its platform: a Mastodon instance or an X community is a forum on that platform.
- How to post there, and what it requires: karma, account age, membership or a price.
- The members of your team who belong there, with their handles.

A second venue with the same address is refused, naming the first. An excluded venue keeps its reason and an alternative, so nobody proposes it again.

## Rules, each with its source

Every rule is a field with the URL it came from and the date it was read:

| Rule | What it says |
| --- | --- |
| Posting | Software may post from the company's account, or only a real member may |
| AI text | Allowed, allowed with disclosure, or banned |
| Self-promotion | Allowed, limited to a thread, a day or a ratio, or banned |
| Links | Allowed or not |
| Disclosure line | The line the venue asks for |
| Gates | Karma, account age or approval |

A rule is sourced only with both its source page and the date you read it. A rule with either missing reads as unsourced, and the rule editor says which half is missing. In the editor, choose the rule's value first; its source and date save with it as you type.

## Shared limits

A venue's shared limit is how often the whole company may post there, across every person and product: one post a week, say. It counts calendar periods in UTC: a week runs Monday to Sunday, and a month, quarter or year starts on its first day. A scheduled post, an open hand-off, and every post and hand-off already on the ledger take a place in their period. When the period is full, the next post or hand-off holds until the next period with room, and the venue's page shows when that is (**Next open**). The venue's **Products** card counts everything aimed at the venue for each product, hand-offs with a brief included.

## Discord servers

Discord message links look like `https://discord.com/channels/<server id>/<channel id>/<message id>`. To record a hand-off's link at a Discord venue, Stump needs the server: record the venue by a `https://discord.com/channels/<server id>` address, or keep its invite link (`discord.gg/…`) as the address and set **Server** to the server id (the first number in any message link from it). A message link from another server is refused, naming the venue.

## Slack communities

Slack message links look like `https://<workspace>.slack.com/archives/<channel id>/p<message id>`. To record a hand-off's link at a Slack venue, Stump needs the workspace: record the venue by its workspace address (`https://<workspace>.slack.com`), or keep its public join or welcome page as the address and set **Workspace** to the workspace's address (`<workspace>.slack.com`, the part before `/archives/` in any message link from it). A message link from another workspace is refused, naming the venue, and a Slack venue recorded by a page that names no workspace says to set **Workspace**.

## Routes

From the rules, Stump works out how a post may reach the venue:

- **Publish** from a connected account, where the venue allows it.
- **Hand off with a draft** to a named member, where the venue keeps posting for its members.
- **Hand off with a brief**, with the facts and no generated text, where the venue bans AI-written text.
- **Pitch** to the editor or host, for newsletters, podcasts, publications and journalists. The venue list and the venue's page both show it, and the editor or host decides what runs. You send the pitch from your own mail; an agent can draft it with `stump.drafts.write` (`format: "pitch"`, with a subject) to a journalist, publication or podcast record. The app has no screen for writing a pitch yet. Where members post at the venue too, its hand-off routes stay open beside Pitch.

Text found in a thread or an imported file never changes a rule or a route.

## Bring your list

Already keep a list? [Import it](/docs/import-venues) from Markdown or CSV.
