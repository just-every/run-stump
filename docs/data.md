Take everything with you any time, and erase a person when they ask.

## Export

One archive holds everything the company keeps in Stump: venues and rules, people, voice guides, products and claims, every post with every revision, the ledger, findings and settings.

```sh
rer export --output exports/stump.rer
```

Run it while the app is stopped.

Network tokens, app keys and the secrets for Orbit, Vane and alert webhooks never leave the installation.

## Restore

Restoring an archive into an empty installation gives the same records. Connected accounts wait for their owners to reconnect them, scheduled posts arrive paused, and agent credentials arrive revoked, so people issue new ones.

```sh
rer import --input exports/stump.rer --yes
```

## Erase a person

Stump erases a person outside the company, such as a journalist or someone who engaged with a post, or a former team member. Their personal data leaves findings, the inbox and venue records; ledger entries keep the post with an anonymous reference.

Name an engager by their handle on each network or source, such as their X handle and their Hacker News name. Each handle is matched only on its own network, so someone else with the same name elsewhere is left alone.

Posts the company made that name the person are listed for deletion at each network, each with its outcome, because a post already read or copied cannot be recalled. A post under legal hold stays, and is named as kept.

An erased engager stays erased: later polls, overlap windows and backfills do not collect their posts again, and nothing alerts with them. Stump keeps only a digest of each erased post's address and of the person's handle on each source, never the address or handle itself.

A journalist's name leaves their pitches in every form, in any case and in every revision, and what an outreach list import kept of them leaves too: their venue, the entries aimed at them and the uploaded file. Uploading the same list again is refused.

Copies an agent's earlier calls hold, and the record of a refused action, lose the person as well; an agent repeating a read gets current records. If the person was already sent to Orbit, the answer lists each send so you can erase them there too.
