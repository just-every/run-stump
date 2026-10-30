Already keep a list of venues? Import it from Markdown or CSV under **Venues › Import a venue list**, as a dry run first. Only the owner imports.

## Markdown

The venue list Markdown has up to three kinds of section. Each record is a `###` heading followed by `- key: value` lines. Keys are lower-case with underscores, lists are JSON arrays, and booleans are `true` or `false`.

````markdown
---
date: "2026-10-30"
---
## Venue directory

### reddit-freelance — r/freelance
- url: https://www.reddit.com/r/freelance/
- platform: Reddit
- status: ready
- priority: high
- seeds: ["Tally Invoices"]
- rules_urls: ["https://www.reddit.com/r/freelance/wiki/rules"]
- human_written_required: true
- requirements: 50 karma, account 30 days old
- shared_limit: One post a week
- why: Freelancers ask how to chase late invoices here every week.

### mastodon-freelancers — Freelancers on Mastodon
- url: https://mastodon.social/tags/freelance
- platform: Mastodon
- status: candidate

## Tally Invoices

### reddit-freelance-1 — r/freelance weekly thread
- seed: Tally Invoices
- venue_id: reddit-freelance
- platform: Reddit
- status: ready
- priority: high
- post_type: comment
- human_written_required: true

#### Draft

```text
We built Tally Invoices to send the reminder you keep forgetting to send.
```

## Not recommended

### Growth Hackers Slack
- url: https://growthhackers.example/slack
- reason: Bans any mention of your own product.
- alternative: r/freelance's weekly thread.
````

- **`## Venue directory`** (also `## Venues`): one record per venue, headed `### <venue_id> — <name>`. `url` and `status` are required.
- **A section named for a product** (here `## Tally Invoices`): entries, each `### <entry_id> — <where>` with `seed` (the product), `venue_id` (a venue in the directory), `platform`, `status`, `priority`, `post_type` and `human_written_required`, and its text in a fenced block under `#### Draft`. Each entry becomes a draft for that product and venue.
- **`## Not recommended`**: excluded venues, `### <name>` with `reason` (required) and `alternative`.

The front matter `date` is the day you read the rules pages; rules imported from the list are sourced with it.

## CSV

One row per venue, with a header row. A row that also has `entry_id` adds a draft for that venue; several rows may name the same venue.

```csv
venue_id,name,url,platform,kind,status,priority,rules_urls,rules_read_at,human_written_required,requirements,why,shared_limit,seeds
reddit-freelance,r/freelance,https://www.reddit.com/r/freelance/,Reddit,subreddit,ready,high,https://www.reddit.com/r/freelance/wiki/rules,2026-10-30,true,"50 karma, account 30 days old",Freelancers ask about late invoices here,One post a week,Tally Invoices
mastodon-freelancers,Freelancers on Mastodon,https://mastodon.social/tags/freelance,Mastodon,forum,candidate,medium,,,false,,,,Tally Invoices
```

| Column | Holds |
| --- | --- |
| `url` | The venue's address (required, except for an excluded row). `community_url` is an entry's own link, not the venue's. |
| `name`, `venue_id` | Its name and your own id for it. |
| `status` | `candidate`, `join-first`, `ready`, `editorial`, `paid`, `hold` or `excluded`. |
| `priority` | `top`, `high`, `medium` or `low` (`strong` reads as high, `fallback` as low). |
| `kind` | `subreddit`, `forum`, `slack`, `discord`, `newsletter`, `podcast`, `directory`, `publication`, `journalist`, `launch`, `event` or `own_channel`. Left empty, it comes from the id, platform, name or address. A Mastodon instance, an X community or a Bluesky feed is a `forum` with its `platform`. |
| `platform` | Where it runs: Reddit, Mastodon, Discord… |
| `rules_urls` (or `rules_url`) | The rules page, or several separated by `;`. |
| `rules_read_at` | The day you read them, `YYYY-MM-DD`. A rule is sourced only with one rules page and this date. |
| `human_written_required` | `true` or `false`. `true` records the AI text rule as banned, `false` as allowed; empty records no rule. |
| `requirements` | What posting takes. Karma ("50 karma"), account age ("account 30 days old"), moderator approval and membership become the venue's gates; the text shows on the venue. |
| `why` (or `why_it_matters`), `reader_value`, `audience` | Why it matters, what readers get, who reads it. |
| `shared_limit` | "One post a week" becomes the company's shared limit there. |
| `seeds` (or `products`) | Products it fits, separated by `;`. |
| `reason`, `alternative` | Makes the row an excluded venue. |
| `entry_id`, `product`, `post_type`, `post_url`, `community_url`, `how_to_post`, `notes`, `draft_title`, `draft` | An entry's draft and its details. |

## How an import runs

1. Upload the file. The dry run reports how many venues, entries and exclusions it found, and every row it refused with the reason. Nothing is written. A file Stump cannot read at all says what it expected instead.
2. Apply it. Each venue is created once, with its rules, gates, limit and products. Excluded venues arrive excluded with their reason and alternative.

Running the same file again changes nothing. Undo removes what the import created and lists the edits made since, which it keeps.

Text in an imported file never changes a rule or a route on its own: rules come only from the columns and keys above.
