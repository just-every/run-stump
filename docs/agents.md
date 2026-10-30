Stump's jobs are tools an agent can call through one MCP door. An agent acts for one person, with exactly that person's role, under your company's policy.

## Connect an agent

In **Settings, Agents**, name the agent and create its credential. The token is shown once, and works as a Bearer token for `POST /mcp`. Revoke it there at any time.

```http
POST /mcp
Authorization: Bearer <token>
```

## One door, one set of rules

An agent and the app run the same action through the same checks: the person's role, the action's arguments, the venue's rules and the acts Stump refuses. A banned act asked for by name, such as `like` or `repost`, answers `act_refused` with the rule and its source.

An argument the action does not take is refused with `invalid_arguments` naming it, through the app and through MCP alike; only `idempotency_key` and `expected_revision` ride along with every action. Nothing is dropped silently, and nothing an agent sends can change how a call is classified: a publish that also says `counterparty: "internal"` is refused, not run as an internal post. The refusal is audited as a call with no decision and no classes, because Stump refuses it before it classifies the call or applies the policy. Send the call again without that argument and its audit row names the item and its computed classes.

## Company policy

The company's policy decides which classes of action an agent runs at once and which wait for a person to approve. In **Settings, Agents**, the owner answers each kind of action: Allow, Allow then review, Ask first or Block. Each answer saves as it is given, and agents wait until every kind has one. When a policy holds an agent's post, Stump saves the exact revision, account, venue and time, and publishes only that revision once it is approved.

The owner can also edit the whole policy document for reviewers, approvers and narrower rules. Owners, admins and editors see the answers, this week's agent calls by class and how the policy handled them, and recent agent activity. Everyone sees their own agents and what waits for them.

## Attribution

Everything an agent drafts or publishes reads "agent for person" on the [ledger](/docs/ledger).

## Pause

Pause stops agents' publishing as well as their calls. See [Pause](/docs/pause).
