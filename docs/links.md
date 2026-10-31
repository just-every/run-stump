Every link to your own sites in a post carries UTM tags, so you can see which posts brought visits and signups.

## Tags

Stump tags links to the company's own domains only, never links to other people's sites:

| Tag | Value |
| --- | --- |
| Source | The network or the venue |
| Medium | Social, community, referral, email or press |
| Campaign | The post's campaign |
| Content | The post: its id, or the hand-off's short id for a hand-off |

You set your own domains and naming rules once.

## Signups by post

Count them where your analytics reads UTM tags: `utm_content` names the post, `utm_campaign` its campaign and `utm_source` where it went. Each [ledger](/docs/ledger) entry and its CSV row carry the same `utm_content`, so a row of signups joins to the post that brought them. Connect [Vane](/docs/stack) and each post's signups show there: Vane's attribution counts them by the post's `utm_content`, and each post is marked on its day with its link.
