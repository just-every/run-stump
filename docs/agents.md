Stump's jobs are tools an agent can call through one MCP door. An agent acts for one person, with exactly that person's role, under your company's policy.

## Connect an agent

In **Settings, Agents**, name the agent and create its credential. The token is shown once, and works as a Bearer token for `POST /mcp`. Revoke it there at any time.

The door speaks MCP over streamable HTTP, protocol versions `2026-07-28` and `2025-11-25`. Every request carries the version it speaks:

```http
POST /mcp
Authorization: Bearer <token>
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: stump.venues.manage

{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
 "params": {"name": "stump.venues.manage", "arguments": {"action": "list", "idempotency_key": "…"},
            "_meta": {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}}}
```

- With `2026-07-28`, send `Mcp-Method` (the JSON-RPC method), `Mcp-Name` (the tool name, on `tools/call`) and the version in `params._meta`.
- With `2025-11-25`, send `MCP-Protocol-Version: 2025-11-25`; the `initialize` that names `2025-11-25` in `params.protocolVersion` needs no header.
- A request without the header, or with headers that disagree with its body, answers `-32020 HeaderMismatch`; an older version such as `2025-06-18` answers `-32022 UnsupportedProtocolVersion`. Both carry `data.supported` and `data.hint` saying what to send. A client that speaks only `2025-06-18` or older cannot connect; update it.
- Every call takes an `idempotency_key`, and a tool with several actions takes `action`.

### By hand, with curl

Two requests show the door working without changing any client's settings. Put the token in a variable for this terminal only (`read -rs TOKEN`, then paste it), and use your own address for a deployed Stump. First `initialize`:

```sh
curl -s http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: initialize' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"curl","version":"1"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'
```

It answers with the protocol version, `"serverInfo":{"name":"Stump"}` and the door's instructions. Then a tool, here listing the team:

```sh
curl -s http://127.0.0.1:8787/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' -H 'Mcp-Method: tools/call' -H 'Mcp-Name: stump.team.manage' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"stump.team.manage","arguments":{"action":"list","idempotency_key":"by-hand-1"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'
```

The answer's `structuredContent` holds the team, and `_meta` the policy's decision for the call. No session carries over between the two: each request stands alone with its headers. `tools/list`, sent the same way with `Mcp-Method: tools/list` and no `Mcp-Name`, lists every tool you may call.

### Claude Code

```sh
claude mcp add --transport http stump http://127.0.0.1:8787/mcp --header "Authorization: Bearer <token>"
```

Use your deployed address instead of `http://127.0.0.1:8787` for a deployed Stump. Claude Code sends the protocol headers itself.

### Other clients

Any MCP client that speaks streamable HTTP at `2025-11-25` or later connects with the URL and the header, for example in an `mcp.json`:

```json
{"mcpServers": {"stump": {"type": "http", "url": "http://127.0.0.1:8787/mcp", "headers": {"Authorization": "Bearer <token>"}}}}
```

`tools/list` lists the tools your person may use, each with its classes. Each tool's `action` argument lists the actions it runs, and its description says what each action needs and takes, so an agent reads them before its first call.

## Tools and their actions

Each action's required arguments are in parentheses; the rest are optional. An agent acts for its own person, so where an action takes `person_id` to say whom a draft speaks for, leaving it out means that person.

