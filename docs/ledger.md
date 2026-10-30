The ledger is the company's record of everything that went out in its name: posts, threads, replies, pitches and hand-off posts.

## An entry

Each entry holds:

- the URL and the network's own id;
- the venue, the account and the person;
- the agent that drafted or published it, shown as "agent for person";
- the exact text as posted, the disclosure line and the claims it used;
- the product and campaign;
- the route: published, handed off, or sent through Orbit;
- the time and the state: posted, failed, uncertain, deleted or removed.

A post reads as posted only with the network's own id and URL read back, or, for a hand-off, with the link the named person recorded. An unknown outcome becomes a hold with an owner, and is never retried blindly.

## Corrections

Entries are never overwritten. A correction adds a version, and the original stays readable. A post a venue's moderators removed is marked removed, with the reason, and stays on the record.

## Search and history

Search every entry by text, and filter by venue, network, person, product, campaign, route and state. Each venue and each person has a history, newest first. Any filtered view exports as CSV.

## Signups

Every link to your own site in a post carries [UTM tags](/docs/links), and its `utm_content` is that post's own id, so any analytics tool that reads UTM tags can count the visits and signups each post brought. With [Vane](/docs/stack) connected, each post is also marked on its day in Vane, linked to its entry, and Vane's attribution shows the signups by post. Stump itself does not yet show signup counts on an entry.
