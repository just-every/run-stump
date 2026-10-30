# Network table

The prices, limits, gates and link-check methods Stump reads as data. Clauses in `CONTRACT.md` state outcomes against this table; this file holds the values and when they were read. The company can update its own copy of the price table in the app. Every value is re-read from the network's own page before each release (Field proof register R-28), and the read date below changes with it.

## Prices

| Network | Act | Price (USD) | Source | Read |
| --- | --- | --- | --- | --- |
| X (pay-per-use) | Post without a URL | 0.015 | https://docs.x.com/x-api/getting-started/pricing | 30 Oct 2026 |
| X (pay-per-use) | Post with a URL | 0.20 | same | 30 Oct 2026 |
| X (pay-per-use) | Post read (search, mentions) | 0.005 | same | 30 Oct 2026 |
| X (pay-per-use) | Owned read (the account's own posts and their metrics) | 0.001 | same | 30 Oct 2026 |
| X (pay-per-use) | Monthly read cap | 3,000,000 reads | same | 30 Oct 2026 |

X's pricing page carries no date and also advertises new-user credits; prices can change without notice, so Stump never hard-codes them.

## Limits

| Network | Limit | Value | Source | Read |
| --- | --- | --- | --- | --- |
| Bluesky | Post length | 300 graphemes | Bluesky lexicon | 30 Oct 2026 |
| Bluesky | Writes per account | about 1,666 records an hour | https://docs.bsky.app/docs/advanced-guides/rate-limits | 30 Oct 2026 |
| Mastodon | Post length | the instance's own limit, read from the instance | instance API | per instance |
| X | Post length | weighted 280, or the account's longer limit | X API | 30 Oct 2026 |
| LinkedIn (Share on LinkedIn) | Post length | 3,000 characters | https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin | 30 Oct 2026 |
| LinkedIn (Share on LinkedIn) | Requests per member | 150 a day | same | 30 Oct 2026 |
| LinkedIn (Community Management, Development tier) | Requests | 500 per app and 100 per member a day | https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview | 30 Oct 2026 |
| Threads | Post length | 500 characters | https://developers.facebook.com/docs/threads/overview | 30 Oct 2026 |
| Threads | API posts per profile | 250 per 24 hours | same | 30 Oct 2026 |
| Threads | Replies per profile | 1,000 per 24 hours | same | 30 Oct 2026 |
| Instagram | API posts per account | 100 per 24 hours (Meta's docs also say 50 for carousels; Stump uses the lower figure for carousels) | https://developers.facebook.com/docs/instagram-platform/content-publishing | 30 Oct 2026 |
| Instagram | Image format | JPEG only | same | 30 Oct 2026 |
| YouTube | Project quota | 10,000 units a day; uploads counted against it | https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits | 30 Oct 2026 |

## Gates

| Network | Gate | State without it |
| --- | --- | --- |
| X | A developer app on pay-per-use; the Automated label and operator bio for automated accounts; X's prior approval for AI-generated replies | No app: X not connected. No label: agent-initiated publishing refused (D-4). No approval: AI-drafted X replies gated. |
| LinkedIn member | Share on LinkedIn (self-serve, `w_member_social`) | Not connected |
| LinkedIn page and member analytics | Community Management API (vetted: Development, then Standard tier with a screencast). LinkedIn asks for it on a new app with no other product. Member post analytics need `r_member_postAnalytics`. `r_member_social` (reading members' posts) is closed. | Page not connected; member results entered by a person |
| Threads, Instagram, Facebook | Meta App Review for people without a role on the app (Business Verification where Meta asks) | Only role holders and invited testers connect |
| YouTube | API audit (and Google OAuth verification for the upload scope) | Uploads from unaudited projects stay private |
| TikTok | Content Posting API audit | Posts from unaudited clients stay private |
| Pinterest | Standard access | Trial limits |
| Google Business Profile | Approved Business Profile API access (quota is 0 until then) | Posts and updates become hand-offs |
| Reddit | Written approval for commercial use of its data; a licensed supplier | "Reddit: not watched" unless a supplier or alert tool covers it |

## How a hand-off link is checked

| Venue | Check |
| --- | --- |
| Bluesky | Public AppView API: the post record and its author DID |
| Mastodon | The instance's statuses API |
| X | oEmbed, or an owned read where the post is the company's |
| Threads | Threads API for the company's profiles; otherwise person-confirmed |
| Hacker News | Algolia HN API item and author |
| GitHub | REST API |
| Product Hunt | Product Hunt API |
| DEV | DEV API |
| YouTube | oEmbed or the Data API |
| Stack Exchange | Stack Exchange API |
| Public Discourse forums | The forum's public JSON for the post |
| Reddit | Person-confirmed unless a licensed supplier verifies it; no request to reddit.com |
| LinkedIn | Person-confirmed; no request to linkedin.com |
| Members-only venues (Slack, Discord, private forums) | Person-confirmed |
| Other public pages | Person-confirmed unless the venue's recorded terms allow a single fetch |
