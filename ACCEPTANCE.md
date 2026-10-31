<!-- Generated from CONTRACT.md by contract-docs. Edit CONTRACT.md, then regenerate. -->

# Accept a Stump installation

The primary journey: load the venues worth showing up in with their rules, teach Stump the company's voice and true claims, turn a release into posts and replies, publish to your own accounts or hand each members-only post to the person who belongs there, and see which posts brought signups.

## Progress

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 1 | 42 | 101 | 144 |
| Agent surface | 0 | 20 | 8 | 28 |
| Later | 0 | 0 | 8 | 8 |
| Full target | 1 | 62 | 117 | 180 |

Judged from the code and tests at commit `e2429d3b71ed35a0915430ab1a0907846db81c9a` (30 October 2026). Field proof register: 28 rows; 0 passed, 0 failed, 28 not run.

## Core

### Venue register

#### STUMP-VENUE-001 — Venue records

Core · published · **partial** · From new · Cites BASE-INPUT-001

**Requirement.** A venue is any place the company could show up: a subreddit, forum, Slack or Discord community, newsletter, podcast, directory, publication, journalist, launch platform, event, or one of the company's own channels. Each venue holds its kind, name, URL, platform, audience, the products it fits, its status (candidate, join-first, ready, editorial, paid, hold or excluded), priority, why it matters, what its readers get, how to post there (thread, channel, flair, day, template), its requirements (karma, account age, membership, price), its rules with their source URLs, and notes. Venues are shared across the company's products. An excluded venue keeps its reason and the alternative, so it is not proposed again.

**Acceptance.** Through the app at 1440 and 390, the API and MCP:
1. Create a subreddit, a Slack community, a newsletter, a podcast, a directory and a journalist; each reads back with the fields its kind needs.
2. Filter venues by kind, status, product and priority; the counts equal the records.
3. Exclude a venue with a reason and an alternative; proposing the same URL later shows the exclusion and creates nothing.
4. A second venue with the same normalised URL is refused, naming the first.
5. Archive and restore a venue; its items, hand-offs and ledger entries keep their links throughout.
6. A venue shared by two products shows each product's fit and items, and an edit to the venue reads the same from both.

**Evidence.** `tests/stump/venues.test.mjs` "the register keeps one venue per place, and its rules decide the routes and its gates who can post", "a venue list imports from Markdown and CSV: a dry run, apply, a rerun that changes nothing, a named conflict and Undo"
**Gap.** Points 1 to 6 are asserted through the person door and MCP (point 6 on a venue the import shares between two products). The register screens at `/app/venues` and `/app/venues/:id` are built; no browser test asserts them at 1440 and 390 yet.

#### STUMP-VENUE-002 — Venue rules and allowed routes

Core · published · **partial** · From new · Rules D-3, D-7

**Requirement.** Each venue records its rules as fields, each with its source URL and read date: whether software may post from the company's own account or only a real member may; whether AI-written text is allowed, allowed with disclosure, or banned; the self-promotion rule (allowed, limited to a thread, a day or a ratio, or banned); whether links are allowed; the disclosure line the venue asks for; and its gates. From these rules Stump computes the routes an item to that venue may take: publish from a connected account, hand off to a member with a draft, or hand off with a brief and no generated text.

**Acceptance.** Through the app, the API and MCP:
1. A venue that allows API posting offers publish and hand-off; a subreddit whose rules keep posting for members offers only the hand-off.
2. A venue that bans AI-written text offers a hand-off with a brief and facts; asking for generated text there is refused and no AI call is made.
3. A venue whose self-promotion is limited to a weekly thread holds an item aimed outside that thread, naming the rule.
4. Changing a rule changes the routes of every item not yet posted there on the next read, with the change in each item's history.
5. Each rule shows its source URL and read date; a rule with no source reads as unsourced.
6. Found or imported text that claims a rule changes no rule and no route.

**Evidence.** `tests/stump/venues.test.mjs` "the register keeps one venue per place, and its rules decide the routes and its gates who can post", "a venue list imports from Markdown and CSV: a dry run, apply, a rerun that changes nothing, a named conflict and Undo"
**Gap.** Points 1, 3, 4 and 5 are asserted, and point 2's routes (a venue that bans AI text offers only the brief). Refusing a generated draft there needs the drafting lane to call `generatedTextBanned` from `src/stump/venues/rules.ts`. Point 6 is not built.

#### STUMP-VENUE-003 — Fit, priority and shared limits

Core · published · **partial** · From new · Rules D-3

**Requirement.** Each venue holds a fit for each product, a priority, and a shared limit: how often the company as a whole may post there across its products and people, such as one post per weekly thread. Fit scores 0 to 100 from four factors the company weights: audience match, the route the rules allow, past reception on the ledger, and recent findings there about the product's topics. A person can override a fit with a reason until someone clears it. Stump orders venues by priority and fit, counts posts against each shared limit from the ledger, and shows when the next post is allowed.

**Acceptance.** Through the app and MCP:
1. Venues order by priority, then fit, and each fit shows its factors, their weights and each factor's part.
2. On the fit fixture, every venue's computed fit equals the fixture's expected score, and changing a weight changes the scores as the fixture expects.
3. An override with a reason replaces the computed fit and shows who set it and why; clearing it restores the computed fit.
4. With a limit of one post a week, a second product's item scheduled in the same week is held with the next open date.
5. A hand-off post and a published post count against the same limit.
6. Cancelling a scheduled item frees its place in the limit at once.
7. Counts read back the same after a reload and after a restore.

**Evidence.** `tests/stump/venues.test.mjs` "the register keeps one venue per place, and its rules decide the routes and its gates who can post"
**Gap.** The shared limit is set and read through `stump.venues.fit`; scheduled items over it are held with the next open date, and cancelled ones stop counting at once (`src/stump/venues/limits.ts`). Points 4 and 6 at scheduling time need the scheduling path to call `sharedLimitHold`. Points 1 to 3 (fit scoring), 5 and 7 are not built.

#### STUMP-VENUE-004 — Venue list import

Core · published · **partial** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports a company's existing venue list. It reads the Markdown format of the 19 Oct 2026 outreach list: entries with `seed`, `seeds`, `platform`, `status`, `priority`, `post_type`, `human_written_required`, `post_url`, `community_url`, `rules_urls`, `evidence_urls`, `link_check`, `venue_id`, `audience`, `why`, `reader_value`, `how_to_post`, `requirements`, `notes` and `sources`, each with its draft and alternates; venue records with `url`, `rules`, `reception`, `promotion_route`, `shared_limit` and `entries`; and excluded venues with `reason` and `alternative`. It also reads CSV with mapped columns. An import is a saved dry run first, then an apply.

**Acceptance.** Through the import screen at 1440 and 390:
1. A dry run on a fixture in that format reports venues, entries, exclusions and rejected rows with reasons, and writes nothing.
2. Apply creates each venue once, maps `human_written_required` to the AI-writing rule, `shared_limit` to the shared limit, `status` to venue status, and each draft to a draft for its product and venue.
3. Excluded venues arrive excluded with their reason and alternative.
4. Running the same file again changes nothing; a changed row shows a conflict and waits for a choice.
5. Undo removes what the import created and lists the edits made since, which it keeps.
6. A CSV with mapped columns creates the same venues as the Markdown fixture.

**Evidence.** `tests/stump/venues.test.mjs` "a venue list imports from Markdown and CSV: a dry run, apply, a rerun that changes nothing, a named conflict and Undo"
**Gap.** Points 1 to 6 are asserted through the import door. The import screen on `/app/venues` is built; no browser test asserts it at 1440 and 390 yet.

#### STUMP-VENUE-006 — Membership, gates and standing

Core · published · **partial** · From new · Rules D-1, D-3

**Requirement.** Stump records who on the team is a member of each venue: their handle there, when they joined, and, where the venue shows it publicly, their karma or account age. It tracks join applications and their state, and checks each venue's gates (karma, account age, approval) against the member. A hand-off goes only to a member who meets the venue's gates.

**Acceptance.** Through the app and MCP:
1. Record a member with their handle and joined date, and the venue lists them.
2. A member below a venue's karma gate cannot receive its hand-off, and the gate is named.
3. A join application moves from applied to approved, and the person then receives hand-offs there.
4. A handle recorded for one person cannot be recorded for another at the same venue.
5. Public karma or account age, where the venue shows it, refreshes on a schedule and reads back with its date.

**Evidence.** `tests/stump/venues.test.mjs` "the register keeps one venue per place, and its rules decide the routes and its gates who can post"
**Gap.** Points 1 to 4 are asserted through the person door and MCP; the hand-off queue reads `handoffEligibility` from `src/stump/venues/members.ts` when it is built. Point 5 (public karma refresh) is not built.

### Hand-off queue

#### STUMP-HANDOFF-001 — A brief and a draft for a named member

Core · published · **partial** · From new · Cites BASE-ROLE-001 · Rules D-1, D-2, D-3, D-8 · Register R-11, R-12

**Requirement.** Where a venue's route is a hand-off, Stump prepares it for one named member: the exact thread or channel, the venue's rules, why it fits, the facts and claims with their proof, the disclosure, and a draft in that person's voice, or talking points only where the venue bans AI-written text or D-8 applies. The person works their own queue: copy the text, open the venue, edit, skip with a reason, or record the post. A non-member gets the venue's join steps first.

**Acceptance.** Through the app at 1440 and 390 and MCP:
1. A hand-off for a subreddit thread to a member shows the rules, facts with proof, disclosure line and draft.
2. For a venue that bans AI-written text, the hand-off holds talking points and facts, and an empty field for the person's own words.
3. A hand-off to a non-member arrives as join-first, with the venue's join steps and gates.
4. The disclosure cannot be removed from a hand-off draft that mentions a product.
5. A hand-off to an investor or a friend that recommends a product holds talking points and facts only, and records only after the person attests the words are their own.
6. A person's queue orders by due date and shows only their own hand-offs.
7. Skipping with a reason records the skip and frees the shared-limit place.
8. Only the named person, or an agent acting for them, can record the post; anyone else is refused and changes nothing.

**Evidence.** `tests/stump/handoffs.test.mjs` "a member gets a brief and a draft for a venue that keeps posting for its members, and the link they post is checked onto the ledger"; `agent-surface.json` journey steps handoff, handoff-draft, handoff-text
**Gap.** Points 1 to 8 hold through MCP and the person door: the brief with the venue's rules and their sources, facts with proof and the disclosure for the person's connection; talking points and an own-words field where AI text is banned, with no AI call and the unused text logged in the hand-off's history; join-first with the join steps; the disclosure kept in the draft, including its line, and in the words recorded as posted; talking points and attestation for an outside voice who recommends; a full shared limit holding the hand-off with the next open date until its period has room; each person's queue by due date; skip with its reason freeing the shared-limit place; only the named person or their agent records. The screens `/app/handoffs` and `/app/handoffs/:id` have no committed browser journey at 1440 and 390 yet.

#### STUMP-HANDOFF-002 — The posted link, recorded and checked

Core · published · **partial** · From new · Rules D-5

**Requirement.** The named person records the posted link by pasting it or by replying to the hand-off notice with it. Stump checks that the link belongs to the venue, and confirms the post and its author through the network's official API or oEmbed where `docs/networks.md` lists one. Reddit, LinkedIn and members-only links are recorded as confirmed by the person unless a licensed supplier verifies them, with no request to their pages. A confirmed link marks the hand-off posted and writes the ledger entry with the posted text; a link to another venue or author is refused with the reason.

**Acceptance.** Through the app and email reply, against official-schema fakes:
1. A pasted Bluesky link moves the hand-off to posted, and the ledger shows the URL, person, venue, time and posted text.
2. A link to another domain or subreddit is refused, naming the venue.
3. A Mastodon or X link whose author is not the person's recorded handle is refused.
4. A Reddit link with no supplier is recorded as confirmed by the person, and no request reaches reddit.com.
5. A LinkedIn link is recorded the same way, and no request reaches linkedin.com.
6. A members-only Slack link is recorded as confirmed by the person, and the ledger says so.
7. Replying to the notice with the link gives the same result as pasting it.
8. Recording the same link twice has one effect; a different second link asks which is the post.

**Evidence.** `tests/stump/handoffs.test.mjs` "a member gets a brief and a draft for a venue that keeps posting for its members, and the link they post is checked onto the ledger"; `agent-surface.json` journey steps handoff-record, handoff-sky-record
**Gap.** Points 1, 2, 4 and 8 hold through the person door and MCP, and point 3 for a Bluesky author, read by the post's author DID against the DID the member's handle resolves to. Mastodon (statuses API), X (oEmbed) and Hacker News (Algolia) checks are built in `src/stump/handoffs/link.ts`, and LinkedIn and members-only links record as confirmed by the person (points 5 and 6), without a committed test. Point 7, recording by email reply, is not built.

#### STUMP-HANDOFF-003 — Held, skipped and expired hand-offs

Core · published · **partial** · From new

**Requirement.** Every hand-off has a due date, an owner and a lapse action its creator chose: expire it, reassign it to another member of the venue, or move it to the venue's next open place. When it lapses, the action runs and is logged; nothing waits in silence. A held hand-off shows who holds it, why, and its review date, and at that date its lapse action runs.

**Acceptance.** Through the app and MCP:
1. A hand-off past due with the expire action expires, its draft is superseded and its shared-limit place is freed.
2. With the reassign action it moves to another member, notifies them and keeps its history.
3. A held hand-off shows its holder, reason and review date, and its lapse action runs and is logged at that date.
4. A venue rule change that forbids the post moves the hand-off to held with the rule named.
5. Removing a person from the team lists their open hand-offs for reassignment, and none is lost.

**Evidence.** `tests/stump/handoffs.test.mjs` "a hand-off never waits in silence: a hold returns at its review date, a rule change holds it, and removing a person moves it on"
**Gap.** Points 3 to 5 hold: a held hand-off shows its holder, reason and review date, and at that date its lapse action runs and is logged; a rule change that forbids the post holds it with the rule named; removing a person moves each open hand-off to the venue's next member with its history, or expires it when nobody else there can take it. Expire and reassign on lapse (points 1 and 2) run on the Worker's scheduled tick and on any read past the due time (`src/stump/handoffs/refresh.ts`, `lapse.ts`), with the superseded draft named in the history; the test instance cannot trigger the tick, and the reassign notice is not built.

### Ledger

#### STUMP-LEDGER-001 — Every post and reply on the record

Core · published · **partial** · From new · Cites BASE-AUDIT-001 · Rules D-5 · Register R-8

**Requirement.** The ledger is the company's record of everything that went out in its name or about its products from its people: posts, threads, replies, articles, pitches, launch posts, directory listings and hand-off posts. Each entry holds the URL and network id, the venue, the account, the person, the agent that drafted or published it shown as "<agent> for <person>", the exact text and media as posted, the disclosure line, the claims it used, the product and campaign, the route (published, handed off, or sent through a connected tool such as Orbit or Mango), the time, and its state: posted, failed, uncertain, deleted or removed by the venue. Entries are append-only; a correction adds a version.

**Acceptance.** Through the app, the API, MCP and export:
1. A published Bluesky post and a handed-off Reddit post each appear once with every field.
2. For a published post, the ledger text equals the text read back from the network.
3. Correcting an entry adds a version, and the original stays readable.
4. A failed or uncertain item appears with its state and never reads as posted.
5. A post later removed by a venue's moderators is marked removed with the reason and stays on the record.
6. An item an agent drafted or published reads "<agent> for <person>" in the ledger and in its export.

