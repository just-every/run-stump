The ledger is the company's record of everything that went out in its name: posts, threads, replies and hand-off posts.

## An entry

Each entry holds:

- the URL and the network's own id;
- the venue, the account and the person;
- the agent that drafted or published it, shown as "agent for person";
- the exact text as posted, the disclosure line and the claims it used;
- the product and campaign;
- the route: published or handed off;
- the time and the state: posted, failed, uncertain, deleted or removed.

A post reads as posted only with the network's own id and URL read back, or, for a hand-off, with the link the named person recorded. An unknown outcome becomes a hold with an owner, and is never retried blindly.

## Corrections

Entries are never overwritten. A correction adds a version, and the original stays readable. A post a venue's moderators removed is marked removed, with the reason, and stays on the record. Removing a post the company's own account made deletes it at the network first; for an agent that counts as destructive and external, so the company's agent policy decides. An entry under legal hold keeps its post at the network while the hold stands, and so does every other entry for the same post. Stump deletes only a post its own publisher recorded: an entry whose network id was corrected is marked removed without a delete at the network.

## Search and history

Search every entry by text or by the `utm_content` its links carry, and filter by venue, network, person, product, campaign, route and state. Each venue and each person has a history, newest first. Any filtered view exports as CSV, with each venue, account and product named beside its id. In the CSV, a field that begins with = + - or @ carries a leading apostrophe, so a spreadsheet opens it as the words that were posted, never as a formula.

## Signups

Every link to your own site in a post carries [UTM tags](/docs/links). Its `utm_content` names the post: the post's own id for a post Stump published, the first 8 characters of the hand-off's id for a hand-off. Each entry shows it ("Links tagged utm_content=…"), and the CSV has it in its `utm_content` column, so the visits and signups each post brought, counted by post in Vane or in any analytics tool that reads UTM tags, join to the entry they came from. With [Vane](/docs/stack) connected, each post is also marked on its day in Vane and linked to its entry here, so a rise in signups leads straight back to the post that brought it. The counts themselves are read in Vane or your analytics tool; the ledger does not show signup numbers.
