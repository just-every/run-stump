Stump keeps your products, the claims you may make with their proof, and each person's own voice. Every draft is checked against them.

## Products

For each product: its name and other names, a one-line description, audience, URLs, the competitors it is compared with, the words it uses and the words it avoids, and its tone. In **Settings › Brand**, **Add product** takes them all; on a product already there, its tone, words and **Add description, audience and links** edit in place and save as you leave each field. A draft that uses an avoided word cannot be marked ready until the word is gone. Drafting, disclosure and listening all read this, so a mention of a product or a competitor is recognised wherever it appears.

A name is recognised whatever its capitals, so "orbit" names Orbit. When the name is also an everyday word, as Rota is, tick **Count Rota only when written Rota** under the product: then "Rota" names it and "a month rota" does not, in drafts and in what [listening](/docs/listening) finds. Agents set the same with `match_case` on `product_create` or `product_update`.

## Claims

- **Allowed claims**, each with its proof (a URL, a document, a number or a date), an owner and a review date. A claim past its review date reads as stale until its owner renews it.
- **Banned claims**, each with the reason.
- **Comparative claims** against a named competitor, each with a dated source.

## The claim check

Before a post can be marked ready, Stump finds its factual product claims and matches each one to a current claim:

- an unmatched claim is flagged for someone to back or remove;
- a banned claim stops the post;
- a stale claim is flagged;
- a number that differs from its proof is flagged with the proof's number;
- an attached image without alt text stops the post until its alt text is set.

A sentence can make several claims, so the check reads it clause by clause: "New in 2.4: when a client is 7 days late, Hourglass sends a reminder" is one claim about the reminder, and a lead-in such as "New in 2.4" claims nothing. A link after a sentence is not part of its claim.

### What it reads as a claim

In a post about a product, these are claims to back, whether or not the sentence names the product:

- a number: a percent, a multiple, a price, or a count of minutes, hours, steps, clicks, users and the like ("cuts triage time by 30%", "takes 5 minutes");
- a comparison, a superlative, a guarantee or a compliance statement ("faster than Deputy", "the fastest", "zero downtime", "SOC 2");
- what the product does: "adds a weekly summary", "It also syncs with Stripe now", "Now you can edit each reminder", and what a person does with it, "the manager approves in one tap".

### Numbers against their proof

A sentence that says what a claim says, counting the same things in other numbers, is that claim with a number that differs from its proof. Against the claim "Builds a month rota for 20 staff in 10 minutes", whose proof says "10 minutes median, 20 staff", the sentence "A month rota for 20 staff now takes 5 minutes" is flagged as differing from the proof of that claim, with the proof's number: 10 minutes. The same sentence with 10 minutes matches the claim. A percent or multiple is weighed against the claim's percent or multiple ("50% faster" against a proven 30%), and a price against its price; one the claim and its proof state none of ("50% cheaper" against "Cheaper than HubSpot") is flagged as not in the proof.

### What you still review

The check reads words and numbers; it does not understand the post. It finds the claims above by how they are written, so a claim worded unusually ("managers can sign off swaps without a call") may pass unflagged, and a plain sentence may now and then be flagged when it is not a claim. A sentence that matches a claim is backed by that claim's proof, so it is as true as the proof on record. Read every post before it goes out; the check makes sure that what it recognises as a claim has proof, a review date and the proof's own numbers.

A post passes when every claim in it is matched and nothing stops it. A sentence that only says what the product does, with no number, comparison or guarantee in it, does not stop the post from being marked ready, but it stays flagged, and the post has not passed, until someone backs it or removes it.

## Backing a claim from a draft

In Compose's checks, a sentence that only says what the product does has **Back claim** beside it. It opens **Settings › Brand** with that sentence as a new claim, for the draft's product. Add its proof and review date, and Stump records the claim, matches the sentence to it and takes you back to the draft with its checks run again.

A claim that stops the post has **Fix claim** and **Update the proof** beside it. **Fix claim** selects the flagged words in the variant, so typing replaces them: the banned or unproven sentence, or the number that differs from its proof ("$12" in "$12 a month"). **Update the proof** opens **Settings › Brand** the same way as Back claim, so you can record the proof that backs it. A banned claim has only Fix claim: it comes out of the post.

The check runs the same way for people and for agents.

## A person's voice

Each person may have a voice guide built from writing they choose, with notes on what they say and never say. A voice guide drafts only that person's posts, and it never passes to anyone else.
