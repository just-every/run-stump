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

`tools/list` lists the tools your person may use, each with its classes.

## One door, one set of rules

An agent and the app run the same action through the same checks: the person's role, the action's arguments, the venue's rules and the acts Stump refuses. A banned act asked for by name, such as `like` or `repost`, answers `act_refused` with the rule and its source.

An argument the action does not take is refused with `invalid_arguments` naming it, through the app and through MCP alike; only `idempotency_key` and `expected_revision` ride along with every action. Nothing is dropped silently, and nothing an agent sends can change how a call is classified: a publish that also says `counterparty: "internal"` is refused, not run as an internal post. The refusal is audited as a call with no decision and no classes, because Stump refuses it before it classifies the call or applies the policy. Send the call again without that argument and its audit row names the item and its computed classes.

## Company policy

The company's policy decides which classes of action an agent runs at once and which wait for a person to approve. In **Settings, Agents**, the owner answers each kind of action: Allow, Allow then review, Ask first or Block. Each answer saves as it is given, and agents wait until every kind has one. When a policy holds an agent's post, Stump saves the exact revision, account, venue and time, and publishes only that revision once it is approved.

Reading never needs an approval: listing the team, reading the AI provider and reading the ledger are standard work, so a policy that blocks access or security changes still lets an agent find the person ids and records it needs.

The owner can also edit the whole policy document for reviewers, approvers and narrower rules. Owners, admins and editors see the answers, this week's agent calls by class and how the policy handled them, and recent agent activity. Everyone sees their own agents and what waits for them.

## Attribution

Everything an agent drafts or publishes reads "agent for person" on the [ledger](/docs/ledger).

## Pause

Pause stops agents' publishing as well as their calls. See [Pause](/docs/pause).