**Evidence.** `tests/stump/ledger-stack.test.mjs` "the ledger is searched with combined filters, corrected into versions, marked removed and exported as the rows on screen"; `tests/stump/accounts.test.mjs` "an agent posts to the company X account within the owner's dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge"; `tests/stump/accounts.test.mjs` "removing a post the company's account made deletes it at the network and keeps the entry on the record, unless the entry is under legal hold"
**Gap.** Points 2 to 6 hold. For a published X post the entry's text equals the text read back, and it reads "<agent> for <person>" with its URL, charge, route and network confirmation (`src/stump/ledger/record.ts`). Through the person door, MCP and export, a correction adds a version and keeps the first, failed and uncertain entries read as such, a removal keeps the entry with its reason, and "<agent> for <person>" reads in the ledger and the export. On the company's own account, marking an entry removed deletes the post at the network first (its thread's parts with it) and keeps that outcome with the removal; only a post the publisher recorded is deleted, so an entry whose network id a correction set is marked removed without a delete, and a legal hold on any entry for the same post keeps it. Point 1 waits for the hand-off recorder.

#### STUMP-LEDGER-002 — Ledger search and history

Core · published · **partial** · From new

**Requirement.** Anyone with ledger access searches every entry by text and filters by venue, network, person, product, campaign, route, state and date. Each venue and each person has a history page of what was posted there or by them, newest first, removals included. Any filtered view exports as CSV.

**Acceptance.** Through the app at 1440 and 390 and the API:
1. A phrase search over a seeded ledger of 50,000 entries returns its matches within 500 ms.
2. Combined filters return exactly the matching entries, with counts.
3. A venue's history lists its posts newest first, removals marked.
4. A person's history lists their posts across networks and venues.
5. A filtered CSV export holds exactly the rows on screen with every field.

**Evidence.** `tests/stump/ledger-stack.test.mjs` "the ledger is searched with combined filters, corrected into versions, marked removed and exported as the rows on screen"
**Gap.** Points 2 to 5 hold: combined filters with counts, venue and person histories newest first with removals marked, and a filtered CSV of exactly the matching rows. The screen is `src/routes/app.ledger.tsx`. The 50,000-entry search time of point 1 is measured outside the test suite, not by a committed test.

#### STUMP-LEDGER-003 — Post results from each network

Core · published · **missing** · From new · Register R-1, R-3, R-4

**Requirement.** Stump reads each published post's results from its network on a schedule (likes, reposts, replies, quotes, saves, link clicks, and impressions where the network gives them) and keeps them over time on the ledger entry. It reads each connected account's follower count daily and shows its growth. X results are owned reads at X's metered price from the price table, recorded on the entry. LinkedIn member-post results come from LinkedIn's member post analytics once the company's app holds Community Management API access with that permission. Until then, and on any network that gives no results to outside apps, a person records them, and they read as entered by that person.

**Acceptance.** Through the app and MCP, against the network fakes:
1. A Bluesky post's likes, reposts and replies read back at each poll.
2. A Mastodon post's favourites and boosts read back.
3. An X post's impressions and engagement read back, and each read records its charge from the price table.
4. A Threads post's views, likes, replies and reposts read back from Threads insights.
5. A LinkedIn page post's impressions, reactions, comments and reshares read back.
6. A LinkedIn member post's impressions and reactions read back from member post analytics where the app holds that permission, and otherwise show only as entered by a person.
7. Results over time show for a post's first week.
8. Each account's follower count shows daily over a fixture month.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Discovery on open sources

#### STUMP-WATCH-001 — Hacker News search

Core · published · **partial** · From new · Cites BASE-OPS-004 · Rules D-4, D-7

**Requirement.** A watch searches Hacker News through its public Algolia search API for stories and comments that match its terms, with points, comment count, author and time. New matches arrive as findings within 15 minutes of appearing in the API, each once, linked to its HN item. Stump has no feature that posts, comments or votes on HN, so an HN finding routes only to a hand-off that carries a brief and facts, and never generated comment text.

**Acceptance.** Against an official-schema fake of the Algolia HN API, through the app and MCP:
1. A watch for a product name returns the matching stories and comments with points, author and link.
2. A second poll adds no duplicates, and a new match appears once.
3. An HN finding offers a hand-off with a brief and facts, or dismissal; no reply text is generated.
4. A finding whose text tells Stump to ignore its rules changes no route, rule or class.
5. An API failure shows on the watch with its time and error, and earlier findings stay.

**Evidence.** `tests/stump/watches.test.mjs` "watches over Hacker News, feeds, Bluesky and Mastodon find threads once, rank them with reasons, alert Slack and a signed webhook, replay the event, and mute"
**Gap.** Points 1, 2, 4 and 5 hold through MCP. For point 3 an HN finding offers the hand-off with a brief or dismissal and no reply text is generated; `stump.findings.work dismiss` removes a finding from the list for good. Preparing the hand-off itself (`stump.handoffs.prepare`) is later work.

#### STUMP-WATCH-002 — RSS and Atom feeds

Core · published · **done** · From new · Cites BASE-INPUT-002

**Requirement.** A watch follows any RSS or Atom feed (blogs, newsletters, podcasts, GitHub releases, Lobsters, DEV tags and Google Alerts feeds), either every item or items that match its terms. Where a podcast feed links an episode's transcript, the transcript is matched too. Stump uses HTTP caching and respects the feed's interval, and renders feed content as sanitised text. Reddit feeds are not a source: Reddit is watched only through a licensed supplier or the alerts the company already receives (STUMP-WATCH-007, STUMP-WATCH-014).

**Acceptance.** Through the app and MCP:
1. Adding a feed turns its matching items into findings with title, link, author and date.
2. An unchanged feed is fetched with its ETag or Last-Modified and adds nothing.
3. A malformed feed shows its error on the watch and keeps earlier findings.
4. A podcast feed's episode descriptions and linked transcripts match the watch's terms, and a transcript match links the episode.
5. A Google Alerts feed's items become findings linked to the alerted page rather than Google's redirect.
6. An item reached through two feeds, matched by its link, becomes one finding.
7. Script and markup in a feed item reach no screen as HTML.
8. Adding a reddit.com feed is refused, pointing to the supplier and alert routes.

**Evidence.** `tests/stump/watches.test.mjs` "watches over Hacker News, feeds, Bluesky and Mastodon find threads once, rank them with reasons, alert Slack and a signed webhook, replay the event, and mute"
**Gap.** None.

#### STUMP-WATCH-003 — Bluesky and Mastodon search

Core · published · **partial** · From new · Rules D-7

**Requirement.** A watch searches Bluesky through its public post search and Mastodon through the search and hashtag timelines of the instances the company chooses. Where an instance limits full-text search, Stump says the watch covers hashtags only there. Findings carry the author's handle, instance, text, link and counts.

**Acceptance.** Against official-schema fakes of the Bluesky search API and a Mastodon instance, through the app and MCP:
1. A Bluesky watch returns matching posts with handle, text and link.
2. A Mastodon hashtag watch returns matching posts from the chosen instance.
3. An instance without full-text search reads as hashtags only on that watch.
4. Repeated polls add no duplicates.
5. A rate-limit response is honoured, and the watch shows when it will poll next.

**Evidence.** `tests/stump/watches.test.mjs` "watches over Hacker News, feeds, Bluesky and Mastodon find threads once, rank them with reasons, alert Slack and a signed webhook, replay the event, and mute"
**Gap.** Point 3 is not built: Mastodon is followed through hashtag timelines only, and an instance's full-text search is not used or reported.

#### STUMP-WATCH-004 — Watches and alerts

Core · published · **partial** · From new · Cites BASE-MAIL-001, BASE-OPS-003

**Requirement.** A watch holds its terms (all of, any of, none of, exact phrase), its sources and products, and its alerts: an immediate alert for findings above a relevance the person sets, and a daily or weekly digest at a local time, delivered in the app, by email, in Slack, by push and by signed webhook. Every alert links to its finding. Source filters, team exclusions, block lists and backfill are STUMP-WATCH-013.

**Acceptance.** Through the app, email, Slack and a webhook receiver:
1. Terms requiring "orbit" and "crm" but not "orbital" match exactly the fixture's expected findings.
2. An immediate alert reaches email and Slack within 5 minutes of the finding.
3. A daily digest arrives at the person's chosen local time across a US daylight-saving change and lists each finding once.
4. Muting a watch stops its alerts and keeps collecting findings.
5. A webhook alert is signed, and a replay has no duplicate effect.

**Evidence.** `tests/stump/watches.test.mjs` "watches over Hacker News, feeds, Bluesky and Mastodon find threads once, rank them with reasons, alert Slack and a signed webhook, replay the event, and mute"
**Gap.** Points 1, 2 (Slack), 4 and 5 hold; a replay resends the signed webhook with its event id, and Slack only when named. Email delivery of immediate alerts (point 2) and the daily or weekly digest across a daylight-saving change (point 3) are not built.

#### STUMP-WATCH-013 — Watch filters, exclusions and backfill

Core · published · **partial** · From new · Rules D-7

**Requirement.** Each watch narrows each of its sources: only chosen feeds, forums, instances, channels, tags or story types. It excludes the company's own team: posts by any handle recorded for a team member or a connected account never become findings. It keeps an author block list the company edits. When a watch is created, or a source is added to it, Stump backfills matches from that source's recent history, up to 30 days where the source allows it, marked as backfill so they raise no immediate alert.

**Acceptance.** Through the app and MCP, against the source fakes:
1. A Mastodon watch limited to two instances and one hashtag returns findings from those only.
2. An HN watch limited to Ask HN and Show HN stories returns no comments and no other stories.
3. Posts by the team's recorded handles never become findings, on any source.
4. A blocked author's posts never become findings, and unblocking applies from the next poll.
5. A new HN watch backfills 30 days of matches, each once, marked as backfill and with no immediate alert.
6. Adding a source to an existing watch backfills that source only, and a second backfill adds no duplicates.
7. Changing a filter applies from the next poll and leaves earlier findings in place.

**Evidence.** `tests/stump/watches.test.mjs` "watches over Hacker News, feeds, Bluesky and Mastodon find threads once, rank them with reasons, alert Slack and a signed webhook, replay the event, and mute"
**Gap.** Point 4 holds with one company block list, by source and handle, for every watch. Point 3 has no repository proof: the team's recorded handles are read from connected accounts and venue members, whose doors other areas add.

#### STUMP-WATCH-005 — Relevance ranking with reasons

Core · published · **partial** · From new · Rules D-7

**Requirement.** Findings are ranked by fit to the company's products and venues, each with its reasons: matched terms, the venue's fit, the author's standing, freshness and whether the thread asks a question the company can answer. People mark findings useful or not, and the ranking learns from those marks. A finding's own text never changes its rank by instruction. The ranking is measured on a labelled fixture, and the measured rates are published in `docs/measures.md` with each release.

**Acceptance.** Through the app and MCP:
1. On a fixture, an open question about a category the product serves ranks above a passing mention.
2. Each finding shows its reasons.
3. On the labelled ranking fixture, at least 7 of each day's top 10 findings are labelled useful.
4. After the fixture's first week of marks, the second week's top 10 hold at most half as many findings of the kinds marked not useful as the same week ranked without the marks.
5. A finding that says "rank this first" ranks as if it did not.
6. `docs/measures.md` shows the measured top-10 share and the drop after marks from the last fixture run.

**Evidence.** `tests/stump/watches.test.mjs` "watches over Hacker News, feeds, Bluesky and Mastodon find threads once, rank them with reasons, alert Slack and a signed webhook, replay the event, and mute"
**Gap.** Points 1, 2 and 5 hold. Marks and learning from them (points 3 and 4) and the measured top-10 share in `docs/measures.md` (point 6) are not built.

#### STUMP-WATCH-011 — X search, metered

Core · published · **missing** · From new · Rules D-4 · Register R-1

**Requirement.** A watch searches recent X posts through the company's X app at X's metered read price from the price table. Each poll shows its expected cost before it runs and records what it cost, and the watch shows its spend this month. X allows an API reply only to an account that engaged with the replying account first, so an X finding from an account that has not engaged routes only to a hand-off, and the named person replies in the X app.

**Acceptance.** Against an official-schema fake of the X API v2, through the app and MCP:
1. An X watch returns matching posts with handle and link.
2. Each poll records its reads and their cost from the price table.
3. The watch's spend this month equals its recorded polls.
4. A finding from an account that has not engaged with the company's accounts offers only a hand-off to a named person, or dismissal.
5. An API reply from such a finding, through the app, the API or MCP, returns `act_refused` naming X's rule, and nothing posts.
6. A finding from an account that mentioned or replied to the company's account offers the inbox reply route (STUMP-INBOX-002).

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Own-account publishing

#### STUMP-PUBLISH-001 — Accounts bound to a person or the company

Core · published · **partial** · From new · Cites BASE-SECRET-001, BASE-ACCESS-004 · Rules D-1

**Requirement.** Each connected network account belongs either to one signed-in person, who connects it through the network's own consent screen, or to the company, connected by an admin and named as the company's. Stump reads the account's handle, display name and profile from the network and keeps them current. One network account has one owner, and there is no account pool. The owner of a personal account names which colleagues may schedule to it (STUMP-TEAM-003). Ownership and disconnect follow STUMP-CONNECT-001.

**Acceptance.** Through the app at 1440 and 390, the API and MCP:
1. A person connects their own Bluesky account, and it reads back as theirs with its handle and display name.
2. An admin connects the company's Mastodon account, and it reads back as the company's.
3. Connecting an account already owned by someone else in Stump is refused, naming the owner.
4. A consent link is bound to the signed-in person who asked for it and cannot connect an account for anyone else.
5. Disconnecting revokes the token at the network where it supports that, and lists the scheduled items it stops.
6. A scheduled item's export shows the account's handle and owner and no token field, and no door accepts a token or password typed in for another person.

**Evidence.** `tests/stump/accounts.test.mjs` "the company connects its X account through its own app, owned by the company, with no secret ever answered back"; `agent-surface.json` journey steps setup-x, connect-x, finish-x and slots-x
**Gap.** Points 2, 4 and 6 hold for the company's X account through the person door and MCP: it reads back as the company's, a consent completes only for the person who started it, and no answer carries a token. Point 3 is built for every network: a Bluesky handle already names its DID, so an account someone else owns is refused when the connection starts, before any consent screen, naming the owner; Mastodon, X and LinkedIn are refused at completion, where the account is first known (`src/stump/accounts/connect.ts`). Points 1, 3 and 5 have no repo test yet: they need a Bluesky PDS and a second person's account.

#### STUMP-CONNECT-001 — Connection ownership and disconnect

Core · published · **partial** · From new

**Requirement.** Stump keeps its network tokens in an OAuth connection store that it asks Base to add as a shared module, recorded as a ct NEW proposal for Base, and cites that Base duty once it exists. Stump's delta is ownership: each connection belongs to the person who completed the network's consent, or to the company, and never changes owner. Disconnecting, a revocation at the network, or the owner leaving the team unschedules every item queued on that connection and lists them to whoever can reassign them; a company connection outlives the admin who made it.

**Acceptance.** Through the app and MCP, against the network fakes:
1. Removing a person disconnects their personal accounts, unschedules the items queued on them and lists those items for reassignment, and no personal account passes to anyone else.
2. Removing the admin who connected a company account leaves it connected and the company's.
3. Reconnecting a person's expired account is refused for anyone but its owner.
4. A revocation made at the network is detected at the next call or refresh, unschedules the account's items and lists them to its owner.
5. Reconnecting restores no unscheduled item by itself; the owner re-queues the items they choose.
6. Each connection shows its owner, who connected it and when.

**Evidence.** `tests/stump/accounts.test.mjs` "the company connects its X account through its own app, owned by the company, with no secret ever answered back"; `tests/stump/accounts.test.mjs` "X refusing the account's token marks it expired, holds its posts with the reconnect step, and only its owner's reconnect brings it back"
**Gap.** Points 5 and 6 hold: each connection shows its owner, who connected it and when, and reconnecting restores no held item by itself. Point 4 holds in part: a token the network refuses (a 401, a revoked or expired token, a refused refresh) is detected at the next call or refresh on every network, the account reads expired with the reason and its reconnect address, and each item queued on it holds for its owner with the reconnect step; the items stay held rather than unscheduled. Reconnecting is refused for anyone but the owner (`src/stump/tools/accounts.ts`), without a repo assertion. Point 1 holds: removing a person disconnects their personal accounts (revoked at the network where it allows), returns every item of theirs that could still go out to draft, including posts waiting on a rate limit, and lists them; `tests/stump/accounts.test.mjs` "removing a person disconnects their own X account at X and returns their posts waiting on a rate limit to draft". Point 2 holds in code (removal leaves company accounts as they are), without a repo assertion.

#### STUMP-PUBLISH-002 — Bluesky posts and threads

Core · published · **missing** · From new · Rules D-5 · Register R-6

**Requirement.** Stump publishes posts and threads to a connected Bluesky account through its own PDS: text within Bluesky's grapheme limit from the network table (`docs/networks.md`), mentions and links resolved as facets, up to four images with alt text or one video, a link card, quote posts, and threads as reply chains. It honours the PDS's rate limits.

**Acceptance.** Against a local PDS, through the app and MCP:
1. A post publishes and reads back with its `at://` URI and web URL.
2. A post one grapheme over the table's limit is refused before it can be scheduled.
3. A four-post thread publishes as one reply chain; when the third post fails, the first two stay, the thread reads as partly posted, and resuming posts the rest once.
4. Mentions resolve to the right accounts and links to the right facets.
5. An image without alt text cannot be marked ready.
6. A rate-limit response holds the remaining items with their next attempt time.
7. A video with alt text publishes and reads back with its alt text.

**Evidence.** None.
**Gap.** Built: `src/stump/publish/bluesky.ts` publishes posts, threads as reply chains, facets and images with alt text, read back from the PDS. The proving test needs drafted items, which `stump.drafts.write` creates.

#### STUMP-PUBLISH-003 — Mastodon posts and threads

Core · published · **missing** · From new · Rules D-4, D-5 · Register R-6

**Requirement.** Stump publishes to a connected Mastodon account on any instance. It registers its app on each instance, reads the instance's character limit and rules, and supports content warnings, visibility (public, unlisted, followers only), media with alt text, polls and threads. The connection records the account's bot flag as the instance reports it and whether the instance's rules require the flag for automated accounts, which D-4 enforces for agent-initiated publishing.

**Acceptance.** Against a local Mastodon instance from its official image, through the app and MCP:
1. Registering the app, connecting by OAuth and publishing a post reads back the post's URL.
2. On an instance with a 500-character limit a 501-character post is refused, and on an instance set to 1,000 it publishes.
3. A content warning and unlisted visibility read back from the instance.
4. A thread publishes as one reply chain.
5. A retried publish with the same idempotency key creates one status.
6. A poll with four options and a closing time publishes and reads back with its options and expiry.
7. On an instance whose rules require the bot flag, an agent's publish to an account without it returns `act_refused` naming the rule, and the same post from a person's own composer publishes.

**Evidence.** None.
**Gap.** Built: `src/stump/publish/mastodon.ts` publishes at the instance's own limit with content warnings, visibility, polls, media with alt text and threads, with an Idempotency-Key per post. The proving test needs drafted items, which `stump.drafts.write` creates.

#### STUMP-PUBLISH-004 — X posts and threads

Core · published · **partial** · From new · Rules D-4, D-5 · Register R-1

**Requirement.** Stump publishes to a connected X account through the company's own X developer app on pay-per-use pricing: posts within the account's weighted limit, media with alt text, video, polls, quote posts, and threads as reply chains. Before each publish it shows the charge from the company's price table (`docs/networks.md`, which the company can update) and records it on the ledger entry. The connection records whether the account carries X's Automated label with its operator named in the bio, which D-4 enforces for agent-initiated publishing.

**Acceptance.** Against an official-schema fake of the X API v2, through the app and MCP:
1. A post publishes and reads back with its id and URL.
2. With the fixture price table, a post with a URL shows and records the URL-post charge, and one without a URL the plain-post charge.
3. A post over the account's weighted limit is refused before scheduling.
4. A thread whose third post fails reads as partly posted, and resuming posts the rest once.
5. A rate-limit or exhausted-credit response holds the item with the reason and no blind retry.
6. A poll and a video with alt text each publish and read back.
7. An agent's publish to an account without a recorded Automated label and operator bio returns `act_refused` naming X's rule, and the same post from a person's own composer publishes.
8. Once the label and bio are recorded, the agent's publish goes to the company's policy like any call.

**Evidence.** `tests/stump/accounts.test.mjs` "an agent posts to the company X account within the owner's dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge"; `agent-surface.json` journey (stump shard of `verification.json`) steps label-x and x-schedule
**Gap.** Points 1, 2 (the URL-post charge recorded) and 8 are asserted: an agent's post goes out once through the company's app, reads back with X's id and URL, and goes to the company's policy once the label is recorded. Points 3 to 7 are built in `src/stump/publish/x.ts` (weighted limit, partly posted threads and resume, held credits and rate limits, polls and media with alt text, the Automated label refusal) and not yet asserted in a repo test.

#### STUMP-PUBLISH-005 — LinkedIn member posts

Core · published · **missing** · From new · Rules D-4, D-5 · Register R-2

**Requirement.** A person posts to their own LinkedIn profile through the company's LinkedIn app with the self-serve Share on LinkedIn product (`w_member_social`): text within LinkedIn's limit, a link, and images with alt text, within LinkedIn's daily per-member request limit from the network table (`docs/networks.md`). Stump has no feature that likes, comments on or shares other members' posts (D-4). Document posts, polls, video and the first comment are STUMP-PUBLISH-021, and member-post results are STUMP-LEDGER-003.

**Acceptance.** Against an official-schema fake of LinkedIn's Posts API, through the app and MCP:
1. A post publishes to the person's profile and reads back with its URN and URL.
2. A post one character over the table's limit is refused before scheduling.
3. The request past the table's daily per-member limit is held to the next day with the reason.
4. An expired token sends the person a reconnect step and holds their items.
5. An image post reads back from LinkedIn with each image's alt text.
6. No like, comment or share action on other members' posts exists in the app, the API or MCP.

**Evidence.** None.
**Gap.** Built: `src/stump/publish/linkedin.ts` publishes member posts with links, preview text and images with alt text within the day limit, and holds a member's items for a reconnect. The proving test needs drafted items, which `stump.drafts.write` creates.

#### STUMP-PUBLISH-007 — Threads posts

Core · published · **missing** · From new · Rules D-5 · Register R-4

**Requirement.** Stump publishes posts and replies to a connected Threads profile through the company's Meta app: text within Threads' limit, images and video with alt text, carousels, polls, a topic tag, and reply chains, within Meta's per-profile post and reply limits from the network table (`docs/networks.md`). Meta lets profiles without a role on the app grant access only after App Review; until the company's app passes it, only invited testers can connect, and Stump shows that state. Results come in through STUMP-LEDGER-003.

**Acceptance.** Against an official-schema fake of the Threads API, through the app and MCP:
1. A post publishes in Meta's two steps (create, then publish) and reads back with its id and URL.
2. A post one character over the table's limit is refused before scheduling.
3. The post past the table's 24-hour limit is held to the next allowed time.
4. While the app has not passed App Review, a non-tester's connection shows the review step instead of failing.
5. A poll with its options publishes and reads back.
6. A post with a topic tag reads back with that tag.
7. A three-part reply chain publishes in order, and each part reads back.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-008 — LinkedIn company page

Core · published · **missing** · From new · Rules D-5 · Register R-3

**Requirement.** An admin connects the company's LinkedIn page through LinkedIn's Community Management API, which LinkedIn vets in a Development tier and then a Standard tier on an app of its own. Stump publishes page posts with text, links and images with alt text, and reads and answers comments on the page's own posts. Until the company's app holds the tier it needs, Stump shows which tier is missing. Page formats are STUMP-PUBLISH-021, and page results are STUMP-LEDGER-003.

**Acceptance.** Against an official-schema fake of LinkedIn's Community Management API, through the app and MCP:
1. A page post publishes and reads back with its URN and URL.
2. A person LinkedIn does not list as an admin of the page cannot connect it, and the page role LinkedIn reports is named.
3. A comment on the page's post arrives in the inbox and a reply to it publishes.
4. An app without the Standard tier shows the missing tier on the connection.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-021 — LinkedIn documents, polls, video and first comments

Core · published · **missing** · From new · Rules D-4, D-5 · Register R-2, R-3

**Requirement.** On a member profile and on the company page, Stump publishes the LinkedIn formats B2B posting relies on: document posts (a PDF shown as a swipeable carousel, with its title), polls with their options and duration, native video with captions, @mentions of company pages and people resolved to their LinkedIn URNs, and a first comment the author writes with the post, published on their own post once the post reads back. Each reads back from LinkedIn before the item reads as posted.

**Acceptance.** Against an official-schema fake of LinkedIn's Posts, Documents, Videos and Comments APIs, through the app and MCP:
1. A 12-page PDF publishes as a document post with its title and reads back with its URN.
2. A poll with three options and a one-week duration publishes and reads back.
3. A video with captions publishes once LinkedIn reports the upload processed, and reads back.
4. An @mention of a company page resolves to its organization URN and reads back as a mention.
5. A first comment publishes on the author's own post after the post reads back, and both appear in the ledger.
6. A first comment whose post failed is never sent.
7. A page post's document, poll and video publish and read back the same way through the Community Management API.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-006 — Scheduling and delivery truth

Core · published · **missing** · From new · Cites BASE-OPS-003, BASE-OPS-004, BASE-AGENT-012 · Rules D-5

**Requirement.** An item is scheduled for an account at a time in that account's time zone, or into its next open queue slot. At that time Stump publishes the exact revision that was scheduled, once, with an idempotency key per item and account; reads the post back from the network; and only then marks it posted with the network's id and URL. When the network's answer is lost, Stump first looks for the post by its key or text; if it still cannot tell, the item becomes uncertain, with a hold and an owner, and nothing is retried until that owner decides. A failure shows the network's error.

**Acceptance.** Through the app, the API and MCP, against the network fakes:
1. An item scheduled for 9:00 America/New_York publishes at 9:00 local on both sides of a daylight-saving change.
2. Two workers firing for the same item make one post.
3. A timeout after the network accepted the post resolves by read-back to posted, with no second post.
4. A timeout with no read-back match becomes uncertain with an owner, and nothing posts until the owner decides.
5. A failure shows the network's error and leaves the item failed and visible.
6. Editing a scheduled item schedules the new revision, and the old one never posts.
7. An edit carrying a stale expected revision, from a person or an agent, while the publisher fires is refused with the current revision, and the scheduled revision is unchanged and posts once.

**Evidence.** None.
**Gap.** Built: `src/stump/publish/schedule.ts` and `src/stump/publish/tick.ts` schedule in the account's time zone, claim the exact revision once, read back before posted, and hold lost answers as uncertain with an owner. None of points 1 to 7 is asserted in a repo test yet.

#### STUMP-CONNECT-002 — The company's own network apps

Core · published · **partial** · From new · Cites BASE-DATA-004, BASE-INSTALL-001 · Register R-1, R-2, R-3, R-4

**Requirement.** Each company runs Stump with its own developer apps and keys, so nothing depends on Run Edit Run's accounts. Setup walks through each network's app: Bluesky and Mastodon need none, X needs a developer app on pay-per-use, LinkedIn needs an app with Share on LinkedIn and, for a page, Community Management API vetting, and Meta needs an app with Threads access and App Review for people without a role. Each shows its callback URLs, scopes and state (not created, in development, under review, approved), and the company records approvals such as X's approval for AI replies. Every network is a declared external.

**Acceptance.** Through the setup screens at 1440 and 390:
1. Setup lists each network with its steps, callback URLs, scopes and state.
2. Entering an X app's keys moves X to connected, and the keys read back masked.
3. Recording X's approval for AI replies changes how X replies are computed.
4. Every network host appears in the installation's declared externals.
5. A self-hosted install with no apps still runs Bluesky and Mastodon.

**Evidence.** `tests/stump/accounts.test.mjs` "the company connects its X account through its own app, owned by the company, with no secret ever answered back"; `agent-surface.json` journey steps setup-x, connect-x, finish-x and slots-x
**Gap.** Points 1 and 2 hold: setup lists each network with its steps, callback URLs, scopes and state, and the X app's keys move X to connected and read back masked; the Publishing screen is `src/routes/app.settings.publishing.tsx`. Points 3 to 5 (X's approval for AI replies, declared externals, a self-host with no apps) are not proven.

### Brand, voice and claims

#### STUMP-BRAND-001 — Products and brand profile

Core · published · **partial** · From new

**Requirement.** The company records each product it markets: name and other names, a one-line description, audience, positioning, URLs, the competitors it is compared with, the words it uses and avoids, and its tone. Drafting, disclosure and listening read this profile, so a mention of a product or a competitor is recognised wherever it appears.

**Acceptance.** Through the app and MCP:
1. Two products with different tones each draft in their own tone from the same source.
2. A product's other names and competitors are recognised in a draft and in a finding.
3. A word on the avoid list is flagged in a draft before it can be marked ready.
4. Changing the profile changes the next draft and leaves existing drafts as they were.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"; `tests/stump/drafting.test.mjs` "a draft from a changelog goes through the company's AI provider with the voice guide and current claims, and a failure leaves no draft"; `tests/stump/drafting.test.mjs` "an avoided word and an image without alt text keep an item from ready, each named, until they are fixed"
**Gap.** Products with names, competitors, words to use and avoid and tone, and their recognition in drafts, are built through the person door and MCP; the tone and profile reach each AI request. Point .3 is asserted: a draft with an avoided word cannot be marked ready, and the refusal names the word. Not yet asserted in a repo test: two tones from one source (.1) and profile changes (.4); recognition in a finding (.2) waits for the watches lane. The product fields follow the v0.1.0 interface, which has no positioning field.

#### STUMP-BRAND-002 — A real person's voice

Core · published · **partial** · From new · Rules D-1

**Requirement.** Each person may have a voice guide built from writing they choose: their own past posts (pasted, or imported under STUMP-IMPORT-007), with notes on what they say and never say. A voice guide drafts only that person's items. The person and editors can read and edit it; nobody else can draft from it, and it never transfers to another person.

**Acceptance.** Through the app and MCP:
1. A person builds a voice guide from twenty of their own pasted posts and edits its notes.
2. A draft for that person follows the guide's do and don't notes on the fixture.
3. Using one person's guide for another person's item is refused.
4. A person's guide is not readable by a role without access to it.
5. A removed person's guide is archived with them and drafts nothing.

**Evidence.** `tests/stump/drafting.test.mjs` "a draft from a changelog goes through the company's AI provider with the voice guide and current claims, and a failure leaves no draft"; `agent-surface.json` journey (stump shard of `verification.json`) step "voice"
**Gap.** Voice guides for a signed-in person only, edited by that person and editors, sent with every AI request for that person, refused for another person's item and archived with a removed person are built. Points .1, .3-.5 are not yet asserted in a repo test; .2 is request side only (adherence is not measured).

#### STUMP-BRAND-003 — Fact and claim memory

Core · published · **partial** · From new

**Requirement.** The company keeps the claims it may make, each with its proof (a URL, document, number or date), an owner and a review date; the claims it must not make, each with the reason; and comparative claims against named competitors, each with a dated source. A claim past its review date reads as stale until its owner renews it. US truth-in-advertising sits behind this record: a product claim needs evidence before it goes out.

**Acceptance.** Through the app and MCP:
1. A claim with proof and a review date reads back with its owner.
2. A banned claim reads back with its reason.
3. A comparative claim without a dated source cannot be saved.
4. A claim past its review date reads as stale and its owner is notified.
5. Every draft that used a claim is listed on it.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"; `tests/stump/drafting.test.mjs` "a draft from a changelog goes through the company's AI provider with the voice guide and current claims, and a failure leaves no draft"
**Gap.** Claims with proof, owner and review date, banned claims with reason, comparative claims refused without a dated source, stale reading and the drafts that used a claim are built. Repo tests assert stale claims are left out of AI requests and claims used on drafts; .2, .3 and .5 are not yet asserted in a repo test, and .4's notice to the owner is not built.

#### STUMP-BRAND-004 — Claim check on every draft

Core · published · **partial** · From new · Rules D-7

**Requirement.** Before an item can be marked ready, Stump extracts its factual product claims and matches each to a current claim. An unmatched claim is flagged for a person to back or remove; a banned claim stops the item; a stale claim is flagged; and a number that differs from its proof is flagged with the proof's number. The check runs the same way for people and agents.

**Acceptance.** Through the app, the API and MCP:
1. A draft whose claims all match current claims passes, listing each match.
2. A draft with "SOC 2 certified" on the banned list cannot be marked ready.
3. A draft saying "50% faster" when the proof says 30% is flagged with the proof's number.
4. An unmatched claim is flagged until a person backs it with proof or removes it.
5. A person and an agent submitting the same draft get the same result.
6. On the labelled claims fixture, extraction finds at least 90% of the labelled product claims and flags at most 5% of the labelled non-claims, and the measured rates are published in `docs/measures.md`.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"
**Gap.** Point .2 (banned claim cannot be marked ready) and .5 (person and agent get the same result) are asserted. Number mismatches (.3) and backing an unmatched claim (.4) are built and not yet asserted in a repo test; .6 needs the labelled fixture and docs/measures.md.

### Drafting

