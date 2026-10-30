# Stump

Find where your customers gather, show up in your own voice, and see what it brings in.

Open-source alternative to Hootsuite, Buffer and Typefully.

Stump is an earned-channels marketing desk: a register of the communities, newsletters, podcasts, directories and journalists where your customers already are, with each venue's rules; drafts written in a real person's voice; a hand-off queue for venues that ban automation, where the agent drafts and a named person posts; publishing to your own accounts; and a ledger of every post. Stump is a new seed on the Base foundation. The product is a build target: nothing beyond the foundation is built yet, and `CONTRACT.md` is still the foundation's placeholder until Stump's target contract lands.

## Run locally

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-stump
```

If the installer prints a PATH command, run it before the second line. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-stump` does both steps. Later, run `cd run-stump && rer dev`.

Open the private sign-in link printed by `rer`, on this computer. The installed `/` is Base's shared Lobby; finish first-run setup at `/setup`. `RER_SITE` names the separate static site (its homepage, `/run` and `/contract`). The domain run-stump.com is not live yet, so the run site is local only.

This checkout pins `@runeditrun/rer` **0.2.91**, Node **22.20.0** and pnpm **10.12.4**. Read [RUN-LOCALLY.md](RUN-LOCALLY.md), [OPERATIONS.md](OPERATIONS.md) and [SEED-COMMAND-CONTRACT.md](SEED-COMMAND-CONTRACT.md) for the verbs (`rer verify`, `rer reset --yes`, `rer deploy`, `rer describe`), data custody and deploy requirements. Local mail is suppressed. Private runtime state and credentials stay outside Git. MIT licensed.