| Tool | Actions |
| --- | --- |
| `stump.accounts.connect` | `start` (network, owner), `complete`, `list`, `disconnect` (account_id), `reconnect` (account_id), `record_label` (account_id, automated_label) |
| `stump.brand.manage` | `product_create` (name), `product_update` (product_id), `product_list`, `site_read` (url), `company_update` (company_names), `claim_create` (text, kind, owner_id), `claim_update` (claim_id), `claim_get` (claim_id), `claim_list`, `voice_create` (person_id, samples), `voice_update` (voice_id), `voice_get` (voice_id), `voice_list` |
| `stump.calendar.pause` | `pause`, `resume`, `state` |
| `stump.calendar.plan` | `set_slots` (account_id, time_zone, slots), `slots` (account_id), `queue` (item_id, account_id), `release_import` (item_ids, confirm_source_cleared) |
| `stump.data.erase` | `erase` (subject) |
| `stump.drafts.write` | `create` (format), `from_source` (source_url, targets), `master` (account_ids) |
| `stump.drafts.revise` | `get` (item_id), `list`, `save` (item_id), `aim` (item_id, venue_id, product_id), `diff` (item_id, from, to), `restore` (item_id, revision), `mark_ready` (item_id), `save_master` (master_id, text) |
| `stump.drafts.check` | `run` (item_id), `count` (text, networks), `back` (item_id, claim_id), `set_duplicate_window` (days) |
| `stump.drafts.preview` | `master` (master_id), `item` (item_id), `targets` |
| `stump.findings.work` | `list` (watch_id), `dismiss` (finding_id) |
| `stump.handoffs.prepare` | `prepare` (venue_id, person_id, product_id, due_at, lapse, time_zone?) |
| `stump.handoffs.check_link` | `record` (handoff_id, url) |
| `stump.handoffs.manage` | `queue`, `get` (handoff_id), `edit` (handoff_id, draft_text), `skip` (handoff_id, reason), `hold` (handoff_id, reason, review_at), `release` (handoff_id) |
| `stump.inbox.read` | `poll` (account_id), `list` (account_id), `check` (inbox_item_id, account_id, text) |
| `stump.inbox.reply` | `reply` (inbox_item_id, account_id) |
| `stump.items.schedule` | `schedule` (item_id, account_id, at), `publish` (item_id), `resume` (item_id), `resolve` (item_id, decision), `schedule_master` (master_id, at, optional time_zone) |
| `stump.items.media` | `attach` (item_id, file), `set_alt` (media_id, alt) |
| `stump.ledger.search` | `search`, `get` (entry_id), `history`, `export_csv` |
| `stump.ledger.correct` | `correct` (entry_id, note), `mark_removed` (entry_id, reason), `corrections`, `legal_hold` (entry_id, reason) |
| `stump.links.manage` | `set_rules` (own_domains, mediums), `rules`, `preview` (text, route, source, content) |
| `stump.press.contacts` | `create` (kind, name), `get` (contact_id), `list` |
| `stump.setup.apps` | `list`, `set` (network, client_id, client_secret), `set_prices` (network, prices) |
| `stump.setup.ai` | `get`, `set` (base_url, model), `clear` |
| `stump.stack.connect` | `connect` (seed, origin, secret), `list`, `disconnect` (seed) |
| `stump.stack.send` | `offers`, `send` (offer_id) |
| `stump.team.manage` | `invite` (email, display_name, role), `list`, `set_role` (person_id, role), `update` (person_id), `remove` (person_id) |
| `stump.venues.manage` | `create` (kind, name), `propose` (url), `get` (venue_id), `list`, `update` (venue_id), `exclude` (venue_id, reason, alternative), `archive` (venue_id), `restore` (venue_id) |
| `stump.venues.rules` | `set` (venue_id, rules), `routes` (venue_id) |
| `stump.venues.fit` | `set_limit` (venue_id, limit), `usage` (venue_id) |
| `stump.venues.members` | `add` (venue_id, person_id, handle), `list`, `eligibility` (venue_id, person_id), `apply` (venue_id, handle), `approve_application` (application_id) |
| `stump.watches.manage` | `create` (name), `get` (watch_id), `list`, `poll` (watch_id), `update` (watch_id), `mute` (watch_id), `add_source` (watch_id, source), `backfill` (watch_id), `block_author`, `unblock_author`, `replay_delivery` (event_id) |

A first draft, for example: `stump.drafts.write` with `{"action": "create", "format": "post", "text": "…", "idempotency_key": "…"}`. Its answer carries the draft's id and its `check`: `passed` is true only when every claim in it is matched and nothing stops it, and each flag says whether it is `blocking`. The draft is listed in **Compose** under **Drafts**, as "<agent> for <person>", for a person to open and review. `stump.team.manage` `list` gives the team's person ids, for a draft that speaks for someone else.

## One door, one set of rules

An agent and the app run the same action through the same checks: the person's role, the action's arguments, the venue's rules and the acts Stump refuses. A banned act asked for by name, such as `like` or `repost`, answers `act_refused` with the rule and its source.

An argument the action does not take is refused with `invalid_arguments` naming it, through the app and through MCP alike; only `idempotency_key` and `expected_revision` ride along with every action. A key makes a change happen once however often it is sent. An action that only reads (listing the inbox or findings, reading a draft) still sends a key when its tool also writes, because the tool's schema asks for one on every call; the read ignores it and answers current records every time. Nothing is dropped silently, and nothing an agent sends can change how a call is classified: a publish that also says `counterparty: "internal"` is refused, not run as an internal post. The refusal is audited as a call with no decision and no classes, because Stump refuses it before it classifies the call or applies the policy. Send the call again without that argument and its audit row names the item and its computed classes.

## Company policy

The company's policy decides which classes of action an agent runs at once and which wait for a person to approve. In **Settings, Agents**, the owner answers each kind of action: Allow, Allow then review, Ask first or Block. Each answer saves as it is given, and agents wait until every kind has one. When a policy holds an agent's post, Stump saves the exact revision, account, venue and time, and publishes only that revision once it is approved.

Reading never needs an approval: listing the team, the connected accounts and the network apps, reading the AI provider and reading the ledger are standard work, so a policy that blocks access or security changes still lets an agent find the person ids, account ids and records it needs.

The owner can also edit the whole policy document for reviewers, approvers and narrower rules. Owners, admins and editors see the answers, this week's agent calls by class and how the policy handled them, and recent agent activity. Everyone sees their own agents and what waits for them. An agent call that waits for approval also shows on **Today**, under **Held**, and opens its approval page.

An agent call that drafts through the AI provider while none is set is refused at once, with the reason, rather than waiting for an approval it could never use.

## Attribution

Everything an agent drafts or publishes reads "agent for person" on the [ledger](/docs/ledger).

## Pause

Pause stops agents' publishing as well as their calls. See [Pause](/docs/pause).
