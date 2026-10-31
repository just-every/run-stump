# Stump

Find where your customers gather, show up in your own voice, and see what it brings in.

Open-source alternative to Hootsuite, Buffer and Typefully.

Stump is an earned-channels marketing desk: a register of the communities, newsletters, podcasts, directories and journalists where your customers already are, with each venue's rules; drafts written in a real person's voice; a hand-off queue for venues that ban automation, where the agent drafts and a named person posts; publishing to your own accounts; and a ledger of every post.

What works today:

- **Venues**: the register with each rule's source and read date, the routes those rules allow, members and gates, shared limits, and import from Markdown or CSV ([docs/import-venues.md](docs/import-venues.md)).
- **Brand**: products, claims with proof, banned and comparative claims, voice guides, and the claim check on every draft.
- **Compose**: one post with a variant per account, drafts from a changelog through your own AI provider (set it in Settings › Connections; [docs/ai-provider.md](docs/ai-provider.md)), scheduling and the queue.
- **Publishing** to Mastodon and Bluesky for real, and to X and LinkedIn with your own app keys, each post read back onto the **ledger** with UTM-tagged links.
- **Hand-offs** to the named member who posts by hand, started from a venue's page, with the posted link checked and recorded.
- **Listening** on Hacker News, feeds, Bluesky and Mastodon, ranked with reasons; the **inbox** on X; Orbit and Vane connections; Pause; export and erasure.
- **Agents** through one MCP door under your company's policy ([docs/agents.md](docs/agents.md)).

[CONTRACT.md](CONTRACT.md) is the target contract, with each clause's status; [docs/](docs/) is the guide a person reads.

## Run locally

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-stump
```

The one line installs `rer`, clones Stump into `./run-stump` and starts it ([docs/install.md](docs/install.md)). Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-stump` does the same. Later, run `cd run-stump && rer dev`.

It starts `main`. To try a branch, a release candidate or a tag, check it out in that folder first, then start it the same way:

```sh
cd run-stump
git fetch origin
git checkout <branch or tag>
rer dev
```

`rer dev` installs the dependencies that version locks and keeps your local data. A fresh folder for it works too: `git clone --branch <branch or tag> https://github.com/just-every/run-stump run-stump-rc && cd run-stump-rc && rer dev`.

Open the private sign-in link printed by `rer`, on this computer. The installed `/` is Base's shared Lobby; finish first-run setup at `/setup`. `RER_SITE` names the separate static site (its homepage, `/run` and `/contract`). The domain run-stump.com is not live yet, so the run site is local only.

This checkout pins `@runeditrun/rer` **0.2.91**, Node **22.20.0** and pnpm **10.12.4**. Read [RUN-LOCALLY.md](RUN-LOCALLY.md), [OPERATIONS.md](OPERATIONS.md) and [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md) for the verbs (`rer verify`, `rer reset --yes`, `rer deploy`, `rer describe`), data custody and deploy requirements. Local mail is suppressed. Private runtime state and credentials stay outside Git. MIT licensed.
