Where a venue keeps posting for its members, Stump hands the post to the named member. They get the rules, the facts with proof and a draft in their own voice, post it by hand and record the link.

## Start a hand-off

Open the venue under **Venues**. Where its rules keep posting for its members, its **Routes** card has **Hand off**. Choose:

- **Who posts**: a member of the venue (anyone else gets the venue's join steps first). An invited teammate can receive a hand-off once they have accepted their invitation by signing in; until then the hand-off is refused with that reason.
- **Product**, the **due** date, and what happens **if it is not posted by then**: let it expire, hand it to the next member, or move it to the venue's next opening.
- Optionally the **thread** it belongs in (a link on the venue), and a **draft**: write it, leave it empty for a brief with talking points, or let your [AI provider](/docs/ai-provider) draft it where the venue allows AI-written text. With no provider set, ticking **Or draft it with your AI provider** says where one is set.

The brief opens next. Editors and admins hand off to anyone on the team; a contributor hands off only to themselves. From **Listening**, a finding on a venue you have recorded has **Hand off** too, with the thread filled in.

An agent starts one with `stump.handoffs.prepare` (`venue_id`, `person_id`, `product_id`, `due_at`, `lapse`, and optionally `thread_url`, `text` or `generate`). Preparing a hand-off is a step a person completes, so it follows your company's policy for that kind of action, and an approver sees "Hand <person> a post on <venue>", the product it is for, and whether the brief carries talking points, an AI draft or a draft written by the preparer.

## What a brief holds

- The exact thread or channel, and why it fits.
- The venue's rules, each with its source.
- The facts and claims, each with its proof.
- The disclosure line.
- A draft in the person's voice, or talking points and an empty box for their own words where the venue bans AI-written text.
- The product's link with its [tags](/docs/links), and **Copy link**: `utm_content` is the hand-off's short id, so signups from the post join to its ledger entry. A venue that bans links gets none, and a company with no own domain set under **Settings › Connections › Link tags** has no link to tag.

Someone outside the company, such as an investor or a friend, who recommends a product gets talking points and facts only, and says the words are their own before the post is recorded.

## When a hand-off is held

A hand-off waits, with the reason on it, while something stops the post:

- A venue rule. A venue that keeps self-promotion to its weekly thread holds a hand-off aimed anywhere else. One aimed at that thread stays open.
- A draft that nearly repeats something the company posted or queued. The hold links the earlier post and names the hand-off that posted it, and rewriting the draft releases it.
- The venue's shared limit for the period. The hold names the date the venue has room again.

## Who sees a hand-off

Each person works their own queue, ordered by due date. **Hand-offs** has two tabs, **Mine** and **Everyone**, each with the number of hand-offs still to post in it; an owner or admin opens on **Everyone**, anyone else on **Mine**. A poster sees only their own hand-offs. A person who is not yet a member of the venue gets its join steps and gates first.

## Record the link

Paste the link to the post. Stump checks that it belongs to the venue (for a Discord server, that the message link's server is the venue's server; see [Venues](/docs/venues)), and where the network offers an official way to confirm the post and its author, uses it. Reddit, LinkedIn and members-only links are recorded as confirmed by the person, and Stump makes no request to their pages.

A confirmed link marks the hand-off posted and writes the [ledger](/docs/ledger) entry with the posted text. A link to another venue or another author is refused, with the reason.

The claim check runs on the text recorded: the text read back from the network, else the person's own words or the draft. The ledger entry lists only the claims that text matches, and the brief names each sentence no claim on record backs (a number the proof does not give, say), so someone can back it under **Settings › Brand** or correct the post.

## When a hand-off lapses

Every hand-off has a due date and a lapse action its creator chose: expire it, give it to another member of the venue, or move it to the venue's next open place. When it lapses, the action runs and is logged. A skip needs a reason and frees the venue's place for another post.
