One press stops every scheduled post, for an incident or bad news. Queued posts hold until someone resumes.

## Pause everything

Press **Pause publishing** at the top of any screen. Nothing posts while publishing is paused, and a banner says who paused it and when. Owners, admins and editors can pause and resume.

## Pause one account

On the **Pause** screen, under Settings, pause a single account. Only that account's posts hold; the rest go out as planned.

## Resume

Press **Resume publishing**. Stump then lists what happens to the posts that were held:

- posts whose time is still ahead **will go out** at their time;
- posts whose time passed while paused **stay held** until someone reschedules or drops them, so nothing goes out late by surprise.

## History

Every pause and resume is recorded with the person and the time, including when an agent did it on someone's behalf. The Pause screen shows the history.

## Agents

Pause stops agents' publishing too. Through MCP, an agent calls the same tool the app does, `stump.calendar.pause`, with its own idempotency key:

```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "stump.calendar.pause", "arguments": {"action": "pause", "scope": "all", "idempotency_key": "incident-2026-10-30"}}}
```

Its `resume` action answers the same two lists, `will_post` and `held_overdue`.
