Take everything with you any time, and erase a person when they ask.

## Export

One archive holds everything the company keeps in Stump: venues and rules, people, voice guides, products and claims, every post with every revision, the ledger, findings and settings.

```sh
rer export --output exports/stump.rer
```

Network tokens, app keys and the secrets for Orbit, Vane and alert webhooks never leave the installation.

## Restore

Restoring an archive into an empty installation gives the same records. Connected accounts wait for their owners to reconnect them, scheduled posts arrive paused, and agent credentials arrive revoked, so people issue new ones.

```sh
rer import --input exports/stump.rer --yes
```

## Erase a person

Stump erases a person outside the company, such as a journalist or someone who engaged with a post, or a former team member. Their personal data leaves findings, the inbox and venue records; ledger entries keep the post with an anonymous reference.

Posts the company made that name the person are listed for deletion at each network, each with its outcome, because a post already read or copied cannot be recalled.
