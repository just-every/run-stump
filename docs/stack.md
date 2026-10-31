Stump works on its own. With Orbit and Vane beside it, a post becomes a contact and a signup you can count.

## Orbit

When a person who can be identified engages with substance on your account, by asking a question, replying with more than a reaction or saying they are evaluating, Stump offers them to Orbit as a contact with the public post they wrote. Stump sends only what is public, and never looks up an email address. Orbit decides whether the person can be contacted. Each offer names the post it came from, so someone who engaged twice, say once with the company's account and once with a teammate's, has two offers and you send the one you mean.

To connect Orbit, open **Signal sources** in Orbit and, under **Configure a source**, enter a source ID and a signing secret of at least 32 characters, then save. Enter Orbit's address, that source ID and the same secret in Stump under **Settings › Connections › Orbit**.

## Vane

Connect Vane and each post's signups show there. Every link to your own sites carries its post's `utm_content` ([tracked links](/docs/links)), so Vane's attribution counts the signups each post brought, and each published post adds a dated note in Vane with its link, so changes in traffic line up with what went out.

Vane is Run Edit Run's own analytics. To run it beside Stump on your computer: `rer dev just-every/run-vane`, then in Vane add your site and, in its settings, create the **Annotation webhook** key (shown once). Enter Vane's address, the site id and that key in Stump under **Settings › Connections › Vane**. Without Vane, the tagged links still reach whatever analytics your site uses.

## Connecting them

An admin connects each one with its address and a shared secret. Stump signs what it sends.
