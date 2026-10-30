# Stump's domain source

Everything Stump adds to the Base foundation lives here. `CONTRACT.md` is the
target; `src/modules/` and `src/base/` are recorded Base copies (`base-copies.json`)
and are never edited in place.

| Folder | Holds |
| --- | --- |
| `actions/` | The one action runner both doors use (`runner.ts`), the tool and context types (`types.ts`), and the refusal hook (`refusals.ts`). |
| `tools/` | Tool definitions, one file per area (`stump.<area>.<verb>` lives in `tools/<area>.ts`), listed in `tools/index.ts`. |
| `agent-door/` | The Base agent door adapter (`index.ts`) and the agent credentials a person issues (`credentials.ts`). |
| `http/` | The person door under `/app/api` and the `/app` document gate. |
| `people/` | Roles, connections, invitations and the person behind a session. |
| `items/` | The item state machine (`state.ts`) and the Pause fence. |
| `publish/` | The scheduler tick, scheduling checks, queue slots and one publisher per network (Bluesky, Mastodon, X, LinkedIn). |
| `accounts/` | Connected accounts and the company's network apps: consent, sealed credentials (`seal.ts`), refresh and disconnect. |
| `ledger/` | Reading, searching, correcting and exporting ledger entries (`query.ts`, `correct.ts`, `csv.ts`); `record.ts` is the one writer of `stump_ledger` and `stump_ledger_versions`. |
| `links/` | The company's link rules and `tagOwnLinks`, the one function that puts UTM tags on its own links. |
| `inbox/` | The inbox: reading a connected X account's mentions and replies once each at the company's read price (`poll.ts`), the records both doors answer (`store.ts`), and replies to people who engaged first through drafting, the publisher and the ledger (`reply.ts`). |
| `stack/` | Connections to Orbit and Vane (secrets sealed), offers, signed sends, and `annotateLedgerEntry` for the posting path. |
| `net/` | `stumpFetch`, the one outbound fetch every network call uses. |
| `imports/` | The one import door (`door.ts`) and its sources beyond the venue list: `buffer.ts` reads a Buffer export into accounts, queue slots, ledger entries and paused items (`buffer-targets.ts`; the imported entry's write, in `record.ts`'s shape, in `buffer-ledger.ts` until it moves there). |
| `data/` | Erasure of a person (`erase.ts`; a post deleted at its network reads removed, `removal.ts`) and the draft check run again after an import or erasure (`recheck.ts`); `rer export` and `rer import` follow `scripts/stump/archive-policy.mjs`. |
| `watches/` | Watches: source polling with per-source state, screening (with the company's one author block list, `blocks.ts`) and ranking reads of findings, immediate alerts to Slack and a signed webhook with replay (credentials sealed in `seal.ts`), and the scheduled event's `pollDueWatches`. |
| `today/` | The Today screen at `/app`: what needs the signed-in person today (hand-offs due, what is held and why, what goes out today, threads worth answering, recent results and the week's counts), read only through existing actions (`sections.ts` shapes them, `TodayPage.tsx` draws them). |
| `lib/<name>/` | Pure leaf libraries written by library lanes. A library imports nothing outside its folder. |
| `ui/` | The signed-in app's shell, navigation, tokens and small shared components. |

## How a request runs

Every action is declared once, in a `StumpTool`, and runs through one path:

- The person door: `GET /app/api/actions` lists the tools the signed-in person may run; `POST /app/api/actions/<tool>` runs one with the session cookie and the exact `Origin`, answering `{result}` or 4xx `{code, ...fields}`.
- The MCP door: `POST /mcp` (Base `modules/agent-door`) runs the same definition through the company policy, approvals, idempotency, Pause and audit. An agent acts for its person with exactly that person's role, re-read on every call.

`resolveAction` applies the same checks in the same order for both doors: refused acts (`act_refused` with `rule` and `source`), unknown actions, the person's role, the action's argument schema. A banned act asked for by name (`like`, `repost`, ...) answers `act_refused`, never an unknown-action error.

## Adding to Stump

- **A tool.** Create or extend `tools/<area>.ts` exporting `<area>Tools: StumpTool[]`, add one line to `tools/index.ts`, and one entry to `agent-surface.json` (`tools`, plus a `journey` step expecting each class the tool declares). Name it exactly as the contract's Agent surface table and `V1-INTERFACE` do; scope `stump:<area>`; classes from the table.
- **An action.** Add it to the tool's `actions`: `roles` (from `people/roles.ts`), `properties` and `required` (an argument shared by two actions must be declared identically, or the Worker refuses to start), `read: true` when it changes nothing, `classify` computed from records and never from argument text (D-7), `summary` for approvers, `authority` for access and security actions, `revision` when it takes `expected_revision`, and `run`.
- **A product refusal.** Call `refuseAct(ctx, tool, action, {rule, source})` from `classify`, so it happens before any policy decision and is recorded in `stump_refusals`. Use `refuse(code, fields)` for every other refusal; never invent a code the contract or Base already names.
- **A screen.** Add `src/routes/app.<area>.tsx` (or `app.settings.<area>.tsx`) calling `runAction` from `ui/api.ts`; wrap each page section in `HydrationUnit`; use the `st-*` classes and `--stump-*` tokens in `ui/styles.ts` (add tokens there, never colours in a screen). Commit the regenerated `src/routeTree.gen.ts`; on a merge conflict, regenerate it.
- **A nav entry.** One line in `ui/nav.ts`, in `work` for daily work or `settings` for configuration, only together with the screen it opens.
- **A migration.** Add `migrations/core/NNNN_stump_<area>_<what>.sql`, never editing an applied one. Each lane takes numbers from its own block so parallel lanes never collide: spine 0017-0099, venues and hand-offs 0100-0199, brand, drafts and refusals 0200-0299, publishing and scheduling 0300-0399, watches 0400-0499, ledger, inbox and stack 0500-0599, export and erasure 0600-0699. After v0.1.0 lands, take the next number above the highest.
- **A network call.** Use `stumpFetch(env)` from `net/fetch.ts`. Nothing calls `fetch` to a network directly, so `STUMP_NETWORK_EDGE` (`.dev.vars`, local runtimes only) can route every request to a fake.
- **A publisher.** Implement `Publisher` from `publish/types.ts` and add one line to `publish/publishers.ts`. The scheduler tick claims due items no Pause covers and records the outcome; `posted` needs the network's own id and URL read back (D-5).
- **An item state change.** Use `moveItem` from `items/state.ts`, which checks the allowed move and records history. A schedule while a Pause covers the account goes to `paused` (`pauseFor`).

## Tests

Through public doors only, under the seed's 200-test cap, aiming far lower.
`tests/stump/instance.mjs` attaches to `STUMP_URL` (with `STUMP_DEV_KEY_FILE`)
or starts `rer dev` itself; add a test only for a flow a person would notice
breaking.