#### STUMP-DRAFT-010 — One post, every network

Core · published · **partial** · From new · Rules D-3

**Requirement.** A person writes one master item and Stump opens a variant for each account they pick, edited side by side: each variant starts from the master, can be changed on its own, and shows its network's preview, with every preview on screen at once. Each variant is counted and checked against its own network's limits and formats and its venue's rules, and its flags show on that variant only. One action schedules or queues every variant, each at its account's time; a variant that fails a check holds alone and the rest go ahead. Changing the master updates the variants nobody has edited and marks the edited ones.

**Acceptance.** Through the app at 1440 and 390 and MCP, against the network fakes:
1. One master item opens Bluesky, X, LinkedIn and Mastodon variants, and all four previews show at once.
2. A 400-character master flags the Bluesky and X variants over their limits and leaves the LinkedIn and Mastodon variants clear.
3. Editing the X variant changes only that variant, and its preview updates.
4. Changing the master updates the unedited variants and marks the edited one as differing.
5. One schedule action schedules every variant at its account's time, each as its own item with its own revision.
6. A variant that fails a check holds with its flag, and the other variants are scheduled.
7. Each variant reads back from its network with the text its preview showed.

**Evidence.** `agent-surface.json` journey (stump shard of `verification.json`) steps x-master and x-master-schedule
**Gap.** The master post opens one variant item per account with master_id, counts and flags each on its own network, follows the master unless edited (differs_from_master), and previews every variant. One schedule_master action schedules every passing variant and holds a flagged one with its flag; the journey holds an X variant over its limit alone (.6, one variant). Not in a repo test yet; .5 and .7 across several networks are not asserted.

#### STUMP-DRAFT-001 — Formats and network limits

Core · published · **partial** · From new

**Requirement.** Stump drafts posts, threads, replies, articles, pitches, launch copy and newsletter sections. Each format knows the limits of the account or venue it is for, counted the way the network counts (graphemes on Bluesky, weighted characters on X, the instance's limit on Mastodon). A long post splits into a thread at sentence boundaries, with optional numbering.

**Acceptance.** Through the app at 1440 and 390 and MCP:
1. A post's count matches the network's counting rule for Bluesky, X and Mastodon on the fixture texts.
2. A long draft splits into a thread at sentence boundaries, and each part fits.
3. A reply draft carries the thread it answers.
4. A pitch draft carries its recipient and subject.
5. Switching a draft's account rechecks its limits.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"
**Gap.** Posts, threads split at sentence boundaries by network count, replies with reply_to and pitches with recipient and subject are built; .3 (a reply carries its thread) is asserted. Counting (.1), thread fit (.2) and pitches (.4) are not yet asserted in a repo test; .5 (recheck on switching account) is not built.

#### STUMP-DRAFT-002 — Drafts from a source

Core · published · **partial** · From new

**Requirement.** From a source (a changelog entry, docs page, blog post or any URL) Stump drafts a set of items for the accounts and venues the person picks. Each item links its source and the claims it used. When the source changes, the items drafted from it are flagged with what changed.

**Acceptance.** Through the app and MCP:
1. One changelog entry drafts a Bluesky post, an X thread and a LinkedIn post, each linking the entry.
2. Each item lists the claims it used.
3. A change to the source flags its unposted items with the change.
4. A source the AI provider cannot read leaves no draft and shows why.

**Evidence.** `tests/stump/drafting.test.mjs` "a draft from a changelog goes through the company's AI provider with the voice guide and current claims, and a failure leaves no draft"
**Gap.** Point .4 (an unreadable source leaves no draft) is asserted, and .1-.2 for a Bluesky post and an X thread with claims used. .3 (source changes flag items) is not built.

#### STUMP-DRAFT-003 — Revisions and comments

Core · published · **partial** · From new

**Requirement.** Every save of an item makes a revision. People see the differences between revisions, comment and mention colleagues, and restore an earlier revision as a new one. What publishes or is handed off is always one exact revision.

**Acceptance.** Through the app and MCP:
1. Three saves make three revisions, and the difference between any two shows.
2. A comment mentioning a colleague notifies them and links the revision.
3. Restoring revision 1 makes revision 4 with revision 1's text.
4. The ledger entry names the exact revision that went out.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"
**Gap.** Revisions with expected_revision, diff and restore are built; restore making a new revision with the earlier text (.3) is asserted. .1 diff is not yet asserted in a repo test, .2 comments are not built, and .4 needs the publishing lane's ledger write.

#### STUMP-DRAFT-004 — Network previews

Core · published · **missing** · From new

**Requirement.** Each item previews as its network and venue will show it: the link card from the page's own tags, where the network cuts the text behind "see more", how a thread splits, and how images crop. The preview equals what is posted.

**Acceptance.** Through the app at 1440 and 390:
1. A link card shows the page's title, description and image.
2. A LinkedIn post shows where "see more" will cut it.
3. A thread shows each part as posted.
4. After publishing to the network fakes, the read-back text equals the preview text.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DRAFT-006 — AI provider, cost and failure

Core · published · **partial** · From new · Cites BASE-DATA-004

**Requirement.** Drafting uses the company's own AI provider and model through `ai.provider.v1`. A request sends only what the draft needs: the source, the voice guide, the claims, and the venue's rules. Each request records its cost in USD and its model. A provider failure shows on the item with the provider's error; Stump never substitutes generic copy. Output that fails the claim check or the venue check stays a draft with its flags.

**Acceptance.** Through the app and MCP, against a provider fake:
1. A draft request sends only the declared fields and records its model and USD cost.
2. A provider failure leaves no draft and shows the error.
3. Output with a banned claim stays a draft, flagged.
4. Usage shows AI cost by person, product and month.
5. Each draft's record lists the fields sent to the provider and the provider's host, and they match the installation's declared outbound flow.

**Evidence.** `tests/stump/drafting.test.mjs` "a draft from a changelog goes through the company's AI provider with the voice guide and current claims, and a failure leaves no draft"
**Gap.** Points .1 (declared fields, model and USD cost recorded) and .2 (a provider failure leaves no draft and says why, with the provider's own message) are asserted, for the installation's AI settings and for the provider an admin saves in Settings (`stump.setup.ai`); .5 records fields sent and host on each item. .3 is built (output that fails the check stays a flagged draft) and not yet asserted; .4 usage by person, product and month is not built.

### Calendar and queue

#### STUMP-PLAN-001 — Content calendar

Core · published · **missing** · From new · Register R-11, R-12

**Requirement.** One calendar shows every scheduled, handed-off and posted item across accounts, people, venues and products, by month, week or list. Items are coloured by product and filtered by account, person, venue, campaign and state. Dragging a scheduled item to a new time reschedules it after the same checks as scheduling.

**Acceptance.** Through the app at 1440 and 390:
1. Month, week and list views show the same items for a seeded month.
2. Filters by account, person, venue, campaign and state show exactly their items.
3. Dragging an item to a time that breaks a venue's shared limit is refused with the rule.
4. Dragging an item to an allowed time reschedules it and records the change.
5. Rescheduling from an item's date and time fields, without dragging, runs the same checks and gives the same result as a drag.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PLAN-002 — Posting slots and good times

Core · published · **missing** · From new

**Requirement.** Each account has queue slots in its own time zone. "Add to queue" places an item in the next open slot. Stump suggests better slots from the account's own results, showing the sample each suggestion rests on, and never moves slots by itself.

**Acceptance.** Through the app and MCP:
1. An account with weekday 9:00 and 14:00 slots puts three queued items into the next three open slots.
2. Slots follow the account's time zone across a daylight-saving change.
3. A suggestion shows its sample size, and accepting it changes the slots.
4. Removing a slot moves its items to the next open slots and lists them.

**Evidence.** None.
**Gap.** Built: queue slots in the account's time zone, the next open slot, and moving queued items off a removed slot (`src/stump/publish/slots.ts`); the agent-surface journey's x-queue step queues one item into its account's next open slot. Points 1 to 4 are not asserted in a repo test, and suggestions (.3) are not built.

### Engagement inbox

#### STUMP-INBOX-001 — Replies and mentions on own accounts

Core · published · **partial** · From new · Cites BASE-INPUT-002 · Rules D-7 · Register R-3

**Requirement.** One inbox holds replies, mentions, quotes and direct messages on the company's and its people's connected accounts: Bluesky and Mastodon notifications, Bluesky chats, Mastodon direct posts, X mentions and direct messages (read at X's metered price), Threads replies and comments on the LinkedIn page. Each arrives with its thread or conversation, author and link, rendered as text, within 15 minutes of the network serving it.

**Acceptance.** Against the network fakes, through the app at 1440 and 390 and MCP:
1. A reply on Bluesky, a mention on Mastodon and a comment on the LinkedIn page arrive with their threads.
2. A Bluesky chat message and an X direct message arrive with their conversations.
3. X mention and message reads record their charge.
4. Each item arrives once across polls.
5. Markup in a reply reaches no screen as HTML.

**Evidence.** `tests/stump/inbox.test.mjs` "the company reads its X mentions once at its read price, answers only people who engaged first, once each, and holds a near-duplicate"
**Gap.** The company's X mentions and replies to its posts arrive with the post they answer as their thread (the company's own post with its ledger entry, or someone else's thread post), author, link and the author's public profile, each read charged from the price table and recorded (.3), each once across polls (.4); the X part of .1. Bluesky, Mastodon and LinkedIn-page items (.1), messages (.2) and an assertion of .5 (the screen renders post text as text) are not built.

#### STUMP-INBOX-002 — Answering people who engaged first

Core · published · **partial** · From new · Rules D-2, D-4 · Register R-1

**Requirement.** From the inbox a person answers someone who engaged with the company's account first, in public or in a direct conversation that person started. On X, Stump allows one reply per interaction, as X's developer guidelines ask; an AI-drafted reply on X needs X's prior approval, which the company records for its app (STUMP-CONNECT-002). Every reply passes the disclosure, claim and near-duplicate checks.

**Acceptance.** Through the app and MCP, against the network fakes:
1. A reply to a Bluesky mention publishes in its thread.
2. A second reply to the same X interaction is refused, citing X's rule.
3. An AI-drafted X reply without X's recorded approval shows the approval step, and the person may write their own reply instead.
4. A reply to an account that never engaged with the company's account is not offered from the inbox.
5. A reply that mentions a product from a person's own account carries the disclosure line.
6. A direct message can be sent only in a conversation the other person started.

**Evidence.** `tests/stump/inbox.test.mjs` "the company reads its X mentions once at its read price, answers only people who engaged first, once each, and holds a near-duplicate"; `agent-surface.json` steps "inbox-reply", "inbox-ai-reply"
**Gap.** On X a reply goes only to a post whose author engaged first (.4: a stranger in a public thread is refused with D-4 and X's automation rule), once per interaction (.2), through the claim, disclosure and near-duplicate checks, which refuse a flagged reply with item_flagged before anything is written (the disclosure case of .5 from a person's own account in the lane probe) and hold a near-duplicate until rewritten; an AI-drafted X reply holds at X's prior-approval step and the person may write their own (.3, journey and lane probe, no repo test). Bluesky replies (.1), a repo assertion of .5 and direct messages (.6) are not built or asserted.

### Switching from other tools

#### STUMP-IMPORT-001 — Buffer

Core · published · **partial** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports from Buffer through its API with the company's key or from its CSV exports: channels, queued and draft posts, sent posts with their results, and posting schedules. Every import is a dry run first, then an apply, and can be undone. Queued posts arrive paused until the person confirms Buffer no longer holds them, so nothing posts twice.

**Acceptance.** Through the import screen, against a Buffer fixture:
1. A dry run reports what will arrive and writes nothing.
2. Apply brings sent posts into the ledger with their results, and schedules into queue slots.
3. Queued posts arrive paused, and only the person's confirmation releases them.
4. Running the import again changes nothing.
5. Undo removes what it created.

**Evidence.** `tests/stump/data.test.mjs` "switching from Buffer: a dry run, sent posts to the ledger, schedules to slots, queued posts paused until released, a rerun that changes nothing, and Undo"
**Gap.** Points 1 to 5 are asserted through the import door's `buffer` source, against a bundle of Buffer's v1 API objects: the dry run counts channels, sent and queued posts and names refused rows; profiles become accounts that wait for their owners to connect (state expired, with the reconnect link), each of Buffer's day-and-time posting slots becomes its own queue slot, sent posts become published ledger entries with Buffer's statistics as imported results, queued posts arrive paused until `stump.calendar.plan release_import` with `confirm_source_cleared`; a rerun plans nothing; Undo removes what the import created and keeps what was edited since. The Import screen at `/app/settings/import` is built; no browser test asserts it at 1440 and 390 yet. Buffer's CSV exports are not read.

#### STUMP-IMPORT-002 — Typefully

Core · published · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports from Typefully through its API with the company's key: drafts, scheduled and published posts and threads, and the accounts they belong to, with the same dry run, apply, undo and paused-queue rules as STUMP-IMPORT-001.

**Acceptance.** Through the import screen, against a Typefully fixture:
1. Drafts and threads arrive as drafts with their parts in order.
2. Published posts arrive in the ledger with their links.
3. Scheduled posts arrive paused until the person confirms.
4. Running the import again changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-006 — Listening tools

Core · published · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports keyword setups and mention history from Brand24, Syften, Octolens and F5Bot exports: watches with their terms, and mentions as findings with their links and dates. Mentions from Reddit keep only their links unless a licensed supplier covers them.

**Acceptance.** Through the import screen, against each fixture:
1. Each tool's keywords arrive as watches with equivalent terms.
2. Mentions arrive as findings with links and dates.
3. Reddit mentions without a supplier keep only their links.
4. Running the import again changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Refusals by design

#### STUMP-TRUTH-001 — No personas

Core · published · **partial** · From new · Cites BASE-ACCESS-001, BASE-SIGNIN-001 · Rules D-1

**Requirement.** Stump speaks only as real people and as the company. A person exists only through an accepted invitation and sign-in, a person's accounts are connected only by that person, and nothing creates, imports or operates an account for a fictional or composite identity. One person may not post from two accounts into the same thread or venue to look like two voices. A voice guide belongs to one real person and drafts only their items. The import door rejects persona records with a reason, and a row naming a real person becomes a pending invitation that holds nothing until they claim it.

**Acceptance.** Through the app, the API, MCP and the import door:
1. Creating a person without an accepted invitation is refused through every door.
2. An imported persona record is rejected with its reason; a row naming a real person becomes a pending invitation holding no handle, account, voice guide, hand-off or draft until that person signs in and claims it.
3. Drafting in one person's voice for another person's item is refused.
4. Scheduling a second account owned by the same person into a thread that person already posted in is refused, naming the first post.
5. An agent's call to connect an account, attach a voice guide or assign a hand-off for someone who has not signed in returns the same `act_refused` a person gets, and changes nothing, under every company policy.
6. The app's help and `/docs/agents` list these refusals and their reasons.

**Evidence.** `tests/stump/team.test.mjs` "people join only by invitation, with the invited role, through the person door", "an agent credential acts for its person with exactly their role, follows role changes and ends when revoked"
**Gap.** Point 1 holds through the person door, sign-in and MCP; the import door is not built. Voice guides and drafts for someone not signed in, and another person's voice, answer act_refused D-1 through both doors (built, not yet asserted in a repo test). Points 2, 4 and 6 need imports, scheduling and /docs/agents.

#### STUMP-TRUTH-002 — Disclosure enforced

Core · published · **partial** · From new · Rules D-2 · Register R-9

**Requirement.** Each person records their connection to the company (founder, employee, contractor, investor, advisor, friend or family) and their disclosure lines. Stump recognises the company, its products and competitors from the brand profile (STUMP-BRAND-001). An item that mentions them, from a connected person, anywhere other than the company's own accounts, discloses the connection before it moves on (D-2), with a disclosure line or its own plain words ("we", "our", "I built"); a bio line never counts. Where a network hides the end of a post behind "see more", the disclosure sits above the cut.

**Acceptance.** Through the app, the API and MCP:
1. An employee's reply naming a product without a disclosure cannot be marked ready; adding the venue's line lets it through.
2. A hand-off to a friend of the founder that mentions a product needs a disclosure the same way.
3. A post from the company's own account that mentions the product needs no line.
4. A founder's post on their own X account saying "we just shipped Orbit 2.0" passes with no added line.
5. A founder's post praising Orbit without such words is held until a line is added, though their bio names the company.
6. A disclosure below LinkedIn's "see more" cut is flagged to move above it.
7. Editing the disclosure out of a scheduled item returns it to draft and unschedules it.
8. An agent's call to mark an item ready without the disclosure is refused through MCP as through the app.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"
**Gap.** Points .1 and .8 are asserted (an employee's item naming the product is refused act_refused D-2 by the person door and MCP until it discloses). Disclosure lines, own words, company accounts, the LinkedIn see-more cut and return to draft on an edit are built and not yet asserted in a repo test; .2 needs hand-offs.

#### STUMP-TRUTH-003 — No features for platform-banned acts

Core · published · **partial** · From new · Cites BASE-DOCS-001 · Rules D-4 · Register R-9

**Requirement.** Stump offers no feature, to people or to agents, for the acts D-4 names. Its tool list, API, automations and launch plans have no step for them, and its drafting refuses to write them: a review or testimonial for someone else to post, or a request for votes. Each refusal names the rule and its source: Hacker News's guidelines and Show HN page, Product Hunt's launch page, X's developer guidelines, LinkedIn's prohibited-software help page, and the FTC's rule on fake reviews and testimonials (16 CFR Part 465).

**Acceptance.** Through the app, the API, MCP and automations:
1. MCP `tools/list` and the API have no tool or route for any act D-4 names.
2. A request to draft a five-star review "as a customer" returns `act_refused` citing the FTC rule.
3. A launch-plan step to ask friends for upvotes cannot be saved, and the refusal quotes Product Hunt's and HN's rules.
4. An automation that replies on X when someone uses a keyword cannot be saved.
5. Draft text that asks readers to upvote is flagged before it can be marked ready for an HN or Product Hunt venue.
6. `/docs/agents` lists each refusal with its rule, source and read date.

**Evidence.** `tests/stump/team.test.mjs` "people join only by invitation, with the invited role, through the person door"; `agent-surface.json` journey (stump shard of `verification.json`)
**Gap.** Banned acts by name answer act_refused with rule and source on every tool (spine hook); drafting refuses review and vote requests citing the FTC and platform rules, and flags vote requests for HN and Product Hunt venues. Only the by-name refusal is asserted in a repo test; launch plans (.3) and /docs/agents (.6) are not built.

#### STUMP-TRUTH-004 — Near-duplicate blocking

Core · published · **partial** · From new

**Requirement.** Before an item can be marked ready, scheduled or handed off, Stump compares it with the ledger and the queue. An item that nearly repeats one posted or queued in another community, or on the same account, within the window the company sets, is held with links to its matches, because platforms treat near-identical posts as spam. The company's own announcement adapted for each of its own accounts on different networks is not a near-duplicate. Rewriting clears the hold; nothing posts the duplicate unchanged.

**Acceptance.** Through the app, the API and MCP:
1. A reply that repeats an earlier reply in another subreddit with only names changed is held, linking the earlier one.
2. A reply that makes the same point in different words passes.
3. One announcement scheduled to the company's own Bluesky and Mastodon accounts passes.
4. Two near-identical posts to one X account in the company's window are held.
5. A person and an agent submitting the same item get the same result.
6. The hold names its matches, and only a rewrite clears it.
7. On the labelled near-duplicate fixture, at least 95% of near-duplicate pairs are held and at most 5% of distinct pairs, and the measured rates are published in `docs/measures.md`.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"
**Gap.** Near-duplicates of queued items and ledger entries in the company's window are held naming the match until rewritten (.6 asserted); the company's own announcement across its networks and variants of one master are exempt. .1-.5 are built and not each asserted in a repo test; .7 needs the labelled fixture.

### Venue upkeep and reception

#### STUMP-VENUE-005 — Rules freshness and change review

Core · target · **missing** · From new · Rules D-3, D-7

**Requirement.** Stump re-reads each venue's rule pages on a schedule the company sets. When the rule text on a page changes, it opens a review task with the before and after text for the venue's owner; it never rewrites the structured rules by itself. Rules older than the age the company sets read as stale, and items for a venue with stale rules show that before they can be marked ready.

**Acceptance.** Through the app and MCP, against fixture rule pages:
1. A changed rule page opens one review task with the before and after text.
2. An unchanged page opens nothing.
3. The structured rules stay as they were until someone with venue edit rights accepts or edits the change.
4. A venue past the company's rule age reads as stale, and its items show the warning before ready.
5. A rule page that fails to load shows the failure on the venue and keeps the last rules.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-VENUE-007 — Reception and venue history

Core · target · **missing** · From new

**Requirement.** Each venue keeps its reception: how its posts fared, removals, moderator messages and warnings, and notes. A removal or a moderator warning recorded against a venue lowers its fit with the reason, and items queued for that venue hold until an editor reads the warning and clears it, because a second breach can cost the membership.

**Acceptance.** Through the app and MCP:
1. Recording a removal with the moderator's reason lowers the venue's fit and shows why.
2. Items queued for that venue hold, naming the warning, until an editor clears it.
3. The venue's history lists posts, removals and warnings in order.
4. A venue with strong reception rises in the order with its reasons shown.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Media library

#### STUMP-BRAND-005 — Media library with rights and alt text

Core · target · **missing** · From new · Cites BASE-INPUT-003

**Requirement.** The company keeps its images, screenshots, GIFs and videos in one library, each with alt text, its rights (made by the company, licensed with a source, or someone else's with recorded permission) and where it has been used. Media without alt text or without recorded rights cannot be attached to an item that is marked ready.

**Acceptance.** Through the app and MCP:
1. Upload an image within the size and type limits, add alt text and rights, and it reads back.
2. An image without alt text cannot go into a ready item.
3. An image marked as someone else's without recorded permission cannot go into a ready item.
4. The image lists every item and ledger entry that used it.
5. An upload over the limits is refused with the limit named.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-BRAND-006 — AI-made images and short video

Core · target · **missing** · From new · Cites BASE-DATA-004 · Rules D-3

**Requirement.** Stump makes images, carousel slides and short videos for posts with the company's own image or video model through its AI provider, from a prompt, a brand template (colours, fonts, logo placement) or an item's text. Each result enters the media library labelled AI-made, with alt text a person confirms, its rights recorded as generated, its prompt and model, and its cost in USD. A network that asks for AI-made media to be labelled receives the label with the post, and a venue that bans AI-made media refuses it before ready. A provider failure shows its error and leaves nothing behind.

**Acceptance.** Through the app and MCP, against an image and video provider fake:
1. A generated image enters the library labelled AI-made, with alt text, rights, prompt, model and USD cost.
2. A brand template's colours, fonts and logo placement appear in a generated carousel's slides.
3. A short vertical video generates from an item's text with captions and enters the library the same way.
4. A post with AI-made media carries the AI label on each network the network table marks as asking for one.
5. Attaching AI-made media to an item for a venue that bans it is refused before ready, naming the rule.
6. Generated alt text reads as unconfirmed until a person confirms or edits it, and unconfirmed alt text cannot go into a ready item.
7. A provider failure shows the provider's error and adds nothing to the library.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-BRAND-007 — Designs from Canva

Core · target · **missing** · From new · Register R-25

**Requirement.** A person connects their Canva account through the Canva Connect API, then opens a Canva design from an item or the media library, or starts a new one at the target network's size. When they finish in Canva, the design comes back exported as images, a PDF or a video into the media library, with its Canva link, the alt text they write, and its rights recorded as made by the company in Canva. Reopening a design and returning replaces the media in unposted items and keeps posted ones as they went out.

**Acceptance.** Against an official-schema fake of the Canva Connect API, through the app:
1. Connecting Canva runs Canva's consent screen and reads back the person's Canva account.
2. A new design opens in Canva at the target network's size, and returning brings it back as an image with its Canva link.
3. A multi-page design returns as carousel images in page order, and a video design as a video.
4. Returned media cannot go into a ready item until alt text is added.
5. Reopening an unposted design and returning replaces the media in its items, and a posted item keeps the version that went out.
6. A failed export shows Canva's error, and nothing is added.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-BRAND-008 — Media from Google Drive and Dropbox

Core · target · **missing** · From new · Cites BASE-INPUT-003

**Requirement.** A person picks images, videos and PDFs from their Google Drive through Google's picker, or from Dropbox through Dropbox's Chooser, and Stump copies each into the media library with its source link, the alt text they add and the rights they record. Stump reads only the files the person picks, under the narrowest file scope each service offers.

**Acceptance.** Against fakes of Google's Picker and Drive API and Dropbox's Chooser, through the app:
1. Picking three Drive images copies them into the library with their source links.
2. A Dropbox video copies in the same way and passes the network media checks before it can be attached.
3. The Drive connection holds only the per-file scope, and Stump lists no file the person did not pick.
4. A picked file without recorded rights cannot go into a ready item.
5. A file deleted at the source after copying stays in the library and shows its source as gone.
6. A file over the upload limits is refused with the limit named.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-BRAND-009 — Unsplash photos and GIPHY GIFs with their licence

Core · target · **missing** · From new · Register R-25

**Requirement.** A person searches Unsplash photos and GIPHY GIFs from the composer and the media library through each service's API with the company's own key. A pick enters the library with its licence recorded (the Unsplash License or GIPHY's terms), the creator's name and link, and the attribution each service asks for. Stump reports each Unsplash download as Unsplash's API guidelines require and shows GIPHY's attribution in the picker.

**Acceptance.** Against official-schema fakes of the Unsplash and GIPHY APIs, through the app:
1. A picked Unsplash photo enters the library with the Unsplash License, the photographer's name and link, and alt text to confirm.
2. Picking it sends Unsplash's download event once.
3. A picked GIPHY GIF enters the library with GIPHY's terms and its source link.
4. The picker shows the attribution each service asks for.
5. Picking the same photo twice reuses its library entry.
6. A search the service rate-limits shows the limit and when to try again.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Writing tools

#### STUMP-DRAFT-011 — AI editing and drafts from an idea

Core · target · **missing** · From new · Cites BASE-DATA-004 · Rules D-3, D-8

**Requirement.** In the editor a person selects text and asks Stump to rewrite it, shorten or expand it, write a hook, change its tone, or turn a post into a thread; or they turn a free-text prompt into drafts for the accounts and venues they pick, with no source needed. Each action runs through the company's AI provider (STUMP-DRAFT-006) with the person's voice guide, the brand profile and the venue's rules, and its result is a new revision the person can keep or undo. Results pass the same claim, venue-fit, disclosure and near-duplicate checks as any draft.

**Acceptance.** Through the app and MCP, against a provider fake:
1. Shortening a selected sentence replaces only the selection and saves a new revision.
2. Turning a 900-character post into a thread splits it into parts within the account's limit.
3. Changing the tone and writing a hook each make one revision, and undo restores the one before.
4. A prompt with no source drafts an X post and a LinkedIn post in the person's voice, each linked to the prompt.
5. A generated claim that matches no current claim is flagged, as for any draft.
6. An action on an item for a venue that bans AI-written text is refused with the rule, and no provider call is made.
7. Asking for a generated recommendation for an investor's hand-off returns talking points and facts only.
8. Each action records its model and USD cost.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DRAFT-012 — Ideas backlog

Core · target · **missing** · From new

**Requirement.** Anyone with draft rights keeps ideas: a title, notes, links, media, tags, the product, the campaign and an owner. Ideas sit on a board by state (new, shaping, ready to draft, drafted, dropped) and in a filterable list. One action turns an idea into an item, or into a master item with network variants (STUMP-DRAFT-010), carrying its notes, links and media, and the idea links to what it became. Ideas arrive from the app, the browser extension and findings.

**Acceptance.** Through the app at 1440 and 390 and MCP:
1. An idea saves with tags, product, campaign and owner, and reads back.
2. The board shows ideas in their state columns, and moving a card changes its state and records the move.
3. Filters by tag, product, campaign and owner show exactly their ideas.
4. Converting an idea opens an item with its notes, links and media, and the idea shows as drafted with a link to the item.
5. A finding saved as an idea keeps its link to the finding.
6. A dropped idea keeps its reason and leaves the board's active columns.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DRAFT-013 — Browser extension

Core · target · **missing** · From new · Cites BASE-ACCESS-002 · Rules D-7 · Register R-24

**Requirement.** Stump has a browser extension for Chrome, Safari and Firefox. On any page a person saves the page as a source for drafting or as an idea, with any selected text as a quote, or opens the composer with the page's link, title and selection filled in. The extension acts as the signed-in person under the Base session rules, with that person's role, and holds no network token. Its session is listed among the person's sessions and can be revoked there.

**Acceptance.** Through the extension in Chrome, Safari and Firefox against a running installation:
1. Saving a page as a source creates it with its URL, title and selected text, ready for drafting.
2. Saving a page as an idea creates the idea with its link and the selection as a quote.
3. Opening the composer from a page fills the link, title and selection into a new item.
4. A person whose role cannot draft is refused the save actions, and nothing is created.
5. The extension's session shows in the person's session list, and revoking it there refuses the next save.
6. A page's own text changes nothing the extension saves beyond the link, title and selection.

**Evidence.** None.
**Gap.** Not built: no browser extension exists yet, and no Stump code exists.

#### STUMP-DRAFT-014 — Preview links for reviewers without a seat

Core · target · **missing** · From new · Cites BASE-ACCESS-003

**Requirement.** A person shares one revision of an item with someone outside the team through a signed preview link. It shows only that revision with its network previews, expires at the time they set, and can be revoked. They choose whether the reviewer may comment; comments arrive on the item marked as from an outside reviewer, with the name the reviewer gives. Every opening and comment is logged. A later revision is not shown until a new link is shared.

**Acceptance.** Through the app and the public preview door:
1. A preview link shows the shared revision with its previews and nothing else from the installation.
2. After its expiry, or once revoked, the link shows nothing.
3. A comment from a reviewer without a seat arrives on the item with their given name, marked as outside.
4. A link shared without comments accepts none.
5. Editing the item does not change what an existing link shows.
6. Each opening and comment appears in the item's history with its time.
7. A link with a tampered signature is refused.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DRAFT-005 — Venue-fit check before ready

Core · target · **missing** · From new · Rules D-3

**Requirement.** Before an item for a venue can be marked ready, Stump checks it against the venue's rules: its template, flair, day, link policy, self-promotion rule and any required introduction. Each failure names the rule and its source; a pass is recorded on the item.

**Acceptance.** Through the app, the API and MCP:
1. An item missing a venue's required flair fails, naming the rule and its source.
2. An item with a link for a venue that bans links fails.
3. An item for a weekly thread scheduled on another day fails.
4. A passing item records the rules it was checked against and their read dates.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DRAFT-007 — Alternates and talking points

Core · target · **missing** · From new

**Requirement.** An item can hold alternate drafts and the original talking points beside its chosen draft. A person picks which one goes out; the ledger records which one it was.

**Acceptance.** Through the app and MCP:
1. An item holds three alternates and its talking points.
2. Choosing an alternate makes it the next revision.
3. The ledger records which alternate went out.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DRAFT-008 — Articles with canonical links

Core · target · **missing** · From new

**Requirement.** An article has a title, subtitle, tags, cover image with alt text, body in Markdown, and a canonical URL. When an article is published in one place and copied to others, each copy carries the canonical link back to the original, so search engines credit the original.

**Acceptance.** Through the app and MCP:
1. An article reads back with its title, tags, cover and body.
2. A copy for a second platform carries the original's canonical URL.
3. An article without a canonical URL cannot be copied to a second platform.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Campaigns and pacing

#### STUMP-PLAN-003 — Campaigns

Core · target · **missing** · From new

**Requirement.** A campaign groups items, hand-offs, pitches and launches under one name with dates, a goal, a product and a UTM campaign name. Its page shows what is planned, posted and pending, and its results.

**Acceptance.** Through the app and MCP:
1. A campaign with posts, hand-offs and a pitch shows each with its state.
2. Every link in its items carries the campaign's UTM name.
3. Its results sum the results of its items.
4. Archiving a campaign keeps its items and results readable.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PLAN-004 — Rotation across products

Core · target · **missing** · From new · Rules D-3

**Requirement.** Where several products share a venue, Stump rotates which product's item goes next under the venue's shared limit, so no community sees a burst of launches. The rotation and its next turn are visible, and an editor can reorder it.

**Acceptance.** Through the app and MCP:
1. Three products queued for one weekly thread post one a week, in rotation order.
2. The venue shows whose turn is next.
3. Reordering the rotation changes the next turn and is recorded.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PLAN-005 — Pacing as data

Core · target · **missing** · From new · Register R-28

**Requirement.** Each account has a posting budget per day and a minimum interval, and each network's rate limits are kept as data in the network table (`docs/networks.md`). Stump checks pacing just before it publishes; an item over budget moves to the next allowed time with the reason.

**Acceptance.** Through the app and MCP:
1. With a budget of three posts a day, a fourth item moves to the next day with the reason.
2. Two items closer than the minimum interval are spaced out at publish time.
3. A network limit reached mid-day holds the remaining items with their next times.
4. Changing a budget takes effect at the next publish.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PLAN-006 — Bulk scheduling from CSV

Core · target · **missing** · From new · Cites BASE-INPUT-001

**Requirement.** An editor uploads a CSV of items (account, time, text, link, media URL, campaign) or a Hootsuite bulk-composer file. A dry run reports each row's result; an apply creates the scheduled items once, each through the same checks as scheduling by hand.

**Acceptance.** Through the app:
1. A dry run on a 100-row file lists each row's result and writes nothing.
2. A row over its network's limit or breaking a venue rule is rejected with the reason.
3. Apply creates the accepted rows once; applying the file again changes nothing.
4. A Hootsuite bulk-composer file schedules the same items as the CSV fixture.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PLAN-007 — Pause publishing

Core · target · **partial** · From new

**Requirement.** One control pauses all publishing, or publishing for an account or a campaign, for an incident or bad news. Queued items hold. Resuming shows what will go out, and items whose time passed during the pause stay held until they are rescheduled or dropped.

**Acceptance.** Through the app, the API and MCP:
1. Pausing all publishing stops the next scheduled post, and nothing posts while paused.
2. Pausing one account holds only its items.
3. Resuming lists what will go out and holds overdue items until they are rescheduled or dropped.
4. Pause and resume are recorded with the person and time.

**Evidence.** `tests/stump/team.test.mjs` "an agent credential acts for its person with exactly their role, follows role changes and ends when revoked"; `tests/stump/accounts.test.mjs` "an agent posts to the company X account within the owner's dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge"
**Gap.** Point 4 is proven, and point 1 for publishing now: while all publishing is paused an agent's publish is refused and nothing reaches X. The tick, one-account pause and resume answers (will_post, held_overdue) for points 1 to 3 are in `src/stump/publish/tick.ts` and `src/stump/tools/calendar.ts`, not yet asserted in a repo test.

### More channels and formats

#### STUMP-PUBLISH-009 — Images, video and alt text per network

Core · target · **missing** · From new · Cites BASE-INPUT-003 · Register R-28

**Requirement.** Each network's media rules are kept as data: counts, sizes, formats, aspect ratios, video length and whether alt text is supported. Stump checks media against the target account's network before ready, converts where it can without loss of meaning, and sends alt text wherever the network accepts it.

**Acceptance.** Through the app and MCP, against the network fakes:
1. A fifth image on a Bluesky post is refused before ready.
2. A PNG for a network that takes only JPEG is converted, and the alt text goes with it.
3. A video over a network's length limit is refused with the limit.
4. The read-back post carries the alt text on every network that supports it.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-010 — Edit and delete published posts

Core · target · **missing** · From new · Rules D-5

**Requirement.** Where a network allows it, a person edits or deletes a published post from Stump. An edit adds a ledger version with the network's read-back; a deletion is requested at the network, confirmed by read-back, and recorded. Where a network has no edit, Stump says so and offers delete and repost.

**Acceptance.** Through the app and MCP, against the network fakes:
1. Editing a Mastodon post adds a ledger version that matches the read-back.
2. Deleting a Bluesky post is confirmed by read-back and recorded in the ledger.
3. A network without edit shows that, and offers delete and repost.
4. A failed deletion stays visible with the network's error.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-022 — Follow-ups on your own posts

Core · target · **missing** · From new · Rules D-4, D-5

**Requirement.** A person attaches follow-ups to their own post: an auto-plug, a reply on that post with their text and link that publishes once the post passes a threshold they set (likes, reposts or replies) within a window; reposts of the post at later times they choose; and an evergreen tag that re-queues the post on a cycle they set. Follow-ups act only on the author's own posts on X, Bluesky, Mastodon and Threads, within each network's rules, and never on anyone else's post; on LinkedIn the follow-up is the first comment (STUMP-PUBLISH-021). An evergreen re-queue passes the near-duplicate check (STUMP-TRUTH-004) like any item.

**Acceptance.** Through the app and MCP, against the network fakes:
1. An auto-plug set at 20 likes publishes once as a reply on the post when the read-back count reaches 20, and never if the window ends first.
2. A repost of the person's own Bluesky post publishes at its time and reads back.
3. An evergreen post re-queues into the next open slot after its cycle, as a new item linked to the first.
4. An evergreen re-queue inside the company's near-duplicate window is held with its match, and outside it passes.
5. A follow-up aimed at another account's post is refused.
6. Deleting or editing the original post cancels its pending follow-ups and lists them.
7. Each follow-up appears in the ledger linked to its original post.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-011 — Own community announcements

Core · target · **missing** · From new · Register R-14

**Requirement.** The company posts announcements to its own community channels: a Discord channel through a webhook, a Slack workspace channel through an app, and a Telegram channel through a bot. These are the company's own spaces, so they follow its own rules, and the ledger records each post.

**Acceptance.** Through the app and MCP, against fakes of each API:
1. An announcement posts to a Discord webhook and records the message id.
2. The same announcement posts to a Slack channel and a Telegram channel.
3. A removed webhook shows its failure and holds the item.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-012 — Articles to the company blog and developer platforms

Core · target · **missing** · From new · Register R-14

**Requirement.** Stump publishes articles to the company's own blog (Pane, Ghost or WordPress) and copies them to developer platforms (DEV and Hashnode) through their APIs, each copy with its canonical link to the original. Platforms whose APIs no longer take new articles get a hand-off with the article ready to paste.

**Acceptance.** Through the app and MCP, against fakes of each API:
1. An article publishes to Ghost and reads back its URL.
2. A copy to DEV carries the Ghost URL as its canonical link.
3. A copy to Hashnode does the same.
4. A platform without an article API gets a hand-off with the article and canonical link.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-013 — Connection health and network costs

Core · target · **missing** · From new · Cites BASE-OPS-004

**Requirement.** Each connection shows its state (connected, expiring, expired, revoked, rate-limited), its token expiry, the scopes it holds, and, for metered networks, its spend this month. Stump refreshes tokens before they expire and tells the account's owner in good time when they must reconnect.

**Acceptance.** Through the app and MCP:
1. A token near expiry refreshes and the connection stays connected.
2. A token that cannot refresh tells the owner seven days ahead and holds their items once it lapses.
3. A revoked connection reads as revoked, with its items listed.
4. X spend this month equals the sum of the ledger's recorded charges.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-014 — Instagram professional accounts

Core · target · **missing** · From new · Rules D-5 · Register R-16

**Requirement.** Stump publishes to the company's Instagram professional account through Meta's content publishing API: images, video, carousels of both, and reels with a cover and a share-to-feed choice, each with alt text where Instagram takes it, a caption within its limit, and a first comment the author writes with the post. Stories are STUMP-PUBLISH-023. Publishing stays within the per-account 24-hour limit in the network table, and results read back from Instagram's insights. Until the company's Meta app passes App Review, only accounts with a role on the app can connect, and Stump shows that state.

**Acceptance.** Against an official-schema fake of Instagram's Graph API, through the app and MCP:
1. A carousel of three images and a video publishes through Meta's container steps and reads back its permalink.
2. A reel publishes with its cover and share-to-feed choice once its container finishes, and reads back.
3. A single image publishes with its alt text and reads back with it.
4. A first comment publishes on the post once it reads back, and both reach the ledger.
5. A PNG is converted to JPEG before publishing, keeping its alt text.
6. The post past the table's 24-hour limit holds to the next allowed time, and the remaining quota shows.
7. Reach, likes, comments, saves and shares read back from insights for a post's first week.
8. Before App Review, an account without a role on the app shows the review step instead of failing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-023 — Stories on Instagram and Facebook

Core · target · **missing** · From STUMP-PUBLISH-014 · Rules D-5 · Register R-16

**Requirement.** A person schedules Stories (an image or a short video, with its text and link) for the company's Instagram professional account and Facebook Page. Where Meta's API takes the Story for that account, Stump publishes it at its time and reads it back. Where it does not, Stump sends the owner a reminder on their phone at that time with the media saved and the text and link ready to copy, and the owner records the Story once posted. Each Story's views and replies read back while Meta serves them, and every Story stays on the ledger after it expires.

**Acceptance.** Against an official-schema fake of the Graph API's Stories endpoints and the mobile apps on simulators:
1. An image Story publishes to Instagram through the API at its time and reads back.
2. A video Story publishes to the Facebook Page the same way.
3. For an account the API does not serve, the owner's phone gets the reminder at its time with the media saved and the text ready.
4. Recording the posted Story marks it posted on the ledger, as confirmed by the person.
5. A reminder snoozed for 30 minutes returns once, and an unrecorded Story lapses with its reason.
6. Views and replies read back for a published Story, and the ledger keeps it after it expires.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-016 — Facebook Pages

Core · target · **missing** · From new · Rules D-5 · Register R-16

**Requirement.** An admin connects the company's Facebook Page through Meta's Pages API. Stump publishes text, link and photo posts, multi-photo posts, videos and reels to the Page with alt text where Meta accepts it, schedules them at the Page's time, posts a first comment the author writes with the post, and reads each post's results (reach, reactions, comments, shares and clicks) from Page insights. Until the company's Meta app passes App Review for the Page permissions, only people with a role on the app can connect a Page, and Stump shows that state.

**Acceptance.** Against an official-schema fake of the Graph API's Pages endpoints, through the app and MCP:
1. A link post publishes to the Page and reads back with its id and permalink.
2. A post with four photos and their alt text publishes as one post and reads back.
3. A reel publishes once its upload finishes processing, and reads back.
4. A first comment publishes on the Page's post after the post reads back.
5. Reach, reactions, comments, shares and clicks read back from insights for a post's first week.
6. A person Meta does not list with a task on the Page cannot connect it, and the role Meta reports is named.
7. While the Meta app has not passed App Review, a Page outside the app's roles shows the review step instead of failing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-015 — YouTube videos and Shorts

Core · target · **missing** · From new · Rules D-5 · Register R-18

**Requirement.** Stump uploads videos and Shorts to the company's YouTube channel through the YouTube Data API: title, description, tags, category, a custom thumbnail, captions, the made-for-kids and altered-content answers, privacy and a scheduled publish time, plus a first comment the author writes with the video. Each upload counts against the project's daily quota from the network table, and Stump shows the quota left. YouTube keeps videos uploaded by unaudited API projects private, so until the company's project passes YouTube's audit, Stump shows uploads as private and says why. Views, likes, comments and watch time read back for each video.

**Acceptance.** Against an official-schema fake of the YouTube Data API, through the app and MCP:
1. A video uploads with its title, description, tags, thumbnail and captions, and reads back with its id and URL.
2. A vertical video within the Shorts length reads back as a Short.
3. A video scheduled for 9:00 America/New_York goes public at that time.
4. A first comment publishes on the video after it reads back.
5. Each upload's quota use reads back, and an upload past the day's quota is held to the next quota day.
6. From an unaudited project, an upload reads as private with the audit step named.
7. Views, likes, comments and watch time read back for a video's first week.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-018 — TikTok videos and photo posts

Core · target · **missing** · From STUMP-PUBLISH-015 · Rules D-5 · Register R-17

**Requirement.** Stump posts videos and photo carousels to a connected TikTok account through TikTok's Content Posting API. Before each post it reads the creator's settings from TikTok (the privacy levels allowed, whether comments, duets and stitches can be on, and the longest video allowed), and the person picks from those, with the commercial-content disclosure TikTok asks for. TikTok keeps posts from unaudited apps private, so until the company's app passes TikTok's audit, Stump shows posts as private and says why. Each post's status is polled until TikTok reports it published, and its views, likes, comments and shares read back.

**Acceptance.** Against an official-schema fake of TikTok's Content Posting and Display APIs, through the app and MCP:
1. A video posts after the creator settings are read, at the person's chosen privacy level, and reads back once TikTok reports it published.
2. A photo carousel posts with its images in order and reads back.
3. A video longer than the creator's maximum is refused before scheduling.
4. A post marked as branded content carries TikTok's disclosure.
5. From an unaudited app, a post reads as private with the audit step named.
6. A post TikTok reports failed shows TikTok's reason and is never retried blindly.
7. Views, likes, comments and shares read back for a post's first week.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-019 — Pinterest Pins

Core · target · **missing** · From STUMP-PUBLISH-016 · Rules D-5 · Register R-19

**Requirement.** Stump publishes Pins to the company's Pinterest boards through the Pinterest API: image and video Pins and image carousels, each with a title, description, alt text, board or section, and a destination link carrying the company's tags. Impressions, saves, Pin clicks and outbound clicks read back for each Pin. Until the company's Pinterest app holds Standard access, Stump shows the access step and the trial limits Pinterest applies.

**Acceptance.** Against an official-schema fake of the Pinterest API, through the app and MCP:
1. An image Pin publishes to a chosen board with its title, description, link and alt text, and reads back.
2. A carousel Pin publishes its images in order and reads back.
3. A video Pin publishes once Pinterest reports the media processed.
4. The destination link carries the company's UTM tags.
5. Impressions, saves and outbound clicks read back for a Pin's first week.
6. While the app holds trial access only, the connection shows the access step and the trial limits.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PUBLISH-020 — Google Business Profile posts and updates

Core · target · **missing** · From new · Rules D-5 · Register R-20

**Requirement.** An admin connects the company's Google Business Profile locations. Stump publishes update, offer and event posts to the chosen locations through the Business Profile API, each with a photo, a call-to-action button and a tagged link; keeps each location's hours and description current from one place; and reads each post's state and the profile's views and actions from Google. Google opens the API to a project only after it approves the company's access request; until then Stump shows the request step, and each post or update becomes a hand-off with its text and photo ready.

**Acceptance.** Against official-schema fakes of the Business Profile APIs, through the app and MCP:
1. An update post with a photo and a "Learn more" button publishes to two locations and reads back on each.
2. An offer post with its dates and an event post with its time read back with them.
3. A post Google rejects shows Google's reason and stays failed.
4. Changing holiday hours updates every chosen location and reads back.
5. Profile views and actions read back by week.
6. Without approved API access, the location shows the request step, and each post becomes a hand-off with its text and photo.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Inbox teamwork

#### STUMP-INBOX-003 — Assignment, states and hiding

Core · target · **missing** · From new

**Requirement.** Inbox items can be assigned, labelled, snoozed and marked done. Where the network allows it, a person hides or mutes a reply from Stump, and the hide is read back. Items that are support requests can go to HappyToHelp as a conversation.

**Acceptance.** Through the app and MCP:
1. Assigning an item notifies the assignee and shows it in their view.
2. Snoozed items return at their time.
3. Hiding an X reply is confirmed by read-back.
4. Sending an item to HappyToHelp creates a conversation there with its link.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-INBOX-004 — Saved replies, collisions and response times

Core · target · **missing** · From new · Rules D-2

**Requirement.** The team keeps saved replies with placeholders for the author's name and the product, which a person inserts and edits before sending; a saved reply passes the disclosure, claim and near-duplicate checks like any reply. When two people open the same inbox item, each sees the other, and a person who starts a reply while a colleague's is in progress is warned before sending. Stump reports response times (time to first reply and to done) by person, account, network and week, counted in the company's working hours.

**Acceptance.** Through the app at 1440 and 390 and MCP:
1. A saved reply inserts with the author's name filled in and can be edited before sending.
2. A saved reply used unchanged twice on the same account within the near-duplicate window is held until it is personalised.
3. When two people open the same item, each sees the other's presence within five seconds.
4. A person who starts sending while a colleague's reply is in progress is warned and can stop.
5. A reply sent by one person marks the item answered for the other at once.
6. Time to first reply and to done match the fixture by person, account and week, counting only working hours.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-INBOX-005 — Likes, reposts and quotes by a person

Core · target · **missing** · From new · Rules D-2, D-4

**Requirement.** From the inbox a person likes, reposts or quotes a mention or reply, from the company's account or their own, on X, Bluesky, Mastodon and Threads where the network's API offers the act. Each act is that person's own click: software never initiates one, because D-4 keeps engagement a person's own act, and LinkedIn engagement stays out of Stump. A quote is a post and passes the disclosure, claim and near-duplicate checks. Each act reads back from the network and is recorded with the person who did it, with any X charge.

**Acceptance.** Through the app, against the network fakes:
1. A person likes a Bluesky mention from the company's account, and the like reads back and is recorded with that person.
2. A person reposts and quotes an X mention; each reads back, and its X charge is recorded.
3. Undoing a like or repost removes it at the network and records the undo.
4. The API and MCP offer no like, repost or quote of another account's post, and such a call returns `act_refused` naming D-4's rule.
5. No like, repost or quote action exists for LinkedIn.
6. A quote without a needed disclosure cannot be sent.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Reviews

#### STUMP-REVIEW-001 — Review monitoring and replies as the company

Core · target · **missing** · From new · Rules D-4, D-7 · Register R-20, R-21

**Requirement.** Stump watches the company's reviews on Google (through the Business Profile API), G2 (through G2's API with the company's key) and Capterra (from the review notices the company forwards to Stump). Each review arrives with its rating, text, the reviewer's public name, date and link, and alerts the people the company chooses. A person replies as the company: on Google through the API, and on G2 and Capterra through a hand-off, text ready, to the person with vendor access. Replies pass the claim check, and Stump never writes or rates a review (D-4).

**Acceptance.** Against fakes of the Business Profile reviews API and G2's API, and a Capterra notice fixture, through the app and MCP:
1. A new Google review arrives once with its rating, text, reviewer and link, and alerts the chosen people.
2. A G2 review and a forwarded Capterra notice arrive the same way.
3. A reply to the Google review publishes through the API and reads back.
4. A reply to a G2 review becomes a hand-off to the person with vendor access, and the recorded reply is checked through G2's API.
5. A reply with an unmatched product claim is flagged before it can go out.
6. A request to draft a review as a customer returns `act_refused` citing the FTC rule.
7. Text in a review that tells Stump to act changes no route, rule or class.
8. Ratings by site, month and product show with averages and counts.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-REVIEW-002 — Review requests to every customer

Core · target · **missing** · From new · Rules D-4

**Requirement.** The company asks its customers for reviews on the site it chooses. Stump drafts the request and sends it as a campaign draft to Mango, or as a hand-off with the text for the company's own email tool, for every customer in the list the company picks. The list may be narrowed by facts such as plan or signup date, never by sentiment, rating, satisfaction score or support history, and an incentive, if any, goes to every reviewer whatever they write, as the FTC rule and the review sites' own rules require. Stump records each request and the reviews that follow it.

**Acceptance.** Through the app, MCP and a Mango fixture:
1. A review request for every customer on the Pro plan reaches Mango as a campaign draft with the review site's link.
2. Narrowing the list by satisfaction score, rating, sentiment or support history is refused, citing the review site's rule.
3. An incentive that depends on a positive review cannot be saved, and an incentive for every reviewer can.
4. Without Mango, the request becomes a hand-off with its text and the list's size.
5. Reviews that arrive after a request link to it.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Listening and alerts

#### STUMP-WATCH-014 — Alerts from the listening tools you already pay for

Core · target · **missing** · From new · Cites BASE-ACCESS-003, BASE-OPS-003 · Rules D-7 · Register R-23

**Requirement.** A company that already pays Syften, Octolens or F5Bot keeps that licence working inside Stump. Stump gives each tool a signed webhook URL (Syften and Octolens) or an inbound alert address (F5Bot, and any tool that alerts by email), and every alert arrives as a live finding with its source, link, author, matched keyword and the tool's name, so Reddit and the other sources those tools cover reach Stump with no request to the source. Alert findings rank, route and dedupe like any other, and their text is cached under the tool's terms.

**Acceptance.** Through the webhook and inbound-mail doors, against Syften, Octolens and F5Bot fixtures:
1. A Syften webhook for a Reddit comment becomes a finding with its link, author, keyword and "via Syften", and no request reaches reddit.com.
2. An Octolens webhook becomes a finding the same way.
3. An F5Bot alert email with three matches becomes three findings.
4. The same post alerted by two tools, or twice by one, becomes one finding naming both tools.
5. An unsigned or wrongly signed webhook, or mail from an address the company did not register, is refused and changes nothing.
6. A Reddit finding from an alert routes only to a hand-off.
7. Text in an alert that tells Stump to act changes no route, rule or class.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-006 — Developer and launch sources

Core · target · **missing** · From new

**Requirement.** Watches also cover GitHub issues and discussions through GitHub's search API with the company's token, Lobsters and DEV through their feeds and APIs, and Product Hunt through its API, each finding linked to its source.

**Acceptance.** Against official-schema fakes, through the app and MCP:
1. A GitHub watch returns matching issues and discussions with links.
2. Lobsters and DEV watches return matching items.
3. A Product Hunt watch returns matching launches and comments.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-007 — Reddit through a licensed supplier

Core · target · **missing** · From new · Cites BASE-DATA-004 · Register R-5

**Requirement.** Reddit's terms require written approval for commercial use of its data (`docs/networks.md`), so Stump watches Reddit through licensed data suppliers the company contracts with, each behind an adapter that records the supplier, its terms and its price. The first adapter is Meltwater's API, built and tested against Meltwater's published schema. The alerts a company already receives from its listening tools also cover Reddit (STUMP-WATCH-014). With neither, Stump shows "Reddit: not watched" and never scrapes Reddit.

**Acceptance.** Through the app and MCP, against an official-schema fake of Meltwater's API:
1. With Meltwater connected, a Reddit watch returns matching posts and comments with subreddit, author and link.
2. Each query records its cost in USD against the supplier.
3. Each finding names its supplier and the terms its text is held under.
4. A second poll adds no duplicates, and a post the supplier reports deleted has its cached text cleared.
5. The supplier connection shows its name, terms, price and last query.
6. Without a supplier or an alert tool, the watch reads "Reddit: not watched", and no request reaches reddit.com.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-015 — YouTube videos and comments

Core · target · **missing** · From new · Rules D-7

**Requirement.** A watch searches YouTube videos through the YouTube Data API with the company's key, and reads the comments on matching videos and on the company's own channel. Findings carry the video, channel, comment author, text and link. Each poll counts its quota units against the project's daily quota from the network table and shows what it used.

**Acceptance.** Against an official-schema fake of the YouTube Data API, through the app and MCP:
1. A watch for a product name returns matching videos with their channel and link.
2. Matching comments on those videos arrive as findings linked to the comment.
3. A repeated poll adds no duplicates, matched by video and comment id.
4. Each poll records its quota units, and a watch that would pass the day's quota waits for the next quota day.
5. A comment deleted at YouTube has its cached text cleared at the next poll.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-016 — Stack Overflow and Stack Exchange

Core · target · **missing** · From new · Rules D-3, D-7

**Requirement.** A watch searches questions and answers on Stack Overflow and any other Stack Exchange site through the Stack Exchange API, by site, tags and terms, with the company's key for its higher quota. Findings carry the question, score, tags, author and link, and route by the site's venue rules.

**Acceptance.** Against an official-schema fake of the Stack Exchange API, through the app and MCP:
1. A watch on Stack Overflow for a product name in questions tagged `crm` returns matching questions and answers with links.
2. A watch limited to two sites returns findings from those only.
3. A repeated poll adds no duplicates, matched by post id.
4. The API's backoff field is honoured, and the watch shows when it will poll next.
5. A Stack Overflow finding routes by its venue's rules, and a site that bans AI-written answers gets a hand-off with a brief and no generated text.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-017 — Public Discourse forums

Core · target · **missing** · From new · Rules D-7

**Requirement.** A watch follows the public Discourse forums the company names (product communities and open-source project forums) through each forum's public JSON search and latest-topics endpoints, by category and tag, at the pace each forum's rate limits allow. Findings carry the topic, post, author, category and link. Stump reads only what a signed-out visitor can see.

**Acceptance.** Against a Discourse fixture serving its public JSON, through the app and MCP:
1. A watch on a forum returns matching topics and posts with links.
2. A watch limited to one category and one tag returns findings from those only.
3. A repeated poll adds no duplicates, matched by post id.
4. A rate-limit response is honoured, and the watch shows when it will poll next.
5. A category that needs sign-in is never read, and the watch says so.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-018 — Web and news search

Core · target · **missing** · From new · Cites BASE-DATA-004 · Rules D-7 · Register R-22

**Requirement.** A watch searches the general web and news through a licensed search API the company contracts with, behind an adapter that records the provider, its terms and its price; the first adapter is Brave Search's web and news API. Site filters let a watch cover places with no API of their own, such as Indie Hackers. Each query records its cost, and findings carry the page, publisher, date and link.

**Acceptance.** Against an official-schema fake of the Brave Search API, through the app and MCP:
1. A web watch and a news watch each return matching pages with publisher, date and link.
2. A watch limited to indiehackers.com returns findings from that site only.
3. A page found again by a later query adds no duplicate, matched by its canonical URL.
4. Each query records its cost in USD against the provider.
5. Without a provider, the watch reads "web: not watched" and offers a Google Alerts feed instead (STUMP-WATCH-002).

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-008 — Mentions and share of voice

Core · target · **missing** · From new

**Requirement.** Stump reports mentions of the company and its competitors over time by source, venue and product, with the share of voice among them, the sentiment of each mention (positive, neutral or negative, with its reason, which a person can correct), and the threads that drove each peak. A spike above a watch's usual range alerts its people.

**Acceptance.** Through the app at 1440 and 390 and MCP:
1. Mentions per week for the company and two competitors match the fixture.
2. Share of voice sums to 100% across the chosen names.
3. A peak links to the findings behind it.
4. Each mention shows its sentiment and reason, and a corrected sentiment holds and is counted.
5. A fixture spike three times the usual daily volume alerts the watch's people within 15 minutes.
6. On the labelled sentiment fixture, at least 85% of mentions get their labelled sentiment and at most 3% read as the opposite of their label, and the measured rates are published in `docs/measures.md`.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-009 — From a thread to an opportunity

Core · target · **missing** · From new · Rules D-3, D-4

**Requirement.** A person turns a finding into an opportunity: the thread, the venue's rules, why it fits, the facts to use and the route the venue allows (a reply from a connected account, a hand-off to a member, a hand-off with a brief only, or skip). An X finding from an account that has not engaged with the company's accounts routes only to a hand-off, so the named person replies in the X app (STUMP-WATCH-011). Opportunities have owners and due dates, and their outcomes are measured.

**Acceptance.** Through the app and MCP:
1. A Bluesky finding becomes an opportunity offering a reply from a connected account.
2. A forum finding where software may not post becomes a hand-off to a member.
3. An HN finding becomes a hand-off with a brief only.
4. An X finding from an account that has not engaged becomes a hand-off for the named person to reply in the X app, and no API reply is offered.
5. An opportunity's outcome links to its ledger entry.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-010 — Source terms and deletions

Core · target · **missing** · From new · Cites BASE-DATA-002 · Register R-15

**Requirement.** Each source's terms for stored content are recorded with their date. Stump keeps a finding's link, time and the company's own notes as company data, and holds text and media copied from a source as a cache under that source's terms. When a source reports a post deleted, Stump clears the cached copy and keeps the record that the finding existed.

**Acceptance.** Through the app and MCP, against the source fakes:
1. A Bluesky post deleted at the source has its cached text cleared at the next poll.
2. The company's notes on that finding stay.
3. Each source shows its recorded terms and their date.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-012 — Your own community's activity

Core · target · **missing** · From new · Rules D-7

**Requirement.** Stump reads activity in the company's own community spaces: Discord servers and Slack workspaces the company administers, through a bot its admins install with read access to the channels they choose, and the company's GitHub repositories (issues, discussions and stars). Members' questions become findings, and active members get profiles (STUMP-WATCH-019). Stump writes the notice that tells members which channels the bot reads, from the bot's actual channel list, and setup does not finish until an admin records where the notice is posted. Stump reads nothing in communities the company does not administer.

**Acceptance.** Against fakes of the Discord, Slack and GitHub APIs, through the app and MCP:
1. A question that mentions the product in a chosen Discord channel becomes a finding with its link.
2. A channel the admins did not choose is never read.
3. Issues, discussions and stars on the company's repositories show for each member.
4. Setup writes the notice text listing exactly the channels the bot reads, and does not finish until an admin records the notice's link.
5. Adding a channel updates the notice text, and that channel is not read until the updated notice's link is recorded.
6. Removing the bot stops reading, and the connection reads as removed.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-019 — Community members, segments and timelines

Core · target · **missing** · From STUMP-WATCH-012 · Rules D-7

**Requirement.** Each person active in the company's own spaces (Discord, Slack, GitHub) or on its connected accounts has a member profile: their handles, joined only where the member links them publicly or an admin links them; their activity counts; first and last seen; and a timeline of every message, issue, star, reply and mention in time order. Enrichment is limited to what the member shows publicly on those profiles. Segments are saved filters (activity, space, product, first seen, tags), and a segment can feed an alert, a digest or Orbit. Members imported from Common Room arrive the same way (STUMP-IMPORT-008).

**Acceptance.** Against the Discord, Slack and GitHub fakes, through the app and MCP:
1. A member active in Discord and on GitHub shows one profile where the GitHub profile links the Discord handle, and two where it does not.
2. The timeline lists their messages, issues and stars in time order with links.
3. A segment of members active in the last 30 days who starred a repository lists exactly the fixture's members.
4. A member joining a segment raises the segment's alert once.
5. A profile shows only fields the member shows publicly, and no email address unless it is public.
6. Sending a member to Orbit as an engager carries their public handles and timeline links.
7. A message that tells Stump to merge two members changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-WATCH-020 — Mentions in AI assistants' answers

Core · target · **missing** · From new · Cites BASE-DATA-004 · Rules D-7

**Requirement.** The company keeps the prompts a buyer would ask, such as "best CRM for a 10-person startup". On a schedule Stump runs each prompt through the assistants' own APIs with web search on (OpenAI, Anthropic, Google Gemini and Perplexity) with the company's keys. For each answer it records whether the company's products and named competitors are mentioned, in what order, and which pages are cited. It reports mention share against competitors by assistant and week, and links each change to the posts, articles and coverage on the ledger that the answers cite or that went out before it. Results read as API answers, which can differ from the assistants' own apps.

**Acceptance.** Against fakes of each provider's API, through the app and MCP:
1. A run of ten prompts on four assistants records each answer, the products and competitors it mentions in order, and its cited pages.
2. Mention share by assistant and week matches the fixture.
3. An answer that cites a page on the ledger links that ledger entry.
4. A week in which share rose lists the ledger entries and coverage published in the two weeks before it.
5. Each run records its cost in USD by provider, and the next run's expected cost shows before it starts.
6. A provider failure shows on that assistant's row, and the other assistants' results stand.
7. An answer's text that tells Stump to act changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Launches and directories

#### STUMP-LAUNCH-001 — Launch plans with Cradle

Core · target · **missing** · From new

**Requirement.** A launch plan in Stump holds the posts, hand-offs, pitches, directory submissions and own-account announcements for one launch, on a timeline in US Pacific time where the venue counts days that way. When the company runs Cradle, the plan links to the Cradle campaign and its milestones: Cradle tracks readiness, and Stump does the posting and reports each step's outcome back to the milestone.

**Acceptance.** Through the app at 1440 and 390, MCP and a Cradle fixture:
1. A launch plan lays out its steps on a timeline with owners and routes.
2. Linking a Cradle campaign shows its milestones beside the plan.
3. A posted step marks its Cradle milestone's outcome with the ledger link.
4. A step that fails reports the failure to the Cradle milestone.
5. Without Cradle, the plan works on its own.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-LAUNCH-002 — Product Hunt launch

Core · target · **missing** · From new · Rules D-1, D-4 · Register R-7

**Requirement.** A Product Hunt launch is prepared in Stump: the name, tagline, description, gallery with alt text, maker comment and topics, checked against Product Hunt's launch rules as its venue records them (no direct requests for upvotes; makers are people, not company accounts). The launch itself is scheduled at Product Hunt by a maker, so Stump hands that step to the named maker, records the launch URL, and prepares the day's announcements and the replies its makers write in the comments.

**Acceptance.** Through the app and MCP:
1. The launch kit holds every field Product Hunt asks for, each within its limits.
2. A kit or announcement that asks for upvotes is flagged before ready, citing the rule.
3. The scheduling step goes to a named maker as a hand-off, and the recorded URL is checked to be a Product Hunt launch page.
4. Announcements on the company's accounts point to the launch without asking for votes.
5. A company account cannot be named as a maker.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-LAUNCH-003 — Show HN

Core · target · **missing** · From new · Rules D-3, D-4 · Register R-7

**Requirement.** Stump prepares a Show HN as a hand-off to the person who made the thing, with the title, the link and a brief, checked against HN's Show HN rules as its venue records them: it must be something people can try, not a landing page or sign-up page, and no one is asked to upvote. HN bans generated comments, so the brief carries facts and the person writes their own text. Comments on the post appear as findings for the maker to answer by hand.

**Acceptance.** Through the app and MCP:
1. The Show HN hand-off holds the title, the link and a brief with facts and no generated text.
2. A link to a sign-up page is flagged, citing Show HN's rule.
3. The recorded HN URL is checked to be an HN item by the maker's recorded handle.
4. New comments on the post arrive as findings linked to it.
5. No step in the plan asks anyone to vote.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-LAUNCH-004 — Directory submissions

Core · target · **missing** · From new · Rules D-3

**Requirement.** The company tracks its submissions to directories and launch lists (BetaList, AlternativeTo, SaaS directories and awesome-lists): the listing text, category, price if paid, the person who submitted, the state (draft, submitted, live, rejected), the listing URL, and the renewal date. Where a directory takes submissions by API Stump submits; otherwise the submission is a hand-off.

**Acceptance.** Through the app and MCP:
1. A directory submission moves from draft to submitted to live with its listing URL.
2. A paid listing records its price in USD and its renewal date, and its owner is told before renewal.
3. A directory without an API produces a hand-off with the listing text.
4. A rejected submission keeps its reason.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Press and podcasts

#### STUMP-PITCH-001 — Journalists, publications and podcasts

Core · target · **partial** · From new

**Requirement.** Journalists, publications, newsletters and podcasts are venues with their beats or topics, audience, submission routes and past coverage. A contact address or handle is recorded only when it appeared in full on a public page, and the page and the date it was read are kept; otherwise the record names the public route instead (a form, a guest intake, a public handle). Stump never guesses an address.

**Acceptance.** Through the app and MCP:
1. A journalist record holds beat, publication, public contact route and its source page and date.
2. An address without a source page cannot be saved.
3. A podcast record holds its guest intake route and topics.
4. A publication lists its journalists and past coverage of the company.

**Evidence.** `agent-surface.json` journey (stump shard of `verification.json`) step "journalist"
**Gap.** Journalist, publication and podcast records with beat, topics and a contact route kept only with its source page and read date (an address without a source is refused) are built, and a pitch names its recipient. Not yet in a repo test; .4 (a publication's journalists and coverage) is not built.

#### STUMP-PITCH-002 — Pitches sent through Orbit

Core · target · **missing** · From new

**Requirement.** Stump drafts pitches to journalists and podcasts in the sender's voice with the facts and claims they use. A pitch goes to Orbit as a one-to-one message for that contact, where Orbit's outreach sends it (Orbit `OUT-001`) and records the reply. The reply and the outcome (declined, interested, covered) come back to Stump's ledger and the venue's history. Without Orbit, or where a journalist's public route is a direct message, the pitch is a hand-off for the sender to send by hand from their own mail or account.

**Acceptance.** Through the app, MCP and an Orbit fixture:
1. A pitch passes the claim check and arrives in Orbit as a one-to-one draft for the right contact.
2. Orbit's sent outcome writes the ledger entry, with Orbit as the route.
3. A reply in Orbit updates the pitch's outcome in Stump.
4. Without Orbit, the pitch becomes a hand-off with the text ready to send.
5. A journalist whose public route is an X direct message gets the pitch as a hand-off, and the sender records it as sent.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-PITCH-003 — Coverage and embargoes

Core · target · **missing** · From new

**Requirement.** Stump records earned coverage (articles, podcast episodes, newsletter mentions) with its link, date, outlet, the pitch or post that led to it, and its results. An embargo agreed with a journalist holds its date and time, and items that would break it hold until it lifts.

**Acceptance.** Through the app and MCP:
1. Coverage reads back linked to the pitch that led to it.
2. An embargo for 9:00 Eastern holds an item scheduled for 8:30, and releases it at 9:00.
3. Coverage appears in the campaign's results.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Outcomes, links and attribution

#### STUMP-LINK-001 — Tracked links and UTM tags

Core · target · **partial** · From new

**Requirement.** Every link to the company's own sites in an item carries UTM tags: the source (network or venue), the medium (social, community, referral, email or press), the campaign and the content (the item). The company sets its naming rules once, and Stump never tags links to other people's sites.

**Acceptance.** Through the app and MCP:
1. A link in a Bluesky post reads back with source, medium, campaign and content tags.
2. A link to a third-party site carries no tags.
3. Changing the naming rules changes the next item and leaves posted links as they were.

**Evidence.** `tests/stump/ledger-stack.test.mjs` "link tags go on the company's own links only, and engagers and annotations reach Orbit and Vane signed, sealed and recorded"; `tests/stump/accounts.test.mjs` "an agent posts to the company X account within the owner's dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge"
**Gap.** `tagOwnLinks` in `src/stump/links/` tags own domains only, keeps the author's parameters, and a rule change affects only the next text (points 2 and 3). The posting path tags every part of an item, and its link card, before it goes out (`src/stump/publish/outgoing.ts`): an X post goes out with its own link tagged and an outside link as written, and the ledger keeps the text read back. Point 1 names a Bluesky post, which takes the same path without a repo test against a PDS.

#### STUMP-LINK-002 — Short links on the company's domain

Core · target · **missing** · From new · Cites BASE-ACCESS-003, BASE-PUBLIC-001

**Requirement.** Stump can shorten tagged links on a domain the company owns, served by its own installation. A short link redirects without cookies or third-party requests, counts clicks without personal data, counts hits from link unfurlers and preview bots apart from clicks, and can have its destination changed, which is recorded.

**Acceptance.** Through the app, MCP and the public redirect:
1. A short link redirects to its tagged destination and counts the click.
2. The redirect sets no cookie and makes no third-party request.
3. Changing the destination is recorded and the next click goes to the new one.
4. An unknown short path returns 404.
5. Hits from the known unfurl and bot user agents of X, Slack, LinkedIn and the other services on the bot list are left out of click counts and shown separately.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-LINK-004 — Link-in-bio page

Core · target · **missing** · From new · Cites BASE-ACCESS-003, BASE-PUBLIC-001

**Requirement.** The company keeps a link-in-bio page for each of its accounts on a domain it owns, served by its own installation or rendered through Pane: a header, ordered links and featured posts, each link tagged with that account's UTM source and medium and shortened on the company's domain (STUMP-LINK-002). Editors change the page from Stump, and a change goes live at once or at a scheduled time. Clicks count per link without personal data, and the page loads with no cookies or third-party requests.

**Acceptance.** Through the app and the public page:
1. A page for the company's Instagram account lists its links in order, each tagged with source instagram and shortened.
2. A click on a link redirects and counts against that link and account.
3. A link scheduled for Monday 9:00 Eastern appears at that time and not before.
4. The page sets no cookie and makes no third-party request.
5. With Pane connected, the page renders through Pane with the same links and counts.
6. Hits from unfurlers and preview bots count apart from clicks.
7. An unknown page path returns 404.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-LINK-003 — Signups by post through Vane

Core · target · **missing** · From new

**Requirement.** When the company runs Vane, Stump reads Vane's attribution for its tagged links (Vane `DASH-004`) and its conversion goals, and shows visits, signups and revenue by post, venue, person and campaign, linked back to the ledger. Without Vane, Stump shows clicks from its short links only.

**Acceptance.** Through the app, MCP and a Vane fixture:
1. Signups attributed in Vane to a post's UTM content show on that post.
2. A venue's total equals the sum of its posts.
3. Without Vane, the post shows short-link clicks and says signups need Vane.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-LEDGER-004 — Reports and scheduled reports

Core · target · **missing** · From new · Cites BASE-MAIL-001

**Requirement.** Stump reports results by week or month for each channel, venue, person, product and campaign: posts, hand-offs, replies, results, clicks and signups, with the best posts and the venues that did nothing. A report can be exported as CSV and PDF and sent by email or Slack on a schedule.

**Acceptance.** Through the app at 1440 and 390 and MCP:
1. A weekly report's figures match the ledger and the Vane fixture.
2. The CSV export holds the same figures.
3. A scheduled report arrives by email at its local time with the same figures.
4. The PDF export holds the same figures and charts as the screen.
5. A scheduled report posts to a Slack channel at its local time with the same figures and a link to the full report.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Stack integrations

#### STUMP-STACK-001 — Penny releases as a source

Core · target · **missing** · From new · Cites BASE-ACCESS-003, BASE-OPS-003

**Requirement.** Stump receives Penny's signed event when a release is published (Penny `REL-002`) with its title, body, version and the requests it ships. The release becomes a source for drafting (STUMP-DRAFT-002). When Penny publishes a corrected version (Penny `REL-003`), drafts built on the earlier version are flagged.

**Acceptance.** Through the webhook door, the app and a Penny fixture:
1. A published release arrives once as a source with its fields.
2. A replayed event has no second effect.
3. An unsigned or wrongly signed event is refused and changes nothing.
4. A corrected release flags the drafts built on the earlier version.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-008 — Releases from GitHub and changelog feeds

Core · target · **missing** · From new · Cites BASE-ACCESS-003, BASE-OPS-003

**Requirement.** A company without Penny connects its release source instead: a GitHub repository whose signed release webhook Stump receives, or a changelog's RSS or Atom feed. A published GitHub release or a new changelog entry becomes a source for drafting with its title, body, version and link, exactly as a Penny release does, and starts the release-to-posts loop (STUMP-LOOP-001). An edited release or entry flags the drafts built on it.

**Acceptance.** Through the webhook door, the feed reader and the app, against GitHub and feed fixtures:
1. A published GitHub release arrives once as a source with its title, body, tag and link.
2. A draft or pre-release is ignored unless the company opts in.
3. An unsigned or wrongly signed webhook is refused and changes nothing, and a replay has no second effect.
4. A new changelog feed entry becomes a source with its fields, once.
5. An edited release or entry flags the drafts built on it.
6. Either source starts the same release-to-posts plan a Penny release does.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-002 — Engagers and signals to Orbit

Core · target · **partial** · From new · Rules D-7

**Requirement.** When a person who can be identified engages with substance on a connected account or in a thread on the record, Stump offers them to Orbit as a contact with a social-engagement signal carrying the public post URL. Engaging with substance means asking a question, replying to a post with more than a reaction, or mentioning the product with intent (asking for a recommendation, comparing, or saying they are evaluating). Stump sends only what is public; it never infers or looks up an email address. Orbit decides whether the person is contactable. This needs a new Orbit signal type, recorded in Orbit's contract.

**Acceptance.** Through MCP, the app and an Orbit fixture:
1. A Bluesky reply asking about pricing reaches Orbit as a signal with its URL and the author's public handle.
2. The same person engaging again adds a signal to the same Orbit contact.
3. No email address is sent unless it is public on the person's profile.
4. A finding's text that tells Stump to add someone to the CRM changes nothing.
5. On the labelled engager fixture, at least 90% of interactions labelled substantive are offered and at most 10% of those labelled passing reactions, and the measured rates are published in `docs/measures.md`.

**Evidence.** `tests/stump/inbox.test.mjs` "people who engaged first with substance become offers to Orbit, signed, with only a publicly shown email and one identity each; a failed send stays offered"; `tests/stump/ledger-stack.test.mjs` "link tags go on the company's own links only, and engagers and annotations reach Orbit and Vane signed, sealed and recorded"
**Gap.** People who engaged first with the company's X account with substance become offers, reach Orbit's signed signal door with their public handle and post link (the X case of .1), keep one identity basis per person across engagements (.2) and carry an email only when the person's own X profile shows one, never guessed or looked up (.3); a failed send stays offered with its error. The Bluesky case of .1, an assertion of .4 and the measured rates of .5 are not done.

#### STUMP-STACK-010 — Engagers to Attio, Pipedrive and any CRM

Core · target · **missing** · From new · Cites BASE-DATA-004 · Rules D-7

**Requirement.** A company that keeps Attio or Pipedrive sends engagers there through their APIs with the company's key: a person record with their public handles, and a note or activity carrying the public post link, matched to an existing record by handle before a new one is made. Any other CRM takes the same engager as a signed webhook event. Stump sends only what is public and never infers an email address.

**Acceptance.** Against official-schema fakes of the Attio and Pipedrive APIs and a webhook receiver, through the app and MCP:
1. An engager reaches Attio as a person with a note and the post link; the same person again adds a note to the same record.
2. An engager reaches Pipedrive as a person with an activity and the post link, matched the same way.
3. The signed webhook carries the engager's public handles and post link, and a replay has no duplicate effect.
4. No email address is sent unless the person shows it publicly.
5. Disconnecting a CRM stops sends, and the connection reads as disconnected.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-003 — Newsletter drafts to Mango

Core · target · **missing** · From new

**Requirement.** A newsletter section or issue drafted in Stump goes to Mango as a campaign draft (Mango `CAMP-001`) with its sources and claims. Mango keeps the audience, consent, approval and sending; Stump records the issue in its ledger when Mango reports it sent.

**Acceptance.** Through the app, MCP and a Mango fixture:
1. A newsletter section arrives in Mango as a draft campaign with its text and links.
2. Mango's sent report writes the ledger entry, with Mango as the route.
3. Stump never sends email to a newsletter audience itself.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-009 — Newsletter drafts to beehiiv, Kit and Ghost

Core · target · **missing** · From new · Cites BASE-DATA-004

**Requirement.** A company that keeps beehiiv, Kit or Ghost instead of Mango sends a newsletter section or issue drafted in Stump to that tool as a draft, through its API with the company's key: a beehiiv post draft, a Kit broadcast draft or a Ghost newsletter post draft, with its text, links and images. The newsletter tool keeps the audience, consent and sending; Stump records the issue in its ledger when the tool reports it sent.

**Acceptance.** Against official-schema fakes of the beehiiv, Kit and Ghost APIs, through the app and MCP:
1. A section arrives in beehiiv as a draft post with its text, links and images.
2. The same issue arrives in Kit as a draft broadcast and in Ghost as a draft newsletter post.
3. An issue the tool reports sent writes the ledger entry, with the tool as the route.
4. Stump never schedules or sends an issue in the tool itself.
5. Disconnecting the tool stops sends, and the connection reads as disconnected.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-004 — Annotations to Vane

Core · target · **partial** · From new

**Requirement.** Each published item, launch and coverage piece adds a dated annotation in Vane through its annotation door (Vane `DASH-009`), linked to the ledger entry, so traffic changes line up with what was posted.

**Acceptance.** Through the app and a Vane fixture:
1. A published post adds one annotation on its day with its link.
2. A launch adds one annotation for the launch.
3. A deleted post marks its annotation as deleted.

**Evidence.** `tests/stump/ledger-stack.test.mjs` "link tags go on the company's own links only, and engagers and annotations reach Orbit and Vane signed, sealed and recorded"; `tests/stump/accounts.test.mjs` "an agent posts to the company X account within the owner's dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge"
**Gap.** `annotateLedgerEntry` sends one annotation of kind campaign on the post's day with its link through Vane's annotation door and records the outcome. The posting path calls it once each post is read back and on the ledger, and records Vane's answer on the entry; a failure never holds or undoes the post (point 1). Launches and deleted posts (points 2 and 3) are not built.

#### STUMP-STACK-005 — Notices by email, Slack and push

Core · target · **missing** · From new · Cites BASE-MAIL-001

**Requirement.** Each person chooses where they hear about their hand-offs, alerts, failures, uncertain items, connection expiry and sign-off requests: in the app, by email, by Slack direct message or by push. A notice links to its item and can be acted on from there.

**Acceptance.** Through email, a Slack fixture and the app:
1. A new hand-off reaches its person by their chosen channels with a link.
2. An uncertain item reaches its hold owner.
3. Turning a channel off stops its notices.
4. A notice's mail outcome reads back as queued, submitted, failed or delivered as the provider reports it.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-006 — API, webhooks, Zapier and Make

Core · target · **missing** · From new · Cites BASE-SECRET-001, BASE-OPS-003 · Register R-26

**Requirement.** A versioned API covers venues, items, hand-offs, the ledger, findings and campaigns, with named keys and scopes. Signed outgoing webhooks report item, hand-off, finding and inbox events, with replay, so tools such as Crank can act on them. Stump's Zapier and Make apps offer the same events as triggers and the API's main writes as actions, each authenticated with a Stump API key and limited to its scopes.

**Acceptance.** Through the API, a webhook receiver and Zapier and Make test harnesses:
1. A key with read scope reads venues and is refused a write.
2. A published item emits a signed webhook, and a replay has no duplicate effect.
3. A revoked key is refused at the next call.
4. A failed webhook is visible and can be replayed.
5. A Zapier trigger on a published item fires once per item, with the same payload as the webhook.
6. A Make trigger on a new finding fires once per finding, and a Make action creates an idea within its key's scope.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-STACK-007 — HubSpot and Google Analytics for companies that keep them

Core · target · **missing** · From new · Cites BASE-DATA-004, BASE-SECRET-001 · Rules D-7

**Requirement.** A company that keeps HubSpot instead of Orbit sends engagers to HubSpot as contacts with a timeline note carrying the public post link, through a HubSpot private app token. A company that keeps Google Analytics instead of Vane gets visits and key events by UTM content from the GA4 Data API, so each post shows what it brought. Stump sends only what is public and never infers an email address.

**Acceptance.** Against fakes of the HubSpot and GA4 APIs, through the app and MCP:
1. An engager reaches HubSpot as a contact with a note and the post link; the same person again adds a note to the same contact.
2. GA4 sessions and key events by UTM content show on the right posts.
3. No email address is sent unless the person shows it publicly.
4. Disconnecting HubSpot or GA4 stops sends and reads, and the connection reads as disconnected.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Team, setup and connections

#### STUMP-TEAM-001 — Roles

Core · target · **partial** · From new · Cites BASE-ROLE-001, BASE-ACCESS-004

**Requirement.** Stump has six roles. A person's role decides what they can do through every door, and an agent acting for them has the same reach.

| Role | Can |
| --- | --- |
| Owner | Everything, including installation settings and transferring ownership |
| Admin | Team, company accounts, network apps, integrations and settings |
| Editor | Venues, brand, claims, drafts, scheduling and publishing to accounts they may use |
| Contributor | Drafts and submissions for sign-off |
| Poster | Their own hand-offs, their own accounts and their own voice guide; may be outside the company with a recorded connection |
| Viewer | Read venues, calendar, ledger and reports |

**Acceptance.** Through the app, the API and MCP:
1. Each role's allowed and refused actions match the table through every door.
2. A poster sees only their own hand-offs and accounts.
3. An owner cannot be removed or demoted until ownership is transferred to another person, and the transfer is recorded.
4. Changing a person's role changes their next request.

**Evidence.** `tests/stump/team.test.mjs` "people join only by invitation, with the invited role, through the person door", "the owner cannot be removed or demoted until ownership is transferred, and the transfer is recorded", "an agent credential acts for its person with exactly their role, follows role changes and ends when revoked", "a contributor drafts but cannot schedule or publish, and a poster sees only their own accounts and drafts"
**Gap.** Point 1 is proven for team actions, for Base's own account routes (which follow Stump's roles; a transfer moves the installation's sign-in owner too) and for scheduling, which is editors' work; each later area's actions add their role rows. Point 2 holds for accounts, drafts, queue slots and Pauses; hand-offs keep their own poster scope.

#### STUMP-TEAM-002 — Company-defined sign-off

Core · target · **missing** · From new · Cites BASE-ROLE-001

**Requirement.** The company defines its own sign-off paths: which accounts, venues, campaigns or roles a path covers, its steps in order, who signs off at each step (named people or a role), and whether a step needs one of its people or all of them. It can turn sign-off off entirely or for some accounts; setup asks for these choices with nothing preselected. Each sign-off binds to the exact revision, and an edit after sign-off starts the path again. A path applies to an item whoever drafted it, a person or an agent acting for one.

**Acceptance.** Through the app and MCP:
1. Under a two-step path (an editor, then the founder), an item can be scheduled only after both sign off revision 2, in that order.
2. A path that covers only the LinkedIn page holds page items until the page's signer signs off, and items for other accounts need no sign-off.
3. With sign-off turned off, an editor's item can be scheduled at once, and its history says no path applied.
4. A step that needs all its people waits for each; a step that needs one finishes at the first.
5. An edit after sign-off starts the path again, and the signed revision never posts.
6. Sending back with comments returns the item to its author.
7. A contributor's submission enters the path that covers its account, and a contributor cannot schedule or publish.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-TEAM-003 — Account delegation and per-account grants

Core · target · **missing** · From new · Cites BASE-ROLE-001, BASE-ACCESS-004

**Requirement.** The owner of a personal account names which colleagues may schedule to it. Company accounts follow roles, and an admin can narrow a person to named company accounts with a grant per account, so a contractor can schedule to the LinkedIn page and nowhere else. Delegations and grants apply through every door, and an agent has exactly its sponsor's. Revoking a delegation or a grant unschedules the items that person queued on that account and lists them to the account's owner or the admin.

**Acceptance.** Through the app, the API and MCP:
1. A colleague without delegation cannot schedule to a person's account.
2. Granting delegation lets them schedule, and it is recorded.
3. Revoking it unschedules their queued items there and lists them to the owner.
4. A contractor granted only the LinkedIn page can schedule there and is refused on every other company account, through every door.
5. An agent acting for that contractor has exactly the contractor's grants and delegations.
6. Removing the grant unschedules the contractor's queued page items and lists them to the admin.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Imports and portability

#### STUMP-IMPORT-003 — Hootsuite

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports Hootsuite's bulk-composer files and its post-performance report exports: scheduled posts, published posts and their results, with the same dry run, apply, undo and paused-queue rules as STUMP-IMPORT-001.

**Acceptance.** Through the import screen, against Hootsuite fixtures:
1. A bulk-composer file arrives as paused scheduled items.
2. A post-performance export brings published posts and results into the ledger.
3. Running the import again changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-004 — Postiz

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports from Postiz through its public API or a database export: integrations (as accounts to reconnect), posts in every state, and schedules, with the same dry run, apply, undo and paused-queue rules as STUMP-IMPORT-001.

**Acceptance.** Through the import screen, against a Postiz fixture:
1. Postiz integrations arrive as accounts waiting for their owners to reconnect.
2. Published posts arrive in the ledger, and scheduled posts arrive paused.
3. Running the import again changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-005 — Sprout Social

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports Sprout Social's message and report exports: published posts with their results, and scheduled posts, with the same dry run, apply, undo and paused-queue rules as STUMP-IMPORT-001.

**Acceptance.** Through the import screen, against Sprout fixtures:
1. Published posts arrive in the ledger with their results.
2. Scheduled posts arrive paused.
3. Running the import again changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-008 — Common Room

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001 · Rules D-7

**Requirement.** Stump imports from Common Room through its API with the company's key or from its CSV exports: members with their linked handles and public profile fields, their activities (messages, issues, stars and posts) with dates and links, and segments with their members. Members become member profiles (STUMP-WATCH-019), activities their timelines, and segments saved segments. Fields a member did not show publicly, such as a vendor-enriched work email, are not imported. The same dry run, apply and undo rules as STUMP-IMPORT-001 apply.

**Acceptance.** Through the import screen, against a Common Room fixture:
1. A dry run reports members, activities, segments and rejected rows with reasons, and writes nothing.
2. Apply creates member profiles with their handles, and their activities as timelines in order.
3. A segment arrives as a saved segment with the same members.
4. Enriched fields the member did not show publicly are reported as skipped and not imported.
5. Running the import again changes nothing, and undo removes what it created.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-009 — Blotato

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports from Blotato through its API with the company's key: connected accounts (as accounts waiting for their owners to reconnect), scheduled posts, and published posts with their media and results, with the same dry run, apply, undo and paused-queue rules as STUMP-IMPORT-001.

**Acceptance.** Through the import screen, against an official-schema Blotato fixture:
1. Blotato accounts arrive as accounts waiting for their owners to reconnect.
2. Published posts arrive in the ledger with their links, media and results.
3. Scheduled posts arrive paused until the person confirms Blotato no longer holds them.
4. Running the import again changes nothing, and undo removes what it created.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-010 — Later, Publer and Metricool

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** Stump imports the CSV exports of Later, Publer and Metricool through a mapping profile for each, which maps their columns to Stump's accounts, times, text, links, media URLs and results; the profiles ship with Stump, and a person can adjust a copy. Published posts with their results, and any scheduled posts an export holds, arrive with the same dry run, apply, undo and paused-queue rules as STUMP-IMPORT-001. Any other tool's CSV, such as Hypefury's, goes through the same mapper with a profile the person builds.

**Acceptance.** Through the import screen, against each tool's export fixture:
1. A Later export, mapped by its profile, brings published posts and results into the ledger, and its scheduled posts arrive paused.
2. A Publer export does the same.
3. A Metricool export does the same.
4. A person adjusts a copy of a profile, and the shipped profile stays unchanged.
5. A profile a person builds for another tool's CSV imports through the same dry run and apply.
6. Running any import again changes nothing, and undo removes what it created.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-IMPORT-007 — Your own post history

Core · target · **missing** · From new · Cites BASE-INPUT-001, BASE-DATA-001

**Requirement.** A person brings in their own past posts: an X archive, a LinkedIn data export, a Bluesky repository export and a Mastodon archive. Their posts fill the ledger as history and can feed their voice guide (STUMP-BRAND-002).

**Acceptance.** Through the import screen, against each fixture:
1. An X archive's posts arrive in the ledger as that person's history with their links.
2. A LinkedIn export's shares arrive the same way.
3. Bluesky and Mastodon archives arrive the same way.
4. The person can pick imported posts to build their voice guide.
5. Running the import again changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-DATA-001 — Full export and restore

Core · target · **missing** · From new · Cites BASE-DATA-001, BASE-BACKUP-001

**Requirement.** One archive holds everything the company keeps in Stump: venues and rules, people (without tokens), voice guides, brand profiles and claims, items with every revision, the ledger, findings within their sources' terms, campaigns, launches, pitches, reports and settings, with media. Restoring it into an empty installation gives the same records; accounts are reconnected by their owners, because tokens never leave the installation.

**Acceptance.** Through the app and the export and restore doors:
1. Export, restore into an empty installation and export again gives equivalent archives.
2. The archive holds no token or key.
3. Restored accounts read as waiting for their owners to reconnect.
4. Scheduled items restore paused.

**Evidence.** None.
**Gap.** Built, not yet asserted in a repo test or journey: `rer export` and `rer import` carry every Stump record under `scripts/stump/archive-policy.mjs`, with no token or key (account credentials and network app keys left out, Orbit and Vane secrets and alert destinations cleared, agent credentials revoked), accounts waiting for their owners to reconnect (state expired, with the reconnect link) and scheduled items paused, so exporting the restored installation gives the same records. Base's `rer` takes the checkout's exclusive local-operation lock for export, so `rer export` refuses while `rer dev` runs and works once the app is stopped. Media travel in D1; findings follow no per-source terms yet.

#### STUMP-DATA-002 — Erasure of a person

Core · target · **partial** · From new · Cites BASE-DATA-003, BASE-DATA-006

**Requirement.** An operator erases a person outside the company (an engager, a journalist, a finding's author) or a former team member. Their personal data leaves findings, the inbox, venue records and voice guides; ledger entries keep the post and an anonymised reference. Posts the company made on outside networks that name the person are listed for deletion at each network, each with its outcome, because a post already read or copied cannot be recalled.

**Acceptance.** Through the app and MCP:
1. Erasing a journalist removes their record and contact route, and leaves pitches with an anonymised reference.
2. Erasing an engager removes them from findings and the inbox.
3. Posts that name the person are listed with a delete request and outcome for each.
4. A ledger entry under legal hold keeps its data and shows the hold.

**Evidence.** `tests/stump/data.test.mjs` "erasing a person: an engager leaves findings, the inbox and offers, a journalist their record and route while pitches keep an anonymised reference, each company post naming them is asked to be deleted, and a legal hold keeps its entry"
**Gap.** Points 1, 3 and 4 are asserted through the person door (`stump.data.erase`), and point 2 for findings and the inbox. An engager is named by their handle on each network or source, and each handle matches only findings from that source, and inbox items, offers and ledger posts on that network. Each company post naming the person gets a delete request through its network publisher's `remove`, answered with its outcome, and a post the network deleted reads removed with the network's answer; until the publishers carry `remove`, the outcome reads failed with that reason. An erased engager stays out of later polls and backfills, an agent's keyed read answers current records, offers already sent to Orbit are listed, and a journalist leaves every form of their name in pitches and revisions and the outreach list import's copies, which the test checks across every table. A former team member's erasure is not built.

### Mobile apps

#### STUMP-MOBILE-001 — Native iOS and Android apps

Core · target · **missing** · From new · Cites BASE-ACCESS-002, BASE-ACCESSIBILITY-001 · Register R-10, R-11, R-12

**Requirement.** Stump has native iOS and Android apps, because posting by hand happens on a phone. A person works their hand-off queue (copy the text, open the venue's app, come back and share the posted link to Stump from the share sheet), answers their inbox, reads the calendar and gets push notices. The queue can be read offline. Composing, scheduling and sign-off on the phone are STUMP-MOBILE-002.

**Acceptance.** Through the iOS and Android apps on simulators:
1. A hand-off's text copies and its venue opens in the venue's app or browser.
2. Sharing a posted link from the venue's app to Stump records it as in STUMP-HANDOFF-002, with the same result as pasting it.
3. A push notice for a new hand-off opens it.
4. The queue reads offline and syncs on reconnect without duplicates.
5. A link shared while offline is recorded once on reconnect.
6. A reply to a Bluesky mention sent from the phone's inbox publishes in its thread.

**Evidence.** None.
**Gap.** Not built: no native iOS or Android app exists yet.

#### STUMP-MOBILE-002 — Compose, schedule and sign off on the phone

Core · target · **missing** · From STUMP-MOBILE-001 · Cites BASE-INPUT-003 · Register R-10

**Requirement.** In the iOS and Android apps a person writes a post, or a master item with its network variants, attaches photos and video from the camera or the camera roll with alt text, sees each network's preview, and schedules it, adds it to the queue, or saves it as a draft or an idea. They view and reorder their queue, and sign off items on the paths they belong to. Every check that runs on the web runs before a phone item can be marked ready.

**Acceptance.** Through the iOS and Android apps on simulators, against the network fakes:
1. A post with a camera-roll photo and its alt text schedules for 9:00 and publishes at that time.
2. A photo without alt text cannot be marked ready on the phone.
3. A video from the camera attaches and passes the network's media checks, and one that runs too long is refused with the limit named.
4. "Add to queue" places the item in the account's next open slot, and the queue view shows it.
5. Reordering the queue on the phone changes the order on the web.
6. A sign-off request opens on the phone, and signing off revision 2 there lets it be scheduled.
7. A variant over its network's limit shows its flag on the phone before scheduling.

**Evidence.** None.
**Gap.** Not built: no native iOS or Android app exists yet.

### The stack loop

#### STUMP-LOOP-001 — From a release to posts in one pass

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007 · Rules D-2, D-3

**Requirement.** When Penny publishes a release, or a GitHub release or changelog entry arrives (STUMP-STACK-008), the agent reads it and picks the accounts and venues it fits by product, fit, shared limits, rotation and rules. It drafts each item in the right person's voice with its claims checked and its disclosure in place, schedules the company's own accounts into open slots, and prepares hand-offs for the venues that keep posting for members: one plan per release that a person can read on one screen. Each publication carries external, and money on X; the company's policy decides each call. Nothing goes to a venue past its shared limit.

**Acceptance.** Through MCP, the app and a Penny fixture:
1. Under the held company policy, one release produces one plan with three own-account posts, a subreddit hand-off and an HN brief, each citing the release and its claims.
2. A venue whose shared limit is used this week is left out of the plan with the reason.
3. The approver approves two posts and declines one; the two publish once, and the declined one is recorded.
4. Under the all-autonomous company policy, the same release publishes its posts with no wait, and the hand-offs reach their named members.
5. A Penny correction before publishing flags the plan's items.
6. A GitHub release fixture with the same notes produces the same plan as the Penny release.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

#### STUMP-LOOP-002 — From an engager to an Orbit contact

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-007 · Rules D-7

**Requirement.** The agent reads the inbox and findings for people who engaged with substance, and joins a person's interactions across networks only where that person links their own accounts publicly; it never guesses an identity from a display name. It sends Orbit, or the CRM the company keeps (STUMP-STACK-007, STUMP-STACK-010), one contact proposal per person with their signals and public links, and the CRM's identity rules decide any merge. Stump records which posts produced which Orbit contacts, so results can count them.

**Acceptance.** Through MCP and an Orbit fixture:
1. Three replies from one Bluesky account become one Orbit contact proposal with three signals.
2. A Mastodon account linked from that Bluesky profile joins the same proposal; an account sharing only the display name does not.
3. No email address is sent unless the person shows it publicly on their profile.
4. The post that started each contact lists the Orbit contacts it produced.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

#### STUMP-LOOP-003 — From a signup to the weekly brief

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-007 · Register R-8

**Requirement.** Each week the agent writes the earned-channels brief: the posts, hand-offs and pitches made; the signups and revenue Vane attributes to each; the Orbit contacts and deals that came from engagers; the venues that worked and those that did nothing; and three to five next steps, each with figures and a linked draft or plan change. The brief goes to Vane's weekly growth brief (Vane `AGENT-006`) as its earned-channels section and to the team by email or Slack. A dismissed kind of suggestion stops.

**Acceptance.** Through MCP, the app and Vane and Orbit fixtures:
1. On a fixture week, the brief's figures equal the ledger, Vane and Orbit fixtures.
2. Each next step links its draft or plan change.
3. The section appears in Vane's brief fixture.
4. A dismissed kind of suggestion does not return the next week.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

#### STUMP-LOOP-004 — One policy, Pause and audit across seeds

Core · push-further · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-011, BASE-AUDIT-001

**Requirement.** Stump takes the company's policy from Business and adopts each signed revision within 60 seconds, and Pause all agents in Business stops Stump's agents with the rest. One chain (a Penny release, Stump's draft and post, Vane's signup and Orbit's contact) can be followed by one trace id in each seed's audit, and Business's overview shows Stump's agent acts by class beside every other seed's.

**Acceptance.** Through MCP, Business and the sibling fixtures:
1. A new policy revision in Business applies to Stump's next call within 60 seconds, and the audit cites it.
2. Pause all agents in Business refuses Stump's next agent call within 60 seconds.
3. One fixture chain carries the same trace id in the Penny, Stump, Vane and Orbit audit rows.
4. Business's counts of Stump's calls by class equal Stump's own Agents page.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

### Agents on the earned-channels job

#### STUMP-LOOP-005 — Venue scout

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007 · Rules D-3, D-7

**Requirement.** The agent proposes new venues from where the company's topics come up (findings, competitor mentions, coverage), each with its audience, why it fits, its rules read from the venue's own pages with their URLs and dates, its gates, and the route those rules allow. Proposals enter the register as candidates. An excluded venue is never proposed again.

**Acceptance.** Through MCP and the app:
1. From fixture findings, the scout proposes three candidates, each with sourced rules and a route.
2. A candidate whose rule page could not be read reads as unsourced.
3. An excluded venue is not proposed again.
4. Accepting a candidate makes it a venue with its rules.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

#### STUMP-LOOP-006 — Daily reply shortlist

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007 · Rules D-3, D-4

**Requirement.** Each morning in the person's time zone, the agent picks the few threads most worth answering, each with the venue's rules, why it fits, the facts to use, the route the venue allows (a reply from a connected account, a hand-off to a member, a brief only, or skip) and who should answer. An X thread from an account that has not engaged with the company's accounts goes to a hand-off, so the person replies in the X app. After the day it reports what was answered and how it went.

**Acceptance.** Through MCP, the app and email:
1. The shortlist arrives at the person's chosen local time with at most the number of threads they set.
2. Each thread's route matches its venue's rules, HN threads are brief only, and an X thread from an account that has not engaged is a hand-off with no API reply offered.
3. Skipped threads keep their reasons, and the next day's list reflects them.
4. Answered threads link their ledger entries and results.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

#### STUMP-LOOP-007 — Voice fidelity

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007 · Rules D-1

**Requirement.** Stump measures each draft written in a person's voice against that person's own posted writing and shows a reading on a scale of 0 to 100, where 100 reads as the person's own writing and below 60 marks drift, with the phrases that drift from it. The reading informs and never stops an item. The person's own edits to drafts turn into proposed changes to their voice guide, which they accept or decline.

**Acceptance.** Through the app and MCP:
1. A draft shows its reading and the phrases that drift.
2. The person's edits produce proposed guide changes, and accepting one updates the guide.
3. A low reading never stops an item from moving on.
4. On the labelled voice fixture, a person's own held-out posts read on average at least 20 points above other writers' posts on the same topics, and the measured gap is published in `docs/measures.md`.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

#### STUMP-LOOP-008 — Learning from results

Core · push-further · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** The agent compares results by format, time, venue, person and topic, and proposes changes: slots, venues to drop or try, and formats that work, each with its evidence and sample size. A proposal changes nothing until it is accepted, and an accepted slot change carries live.

**Acceptance.** Through MCP and the app:
1. On a fixture quarter, each proposal cites its evidence and sample size.
2. A proposal resting on too small a sample says so.
3. Accepting a slot proposal changes the slots and records the evidence.
4. A dismissed kind of proposal does not return.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the loop also needs the sibling seeds' events.

## Agent surface

### Agent surface (Base-delivered)

#### BASE-AGENT-001 — One MCP door per seed

Agent surface · target · **partial**

**Requirement.** Every seed, hosted or self-hosted, serves one remote MCP endpoint at `/mcp` over Streamable HTTP. It speaks the current revision (2026-07-28) and accepts 2025-11-25 clients through the twelve-month deprecation window. It implements `server / discover`, tools, resources and prompts. Lists are deterministic and carry `ttlMs` and `cacheScope: "private"`. Roots, Sampling and Logging are not served.

**Acceptance.**
1. `server / discover` returns the supported versions, capabilities, `serverInfo` and instructions.
2. A 2026-07-28 request works with no handshake, and a 2025-11-25 client completes `initialize` and lists the same tools.
3. An unsupported version returns `UnsupportedProtocolVersion`.
4. Two `tools / list` calls return the same order, with cache fields.
5. A foreign Origin returns 403, and a header and body method mismatch returns `HeaderMismatch`.
6. An oversized body returns 413 with no effect.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-002 — The seed's jobs are tools, through the UI's own actions

Agent surface · target · **partial**

**Requirement.** Each Core job a person does in the product is a tool. Where one is not, the Agent surface says why: it runs on a device, it is a person's interactive screen, it belongs to a connector or the import door, or it is an installation fact. Risk is never the reason: a risky job is a tool with its class (BASE-AGENT-006). Tools are named `<seed>.<area>.<verb>` and declare input and output schemas and truthful annotations. Each calls the same server action as the UI, so validation and authorization are written once, and the seed's embedded agents use the same registry. A business refusal returns `isError` with the seed's stable error code.

**Acceptance.**
1. The Core clause ids in each tool's `_meta`, with the not-a-tool reasons that `server / discover` serves, cover every Core clause in the contract, and no reason is risk; the harness and `rer check` fail on a gap.
2. Each tool's fixture result validates against its `outputSchema`.
3. Read tools declare `readOnlyHint`; tools that can carry destructive declare `destructiveHint`, and tools that can carry external declare `openWorldHint`.
4. A refusal returns the same error code the UI gets for the same action.
5. The UI action and its tool, on the same fixture, give the same record state and the same audit event type.
6. The seed's embedded agents appear in the audit as calls to the same tools.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-003 — Records are resources

Agent surface · target · **missing**

**Requirement.** Each primary record type has a URI template, and tools return `resource_link`s to the records they touch. A read returns exactly the fields the caller's role sees in the UI. File bytes count against any byte budget on the grant. A record the caller cannot open reads as not found, identical to a missing id. Text from customers, imports or files carries an untrusted marker in `_meta`.

**Acceptance.**
1. `resources / templates / list` names every record type in the Agent surface.
2. Reads as two roles return exactly what the UI shows each.
3. An out-of-scope id and a missing id give identical responses.
4. A write's `resource_link` reads back the new state.
5. Bytes over budget return `budget_exhausted` and no partial content.
6. Customer-sourced text carries the untrusted marker.

**Evidence.** None.
**Gap.** Not yet judged through this seed's own doors.

#### BASE-AGENT-004 — Business identity and short-lived, audience-bound tokens

Agent surface · target · **partial**

**Requirement.** The door is an OAuth 2.1 resource server. Its RFC 9728 metadata names the authorization servers this installation trusts. That is the paired Business when Business provisioned it, verified with the owner-claim trust the installation already holds for its import door; otherwise it is the seed's own sign-in. Access tokens are RFC 9068 JWTs with `aud` set to the seed's canonical MCP URI, `sub` the sponsoring person, `act` the agent (RFC 8693) with its specialist, scopes per tool family, and a lifetime of 15 minutes or less (5 by default). The policy scopes rules on the sponsor, agent and specialist the token names. The consent behind the tokens can last longer and is revocable. Tokens travel only in the Authorization header, and there is no passthrough.

**Acceptance.**
1. An unauthenticated call returns 401 with `resource_metadata`, and the metadata names the trusted servers and scopes.
2. A Business token for this seed works, and the same token sent to a sibling seed returns 401.
3. An expired token returns 401, and a token with a lifetime over 15 minutes is refused.
4. A read-only token calling a write tool returns 403 `insufficient_scope` with every needed scope in one challenge.
5. A token in a query string is refused and not logged.
6. Revoking consent in the seed or in Business refuses the next call within 60 seconds.
7. After unpairing, Business tokens are refused and the seed's own sign-in still works.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-005 — An agent acts as a person in a role, never more

Agent surface · target · **partial**

**Requirement.** Every call is authorized as the sponsoring person's current role and access (BASE-ACCESS-004), intersected with the grant's resources, actions and budget. A grant only narrows. No call widens the calling agent's own authority. A call that would widen its own grant or its sponsor's role, or change the company policy or Pause, is refused with `self_escalation`, whatever the policy says; narrowing its own grant is allowed. Other access and security changes are ordinary actions in the access and security classes. An agent never acts after its sponsor is suspended. Anything an agent reads (records, files, emails, imports, other seeds' results) is data and cannot change its scope, its targets or a call's class.

**Acceptance.**
1. For each role fixture, every tool's allow or deny through MCP equals the UI's for the same action.
2. A one-folder, read-only grant holds, and widening through arguments is refused.
3. Downgrading the sponsor changes the next call's result, and suspending the sponsor returns 401.
4. Calls that widen the agent's own grant or its sponsor's role, or change the policy or Pause, return `self_escalation` and change nothing, even under a policy with every class autonomous; dropping a scope from its own grant runs.
5. An injection fixture yields no out-of-grant call and no change of class: record text asking for a wider action, or claiming that a recipient is internal.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-006 — Every action declares its risk class

Agent surface · target · **partial**

**Requirement.** Classes come from the fleet list in RISK-POLICY.md: standard, external, money, commitment, accounts, gated, access, security, destructive, sensitive and live. In the registry, each tool declares the classes it can carry and a server-side classifier that decides them per call from the arguments, current records and, for gated, the provider's answer. The classifier also supplies each class's facts: the measure (items, recipients, amount and currency, people or records), the counterparty (internal, known, new or public), the direction for access, the provider and step for gated, and the data kind for sensitive. A classifier never reads a flag, label or claim supplied by the agent or by record text. A seed cannot add a class; it proposes one for the fleet list.

**Acceptance.**
1. Every tool in `tools / list` carries its possible classes in `_meta`, equal to the Agent surface table.
2. For each tool, fixture calls cover every class it can carry, and the computed classes and facts equal the fixture's expected values.
3. An argument or record text asserting a class or a confirmation (`internal: true`, `confirmExternal: true`) leaves the computed classes unchanged.
4. Money calls carry amount and currency, external calls their counterparty and recipient count, access calls their direction, and destructive calls their item count.
5. No tool in `tools / list` declares a class outside the fleet list, and `rer check` fails on one.
6. A refused call's audit row still records its computed classes.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-007 — The company's policy decides, at one chokepoint

Agent surface · target · **partial**

**Requirement.** Every agent door calls one decision function: MCP, the integration API with agent tokens, and the seed's embedded agents. It evaluates the call's classes against the company's policy, as above. The seed ships no dispositions and fills no gap with one: agent access opens only under a complete policy that setup has asked for (RISK-POLICY.md), and before then every agent call returns `policy_unset` with the setup link and changes nothing. *Autonomous* runs the call. *Review* runs it and adds it to the review feed. *Approval* saves a pending action with server-computed facts and returns `input_required`, with a URL-mode elicitation to the seed's approval page and a pending handle. Each person the rule names approves the exact saved revision in a signed-in browser, and changed inputs need a new approval. The retried call returns the result and a receipt. A rejection returns `approval_rejected`, and a lapse past the wait the rule sets returns `approval_expired`. *Blocked* returns `policy_blocked`, naming the class, rule and revision.

**Acceptance.**
1. The Base harness runs each tool under each disposition for every class it can carry, and sees it run, run and enter the review feed, wait with no effect, or be refused.
2. Before setup is complete, the setup page lists every class the seed's tools carry with examples and no answer pre-selected, an agent call returns `policy_unset` with the setup link and changes nothing, and an incomplete revision cannot be confirmed; a `*` rule completes it, and a tool an upgrade adds with an unanswered class appears in `tools / list` once that class is answered, while the other tools keep running.
3. Under "money autonomous up to $500, approval up to $10,000, blocked above", calls of $400, $600 and $20,000 run, wait and are refused; a per-day cap sends the call that crosses it to the next rule.
4. A call carrying two classes takes the stricter disposition.
5. An approval shows server-computed facts and an expiry, returns the URL elicitation and a handle, and completes once after the named approver approves; a changed input needs a new approval, and a rejection or lapse leaves no effect.
6. The same call through MCP, the integration API and an embedded agent gets the same decision.
7. A policy change applies to the next call within 60 seconds, and the audit cites the new revision.
8. A policy document with a bad signature or another Business's id is rejected, and the door keeps the last valid revision.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools and the drafting tools (brand, drafts, press), including an approval bound to the item's revision; the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-008 — Truthful attribution

Agent surface · target · **partial**

**Requirement.** Every agent act is recorded and shown as `"<agent> for <person>"`, and mail and messages an agent sends outside name it that way as their sender. An approval, a review mark, a confirmation (a warning dialog, a typed-field confirmation, a delivery confirmation), a decision or a signature attributed to a person comes only from that person's signed-in session. When an agent does the equivalent act, the record names the agent, and the act carries its own class; a binding decision or a signature is commitment. Agent doors ignore arguments that stand for a person's confirmation. No tool solves a bot check, or enters a person's own password or 2FA code at an outside service. A provider step that demands a person goes to a person, whatever the policy says; the gated class marks such steps before they run.

**Acceptance.**
1. An agent call carrying a person-confirmation flag is classified and decided exactly as without it.
2. Approving, marking reviewed or answering a policy question with an agent or device token returns 403 and changes nothing.
3. A form-mode elicitation "accept" never completes an approval.
4. Where an agent's decision, signature or field confirmation runs without a person, it reads `"<agent> for <person>"` in the record, the activity view, exports and any certificate, never as the person's own act.
5. After a person approves an agent's prepared action, the record shows the person as approver and the agent as preparer.
6. Activity and exports at 1440 and 390 show `"<agent> for <person>"` for every agent act.
7. Mail an agent sends to an outside address names `"<agent> for <person>"` as its sender.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-009 — Every agent action is audited with its class and decision

Agent surface · target · **partial**

**Requirement.** Extending BASE-OPS-005, each call that reads private data or changes anything records the agent client, name and specialist, and the run or task id (`traceparent` when sent); the sponsoring person, the grant, the tool and the targets; the classes and their facts, and the policy revision and rule; the decision (autonomous, review, approval, blocked, unset or self_escalation) and the outcome (done, refused, pending or failed); the approval or review id and person, and the idempotency key. For a period, the seed's Agents page shows actions by class and decision with the notable ones, the review feed (Mark reviewed, Flag, and Undo where reversible), pending approvals, steps waiting for a person and setup questions. Business shows the same across seeds.

**Acceptance.**
1. One write leaves a complete audit row.
2. Refused, pending, unset and self-escalation calls are audited.
3. The Agents page's counts by class and decision equal the audit rows on a fixture week.
4. The review feed lists exactly the calls decided as review; Mark reviewed records the person, and Undo restores a reversible one.
5. Filtering by agent or class lists only those rows, and export includes every field.
6. Removing the agent keeps its rows and its name.
7. The Agents page works at 1440 and 390 with no serious or critical axe findings.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-010 — Agents can follow changes

Agent surface · target · **missing**

**Requirement.** The seed emits a typed event for every record change and for every approval, review and policy decision. Each event carries a stable id, a type, the record URI, the actor (a person, or an agent acting for a person) and a time. Events never carry secrets or more than the subscriber may read. Agents can read events three ways: `subscriptions / listen`, an `events.list` tool with a cursor, and signed webhooks from Base `integrations` using the same ids. Every channel delivers at least once and filters by access at delivery.

**Acceptance.**
1. A subscribed record changed in the UI produces a notification within 10 seconds.
2. `events.list` returns the same event id the webhook carries.
3. Replaying from a cursor returns the same ids in order.
4. After access is revoked, no channel delivers events about that record.
5. A failed webhook is visible and replays without duplicate effects.
6. `approval.pending`, `approval.decided`, `review.flagged` and `policy.adopted` carry the class and decision and nothing the subscriber may not read.

**Evidence.** None.
**Gap.** Not yet judged through this seed's own doors.

#### BASE-AGENT-011 — Limits are policy, and Pause stops everything

Agent surface · target · **partial**

**Requirement.** Business limits are rules in the company's policy: per-call and per-day thresholds on any class's measure, such as money moved, outside recipients or items destroyed; spend caps on provider cost (models, SMS, email) per seed, specialist or agent, which setup asks with the classes; "no cap" is an answer. Tools with provider cost declare an estimate before they run, and an exhausted cap returns `budget_exhausted` before any partial effect. The seed's capacity limits (request rate, body and byte sizes) protect the installation: they bound rate and size, never daily business volume, are documented and are not policy. A grant carries budgets only when the person granting it sets them. A **Pause agents** control in the seed, and Pause all agents in Business when paired, refuses every agent token within 60 seconds until a person resumes; browser sessions and devices keep working.

**Acceptance.**
1. A rate overrun returns 429 with `Retry-After`.
2. A per-day cap of three outside recipients sends the fourth to the rule that applies past the cap.
3. An exhausted spend cap returns `budget_exhausted` with no partial effect and shows the spend.
4. Under the answer "no cap", a spending call runs and its spend shows in usage; a call that spends nothing is unaffected by any cap.
5. The usage view shows calls, decisions by class, money moved and provider spend per agent.
6. Pause and Pause all agents each stop the next call within 60 seconds, and resume restores access.
7. An agent token cannot resume.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-012 — Writes are idempotent and conflict-safe

Agent surface · target · **partial**

**Requirement.** Every mutating tool requires an idempotency key and takes an optional expected revision. The same key with the same arguments returns the first outcome for at least 24 hours; the same key with different arguments returns `idempotency_conflict`; a stale revision returns `revision_conflict` with the current revision. Long work returns a job handle and a status tool, with no dependence on the Tasks extension.

**Acceptance.**
1. Two calls with one key give one effect and equal results.
2. A retry with a new JSON-RPC id and the same key, after a dropped stream, returns the recorded outcome.
3. The same key with different arguments returns a conflict and no effect.
4. A stale revision returns a conflict naming the current revision.
5. A job handle used by another person's token reads as not found.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

#### BASE-AGENT-013 — Manifest, docs and the conformance journey

Agent surface · target · **partial**

**Requirement.** `server / discover` instructions and an on-site `/docs/agents` page are generated from the action registry. The page lists tools by job, with each tool's classes, the test that adds each computed class, its scopes, resource templates, event types, capacity limits and error codes, and the specialist role. `prompts / list` carries the specialist's jobs. Base ships the conformance journey, a harness that `rer verify` runs against `rer dev` and seeds run in CI. It is an MCP client; a signed-in test person takes a person's steps (setup answers, approvals, review marks, resume) through the URLs the door returns, and the same browser leg runs the UI-parity actions and the page checks at 1440 and 390. It runs every acceptance point of BASE-AGENT-001 to 012 and of the seed's SURFACE clauses under two company policies: *all autonomous* (`*`), and *held* (standard review, every other class the seed declares approval, which the test person grants), plus the single-class variants a point names. A point that names no disposition passes under both.

**Acceptance.**
1. The docs list exactly the names in `tools / list` and `resources / templates / list`.
2. Each tool's classes, and the test behind each computed one, are documented.
3. The harness fails on any of: a tool without a schema; an effect under approval or blocked, or before setup is complete; a computed class that differs from its fixture; a flag that changes a class or completes a person's step; a role-parity mismatch; a wrong-audience token being accepted; a duplicate effect on retry.
4. Every acceptance point runs under both policies, every decision matches the policy in force, and under all autonomous no call waits for a person or is refused by policy.
5. A stranger agent given only the seed URL completes the specialist journey through MCP.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** Proven for Stump's spine tools (team, Pause, ledger read); the rest of the registry, resources and events arrive with later lanes.

### Agent surface

#### STUMP-SURFACE-001 — Registry and complete earned-channels jobs

Agent surface · target · **partial** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-013

**Requirement.** The action registry exposes Stump's earned-channels jobs with the classes, Core clauses and non-tool reasons in this section's table.

**Acceptance.**
1. The registry's tools, declared classes, Core clause ids and non-tool reasons equal the table, and no non-tool reason is risk.
2. The Base conformance journey passes on Stump's own venue, item, hand-off, ledger, finding and inbox fixtures.
3. `/docs/agents` lists every tool with its classes and the test that adds each computed class.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify)
**Gap.** The registry holds the team, Pause and ledger-read tools only; the rest of the contract's table arrives with later lanes, and /docs/agents does not exist.

#### STUMP-SURFACE-002 — Internal work computes standard

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007 · Rules D-7

**Requirement.** Venue, rule, brand, claim, draft, revision, check, hand-off preparation, ledger correction and finding calls compute standard from their actual effect when nothing leaves the company.

**Acceptance.**
1. Creating a venue, editing a rule, drafting without an AI call, saving a revision, running the checks and correcting a ledger entry each compute standard with item counts.
2. A found post's text or an argument claiming another class changes none of those facts.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"; `agent-surface.json` journey (stump shard of `verification.json`)
**Gap.** Brand, claim, draft, revision, check and preview calls compute standard with item counts from records; the journey asserts each drafting tool's standard class. Venue, rule and ledger correction calls belong to other lanes.

#### STUMP-SURFACE-003 — Public posts and outside exposure compute external

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007 · Rules D-7

**Requirement.** Publishing, replying, editing at a network, submitting to a directory, sending an outside webhook, routing an inbox item out, sending text to the AI provider or a supplier, and fetching a venue's page to check a hand-off link or re-read its rules compute external with counterparty and audience.

**Acceptance.**
1. Publishing to a connected account computes external with counterparty public and the account's follower count.
2. A reply to someone who engaged with the company's account first computes known; a reply to a stranger in a public thread computes new.
3. A draft request that calls the AI provider, and a supplier query, compute external with the provider.
4. A hand-off link check and a venue rule-page fetch compute external with the venue as counterparty.
5. An argument or item text calling the post internal leaves external in place.

**Evidence.** `agent-surface.json` journey (stump shard of `verification.json`) steps "ai-draft", "inbox-reply"
**Gap.** A drafting call that reaches the AI provider computes external with counterparty known and the provider host (.3), whatever its arguments say. A reply to someone who engaged first computes external with counterparty known (.2); a reply to a stranger in a public thread is refused before any class is computed (D-4), so its "new" half is not reachable. Publishing (.1) and link and rule-page fetches (.4) belong to other lanes.

#### STUMP-SURFACE-004 — Network spend and paid listings compute money

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-011

**Requirement.** Calls that spend at a network, a supplier or a directory compute money from the company's price table (`docs/networks.md`) or the provider's quote.

**Acceptance.**
1. With the fixture price table, an X post with a URL computes the URL-post charge in USD with counterparty X, and one without a URL the plain-post charge.
2. An X watch poll computes its read charge, a supplier or web-search query its per-query charge, and an AI-assistant prompt run its provider's charge.
3. A paid directory listing computes its price.
4. After the company updates the price table, the next call carries the new price.
5. Under a company spend cap, the call that would cross it returns `budget_exhausted` before any effect.

**Evidence.** `tests/stump/accounts.test.mjs` "an agent posts to the company X account within the owner's dollar limit: Pause holds it, it goes out once, reads back from X and lands on the ledger with its charge"; `agent-surface.json` journey (stump shard of `verification.json`) steps x-queue and x-schedule
**Gap.** Point 1 holds for an X URL post: money computes `{measure: 0.2, currency: "usd", counterparty: "x"}` from the company's price table, once per call, and the ledger records $0.20 (`src/stump/publish/schedule.ts`). Stump's agent door copy is adapted so a money measure and limit is currency units to the millionth, currency codes match ignoring case and the provider paid can be the counterparty (`base-copies.json`; `src/modules/agent-door/policy/PROVENANCE.md`). Point 4 (an updated price on the next call) is built, not yet asserted in a repo test; .2, .3 and .5 belong to later lanes.

#### STUMP-SURFACE-005 — Steps venues and providers keep for a person compute gated

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008 · Rules D-3

**Requirement.** Each step a venue or a provider keeps for a person computes gated with the venue or provider and the step, and is planned for the person it belongs to.

**Acceptance.**
1. An item for a venue whose rules keep posting for members computes gated with the venue and the step "a member posts", and appears among hand-offs for the named member.
2. Connecting an X, LinkedIn or Threads account computes gated with the consent step and returns the consent URL for the account's own person.
3. Product Hunt scheduling and a Show HN compute gated with the maker step.
4. An AI-drafted X reply computes gated with X's prior-approval step until the company records X's approval; after that it carries only its other classes.
5. A network answer that newly asks for a person, such as an expired consent, adds gated to the call and names the step.
6. An Instagram Story reminder, a G2 review reply, and the hand-off for an X reply to an account that has not engaged each compute gated with the person's step and appear among that person's hand-offs.
7. Publishing to Instagram, Facebook, TikTok, YouTube, Pinterest or Google Business Profile before the company's app passes that provider's review computes gated with the review step.

**Evidence.** `agent-surface.json` journey (stump shard of `verification.json`) step "inbox-ai-reply"
**Gap.** An AI-drafted X reply computes gated with provider x and the step x_ai_reply_approval (.4); recording X's approval (STUMP-CONNECT-002.3) is not built, so the after-approval half of .4 is open. Points .1-.3 and .5-.7 belong to other tools.

#### STUMP-SURFACE-006 — Commitments and outside accounts

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** Agreements that bind the company compute commitment, and creating something at an outside service computes accounts.

**Acceptance.**
1. Agreeing an embargo with a journalist computes commitment with its date and outlet.
2. Accepting a paid listing's terms computes commitment and money with value and counterparty.
3. Registering Stump's app on a new Mastodon instance computes accounts with the instance; publishing on an instance where the app exists adds no accounts.

**Evidence.** None.
**Gap.** Not built: Stump has not adopted the Base agent door, and no Stump tool exists yet.

#### STUMP-SURFACE-007 — Access and security

Agent surface · target · **partial** · From new · Cites BASE-AGENT-005, BASE-AGENT-006, BASE-AGENT-007

**Requirement.** Team, role, delegation, per-account grant, sign-off path and API-key changes compute access, and credential and connection handling computes security.

**Acceptance.**
1. Inviting a person, changing a role, removing a person and changing account delegation compute access with the people and whether it widens or narrows.
2. Connecting or disconnecting an account and entering network, AI provider, supplier or webhook keys compute security with the setting and provider.
3. Narrowing a person's grants to one company account computes access that narrows, and turning sign-off off for an account computes access that widens.
4. A call that would widen the calling agent's own grant, its sponsor's role or its sponsor's delegation returns `self_escalation` and changes nothing, under every company policy.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify); `tests/stump/team.test.mjs` "the owner cannot be removed or demoted until ownership is transferred, and the transfer is recorded", "an agent credential acts for its person with exactly their role, follows role changes and ends when revoked"
**Gap.** Inviting computes access that widens, and self-widening returns self_escalation through both doors, before the role check; delegation, grants, sign-off paths and security settings are not built.

#### STUMP-SURFACE-008 — Destructive and live

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007

**Requirement.** Calls that cannot be undone in Stump compute destructive, and calls that change how the running queue or links behave compute live.

**Acceptance.**
1. Deleting a published post computes destructive and external with the item count.
2. Erasing a person and clearing source copies compute destructive with counts.
3. Changing queue slots that queued items follow, pacing, Pause and resume, and a short link's destination compute live with the account or service.
4. Editing a draft, or a slot no queued item uses, stays standard.

**Evidence.** None.
**Gap.** Not built: Stump has not adopted the Base agent door, and no Stump tool exists yet.

#### STUMP-SURFACE-015 — Personal data computes sensitive

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007 · Rules D-7

**Requirement.** Calls that read, send or export personal data about people outside the team, or build on one person's own writing, compute sensitive with the data kind and the number of people.

**Acceptance.**
1. Sending an engager to Orbit, HubSpot, Attio, Pipedrive or a webhook computes sensitive with the data kind "public handles and post links" and one person.
2. Reading a member's profile and timeline, and keeping a journalist's contact route, compute sensitive with their data kinds.
3. Building a voice guide from a person's posts computes sensitive with the data kind "writing samples".
4. The full export computes sensitive with the data kind "whole archive" and its people count, and erasing a person computes sensitive and destructive.
5. A venue edit or a draft with no personal data carries no sensitive, and an argument claiming no personal data leaves a computed sensitive in place.

**Evidence.** `tests/stump/ledger-stack.test.mjs` "link tags go on the company's own links only, and engagers and annotations reach Orbit and Vane signed, sealed and recorded"; `agent-surface.json` step "stack-offers"
**Gap.** Sending an engager to Orbit and reading the offers list compute sensitive with the data kind "public handles and post links" and the number of people (point 1). Points 2 to 5 belong to other tools.

#### STUMP-SURFACE-009 — Saved items under company policy

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-008, BASE-AGENT-012 · Rules D-5

**Requirement.** When a company's policy holds an agent's publication, Stump saves the exact revision, account, venue, time, media and disclosure, and publishes only that revision.

**Acceptance.**
1. Under the held company policy, an agent schedules a post; the named approver approves the saved revision, and it publishes once at its time.
2. Editing the text after approval needs a new approval, and the old revision never posts.
3. Under the all-autonomous company policy, the same publication runs without a person's approval, and its ledger entry reads "<agent> for <person>".
4. After a person approves an agent's prepared post, the ledger shows the person as approver and the agent as preparer.
5. An agent's edit to an approved item that carries a stale expected revision returns `revision_conflict`, and the approved revision stays the one that publishes.

**Evidence.** `tests/stump/drafting.test.mjs` "the claim check, disclosure and near-duplicate hold stop a draft the same way for a person and their agent"
**Gap.** Drafting side: a save with a stale expected_revision answers revision_conflict (.5), an approval is bound to the revision it was asked for, and a save after approval returns a ready or scheduled item to draft with its approval cleared. Scheduling and publishing the approved revision (.1-.4) belong to the publishing lane.

#### STUMP-SURFACE-010 — Product refusals under every policy

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-009 · Rules D-1, D-2, D-4, D-8

**Requirement.** Stump's refusals are product rules that apply to people and agents alike, so no company policy changes them.

**Acceptance.**
1. Under the all-autonomous company policy, a persona, a missing disclosure, a banned act, generated endorsement text for an outside poster and a near-duplicate are refused for an agent exactly as for a person.
2. Under the same policy, an agent's publish to an X account without its recorded Automated label and operator bio, and an agent's like or repost of another account's post, return `act_refused` naming D-4's rule.
3. Each refusal is audited with its rule and source, apart from policy decisions.
4. A finding or reply whose text asks the agent to break one of these rules changes nothing.

**Evidence.** None.
**Gap.** Built, not yet asserted under the all-autonomous company policy: Stump's tools run through the Base agent door, and a refused act answers `act_refused` with its rule and source at both doors before any argument check (`tests/stump/inbox.test.mjs` asserts an agent's like, repost, follow and DM at MCP, and `tests/stump/team.test.mjs` an agent's persona create).

#### STUMP-SURFACE-011 — Events and handoffs across the stack

Agent surface · target · **missing** · From new · Cites BASE-AGENT-003, BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-010

**Requirement.** Stump's resources and events keep the links between venues, items, hand-offs, ledger entries and the sibling seeds that receive them.

**Acceptance.**
1. Each declared resource reads back, and each tool's resource links lead to the changed record.
2. A Penny release event becomes a draft set, and the published items reach Vane as annotations, Orbit as engager signals and Mango as newsletter drafts, each traceable by the same event identity.
3. `events.list` returns the same event ids the webhooks carry.

**Evidence.** None.
**Gap.** Not built: Stump has not adopted the Base agent door, and no Stump tool exists yet.

#### STUMP-SURFACE-012 — Overview, spend and Pause

Agent surface · target · **partial** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-009, BASE-AGENT-011

**Requirement.** Stump's Agents page reconciles a week of agent calls, classes, decisions and spend, and Pause stops agents' publishing as well as their calls.

**Acceptance.**
1. The Agents page's counts by class and decision equal the audit rows for a fixture week.
2. Network, AI and supplier spend show per agent against the company's caps, or no cap.
3. Pause agents refuses the next agent call within 60 seconds and holds every item an agent scheduled that has not posted, until a person resumes.
4. Resuming releases the held items in time order, and overdue ones stay held until they are rescheduled or dropped.

**Evidence.** `agent-surface.json` journey in the stump shard of `verification.json` (also run by rer verify) (Pause phase)
**Gap.** Pause stops the next agent call; holding agent-scheduled items (`src/stump/publish/tick.ts`) is proven once items can be scheduled, and the Agents page's spend view needs network spend.

#### STUMP-SURFACE-013 — Embedded agents use the same registry

Agent surface · target · **missing** · From new · Cites BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-007 · Rules D-7

**Requirement.** Stump's embedded jobs (STUMP-LOOP-001 to STUMP-LOOP-008) call the same tools and the same policy decision as an outside agent.

**Acceptance.**
1. Each embedded job and an outside agent, run on the same records, reach the same outcomes and decisions.
2. Under the held and the all-autonomous company policies, text from findings, replies and imports cannot change a class, a scope or a route.

**Evidence.** None.
**Gap.** Not built: Stump has not adopted the Base agent door, and no Stump tool exists yet.

#### STUMP-SURFACE-014 — A stranger specialist's seeded week

Agent surface · target · **missing** · From new · Cites BASE-AGENT-006, BASE-AGENT-007, BASE-AGENT-013 · Register R-13

**Requirement.** Given only the installation URL, a stranger agent runs a seeded week of earned-channels work through MCP under two company policies.

**Acceptance.**
1. Under the all-autonomous company policy, the agent loads the venue list, turns a Penny release into posts, publishes to the company's Bluesky, Mastodon and X accounts, prepares a subreddit hand-off and a Show HN brief, answers a mention, sends an engager to Orbit, reads Vane's signups and writes the weekly brief, with no policy wait or refusal.
2. The two hand-offs wait for their named members in both runs, because the venues keep those steps for people.
3. Under the held company policy, standard calls enter review and each other class waits for the person the policy names, then runs once on that person's approval.
4. Records, ledger entries, events, attributions, spend and the Agents page agree across both runs, and every decision equals the policy in force.

**Evidence.** None.
**Gap.** Not built: Stump has not adopted the Base agent door, and no Stump tool exists yet.

## Later

### Writing tools

#### STUMP-DRAFT-009 — Other languages, locales and non-US disclosure rules

Later · target · **missing** · From new

**Requirement.** Stump drafts in languages other than US English, formats dates and numbers for other locales, and applies disclosure rules outside the US, such as the EU AI Act's Article 50 duties for AI-generated text published to inform the public.

**Acceptance.**
1. A draft in Spanish uses the person's Spanish voice notes and locale formats.
2. A venue in the EU applies its jurisdiction's disclosure rule before ready.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### More channels and formats

#### STUMP-PUBLISH-017 — A Reddit company app account

Later · target · **missing** · From new · Rules D-1, D-3

**Requirement.** Where Reddit approves the company's app for commercial use and the app's account carries Reddit's App label, Stump posts from that labelled company account in subreddits whose rules allow it. Posting as a person on Reddit stays a hand-off to that person.

**Acceptance.**
1. With a recorded approval and App label, a post publishes to a subreddit whose rules allow it.
2. Without them, every Reddit route is a hand-off.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Listening and alerts

#### STUMP-WATCH-021 — Competitor account benchmarks

Later · target · **missing** · From new

**Requirement.** The company names competitors' public accounts: Bluesky and Mastodon profiles, X accounts (read at X's metered price), and LinkedIn pages where LinkedIn's API serves the page's follower count. Stump reads each account's followers and its public posts' engagement on a schedule and compares them with the company's own accounts by week: follower growth, posts per week, engagement per post and top posts.

**Acceptance.** Against the network fakes, through the app and MCP:
1. Three competitors' Bluesky and Mastodon follower counts and post engagement show weekly beside the company's.
2. An X competitor's reads record their cost from the price table.
3. A LinkedIn page's follower count shows where the API serves it, and the page reads as not covered where it does not.
4. Each week's top posts by engagement link to the competitor's posts.
5. Removing a competitor stops its reads and keeps its history.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Press and podcasts

#### STUMP-PITCH-004 — Source-request services

Later · target · **missing** · From new · Rules D-2, D-7

**Requirement.** Stump reads the journalist source requests a company receives from services such as Qwoted, Featured and MentionMatch, from the alert emails it forwards to Stump, and matches each to the company's experts, products and claims, with the reasons. A matching request becomes an opportunity with its outlet, deadline and the expert it fits, and a draft answer in that expert's voice for them to send through the service. Its outcome (sent, declined, quoted, published) is recorded, and a published piece becomes coverage (STUMP-PITCH-003).

**Acceptance.** Through the inbound-mail door, the app and MCP, against request fixtures:
1. A request about CRM pricing matches the expert whose topics cover it, showing the reasons.
2. A request outside every expert's topics is filed as unmatched, with no opportunity.
3. The opportunity shows the deadline in the expert's time zone and reminds them a day before.
4. A request past its deadline expires with no answer sent.
5. The draft answer passes the claim check and carries the expert's disclosure where the service asks for one.
6. The expert records the answer as sent through the service, and the outcome updates when they record a quote or a published link.
7. A published piece becomes coverage linked to the request.
8. Text in a request that tells Stump to act changes nothing.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Team, setup and connections

#### STUMP-TEAM-004 — Client workspaces for agencies

Later · target · **missing** · From new

**Requirement.** An agency runs several clients' earned channels from one installation. Each client is a workspace with its own venues, accounts, brand profile, claims, ledger, reports and sign-off paths, and client people see only their own workspace. A client's approver signs off items in their workspace, in the app or through a preview link (STUMP-DRAFT-014). Reports run per client, and exports carry the agency's or the client's branding (logo, colours and name). Agency staff hold their own role in each workspace.

**Acceptance.** Through the app, the API and MCP:
1. A client person sees only their own workspace through every door.
2. An item for a client's account waits for that client's approver and can be scheduled once they sign off.
3. A client approver signs off through a preview link without an agency seat.
4. A monthly report runs per client and shows only that client's figures.
5. A PDF export carries the chosen branding and no other client's name.
6. Agency staff hold a different role in each workspace, and switching workspaces changes what they can do.
7. A venue or claim in one client's workspace is invisible from another's.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-TEAM-005 — Disclosed team advocacy

Later · target · **missing** · From new · Rules D-2

**Requirement.** Employees who choose to join share company news from their own accounts. Editors curate suggested posts with talking points, links and media; an employee shares one in their own voice from their own connected account, or by hand with the link recorded, each with their disclosure (D-2). The ledger counts each employee's shares and the reach and clicks their posts bring, with clicks through their own tagged links. Joining and leaving are the employee's choice, and no reward depends on what they write.

**Acceptance.** Through the app and MCP:
1. An editor publishes a suggested post with talking points and a link, and every opted-in employee sees it.
2. An employee shares it from their own LinkedIn account with their disclosure line, and the ledger records it.
3. A share without a disclosure cannot be marked ready.
4. Each share's link carries the employee's own UTM content tag, and clicks count per employee.
5. Reach and engagement show per employee where the network gives them, and as entered where it does not.
6. An employee who leaves the programme stops seeing suggestions, and their past shares stay on the record.
7. A suggestion cannot carry a reward tied to what the employee writes.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

### Paid reach and creators

#### STUMP-BOOST-001 — Boosting the company's posts

Later · target · **missing** · From new · Register R-27

**Requirement.** An admin connects the company's ad accounts at Meta, LinkedIn and X through their ads APIs. A person boosts one of the company's published posts with its ad account, budget in USD, dates, audience and goal, and the network applies its own paid label. Stump creates the boost at the network, shows its spend and results beside the post's organic results, and can pause or stop it. Every boost is recorded on the post's ledger entry with its spend.

**Acceptance.** Against official-schema fakes of the Meta, LinkedIn and X ads APIs, through the app and MCP:
1. Boosting a Facebook Page post creates the boost with its budget, dates and audience, and it reads back as active.
2. Sponsoring a LinkedIn page post and promoting an X post do the same at those networks.
3. Spend and results read back daily and show beside the post's organic results.
4. Pausing or stopping a boost reads back from the network and records who did it.
5. A boost the network rejects shows the network's reason and spends nothing.
6. A post from a person's own account cannot be boosted through the company's ad account.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

#### STUMP-CREATOR-001 — Creator partnerships

Later · target · **missing** · From new · Rules D-2, D-8

**Requirement.** The company works with creators who agree to post about its products. A creator is a venue with their public profiles and public audience figures, found from findings or added by hand. A partnership records the brief (talking points, facts and links, never generated text in the creator's voice), the deliverables, dates, fee in USD and the terms both sides agreed. The creator's own draft can be shared for review through a preview link, and their post must carry the network's paid-partnership label and a disclosure before it is recorded as delivered. Each delivered post's link, results and tagged clicks are recorded, and payments are logged against the partnership.

**Acceptance.** Through the app and MCP:
1. A partnership holds its brief, deliverables, dates, fee and agreed terms.
2. The brief carries talking points and facts, and asking for a generated post in the creator's voice returns talking points only.
3. A delivered post recorded without the paid-partnership label or a disclosure is held with the rule.
4. A delivered post's link is checked as for a hand-off, and its results and tagged clicks show on the partnership.
5. A payment logged against the partnership updates what is owed.
6. A creator's public audience figures show with their source and date.
7. The partnership's report sums reach, clicks and signups across its posts.

**Evidence.** None.
**Gap.** Not built: no Stump code exists yet, and the seed starts from the Base foundation.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | A production X developer app on pay-per-use posting from a real company account, with its Automated-label state and X's decision on AI-generated replies recorded, and the price table checked against X's pricing page at release. | STUMP-LEDGER-003, STUMP-WATCH-011, STUMP-PUBLISH-004, STUMP-CONNECT-002, STUMP-INBOX-002 | not run | | |
| R-2 | A production LinkedIn app with Share on LinkedIn posting to a real member profile, checked against LinkedIn's documentation current at release. | STUMP-PUBLISH-005, STUMP-PUBLISH-021, STUMP-CONNECT-002 | not run | | |
| R-3 | LinkedIn Community Management API vetting at the Development and Standard tiers, including member post analytics, and a real company page journey. | STUMP-LEDGER-003, STUMP-PUBLISH-008, STUMP-PUBLISH-021, STUMP-CONNECT-002, STUMP-INBOX-001 | not run | | |
| R-4 | Meta App Review (and Business Verification if Meta asks for it) for Threads publishing by people without a role on the app, and a real profile journey. | STUMP-LEDGER-003, STUMP-PUBLISH-007, STUMP-CONNECT-002 | not run | | |
| R-5 | A signed agreement with a licensed Reddit data supplier, Meltwater first, and a real Reddit watch journey under its terms. | STUMP-WATCH-007 | not run | | |
| R-6 | Live posts from real company accounts on a production Bluesky PDS and a public Mastodon instance, read back and deleted. | STUMP-PUBLISH-002, STUMP-PUBLISH-003 | not run | | |
| R-7 | A real Product Hunt launch and a real Show HN, each run by its maker within the venue's rules, with outcomes recorded. | STUMP-LAUNCH-002, STUMP-LAUNCH-003 | not run | | |
| R-8 | Three months of earned-channels work at a first buyer: venues, hand-offs, posts and attributed signups on the ledger, with no removal for a rule breach. | STUMP-LEDGER-001, STUMP-LOOP-003 | not run | | |
| R-9 | Counsel's review of the disclosure and refusal mechanics against the FTC's 16 CFR Part 465 rule and the FTC Endorsement Guides. | STUMP-TRUTH-002, STUMP-TRUTH-003 | not run | | |
| R-10 | Apple App Store and Google Play approval and distribution receipts. | STUMP-MOBILE-001, STUMP-MOBILE-002 | not run | | |
| R-11 | A human screen-reader review of the operator and mobile journeys. | STUMP-HANDOFF-001, STUMP-PLAN-001, STUMP-MOBILE-001 | not run | | |
| R-12 | A dated VPAT accessibility report. | STUMP-HANDOFF-001, STUMP-PLAN-001, STUMP-MOBILE-001 | not run | | |
| R-13 | Published client receipts for Claude, ChatGPT, Codex and Copilot MCP use, and enterprise-managed authorization against a real Okta or Entra tenant. | STUMP-SURFACE-014 | not run | | |
| R-14 | Live publishing to DEV, Hashnode, a Discord server, a Slack workspace and a Telegram channel from real company accounts. | STUMP-PUBLISH-011, STUMP-PUBLISH-012 | not run | | |
| R-15 | A legal reading of stored-content and deletion terms for X, Bluesky, Mastodon instances, the Algolia HN API, GitHub, YouTube, Stack Exchange, the licensed suppliers and the alert tools. | STUMP-WATCH-010 | not run | | |
| R-16 | Meta App Review (and Business Verification if Meta asks for it) for Instagram content publishing and Facebook Page permissions, and real Instagram and Page journeys. | STUMP-PUBLISH-014, STUMP-PUBLISH-023, STUMP-PUBLISH-016 | not run | | |
| R-17 | TikTok's audit of the company's Content Posting API client, and a real public post. | STUMP-PUBLISH-018 | not run | | |
| R-18 | YouTube's API audit and Google's OAuth verification for the upload scope, and a real public upload. | STUMP-PUBLISH-015 | not run | | |
| R-19 | Pinterest Standard access for the company's app, and a real Pin. | STUMP-PUBLISH-019 | not run | | |
| R-20 | Google's approval of the company's Business Profile API access, and a real location's post, update and review reply. | STUMP-PUBLISH-020, STUMP-REVIEW-001 | not run | | |
| R-21 | A real G2 vendor account with API access and a Capterra vendor listing, with a review reply journey on each. | STUMP-REVIEW-001 | not run | | |
| R-22 | A licensed web and news search account (Brave Search's commercial plan first) and a real watch under its terms. | STUMP-WATCH-018 | not run | | |
| R-23 | Real Syften, Octolens and F5Bot alerts delivered to an installation from the company's own subscriptions. | STUMP-WATCH-014 | not run | | |
| R-24 | Chrome Web Store, Firefox Add-ons and Apple listings for the browser extension. | STUMP-DRAFT-013 | not run | | |
| R-25 | Canva's review of a public Connect integration, Unsplash production access and a GIPHY production key, each with a real round trip. | STUMP-BRAND-007, STUMP-BRAND-009 | not run | | |
| R-26 | Published Zapier and Make apps, each with a real Zap or scenario run. | STUMP-STACK-006 | not run | | |
| R-27 | Ads API access at Meta, LinkedIn and X, and a real boost at each. | STUMP-BOOST-001 | not run | | |
| R-28 | Every price, limit and media rule in `docs/networks.md` re-read from the network's own pages before each release, with its read date. | STUMP-PLAN-005, STUMP-PUBLISH-009 | not run | | |
