Everyone in Stump signed in by invitation, with a role and their connection to the company. An agent acting for a person has exactly that person's role.

## Roles

| Role | Can |
| --- | --- |
| Owner | Everything, including installation settings and transferring ownership |
| Admin | Team, company accounts, network apps, integrations and settings |
| Editor | Venues, brand, claims, drafts, scheduling and publishing to accounts they may use |
| Contributor | Drafts and submissions for sign-off |
| Poster | Their own hand-offs, their own accounts and their own voice guide |
| Viewer | Read venues, calendar and ledger |

A role change applies from the person's next request.

## Inviting someone

An owner or admin invites a person by email with their name, role and connection: founder, employee, contractor, investor, advisor, friend or family. They may add the person's disclosure lines. The person joins when they sign in with that email. Nobody joins without an invitation.

The owner gives their own connection in first-run setup. An owner or admin sets or changes a teammate's connection from the ⋯ menu on their row in **Settings › Team**; the owner's own is changed only by the owner, and an admin never changes another admin's.

Names on the team follow the same rule: an owner or admin, signed in, records a person's name at the invitation and changes it afterwards (`stump.team.manage` `update` with `display_name`). Stump reads teammates' names as the team's own words when it checks a post's claims, so nobody renames themselves and no agent renames anyone, an invitation sent again included. An invited person's name counts as the team's from when they sign in.

Until they sign in, an invited person holds nothing: a hand-off, a draft in their voice or a voice guide for them is refused with "<name> has not accepted their invitation yet".

### On your own computer

Mail is not sent locally, and Stump says so when you invite someone: "<name> is invited", not that an invitation was sent. They sign in from this computer instead: open `/signin` in a browser that has opened the `RER_OPEN` link, and choose **Sign in as <name>** beside them. That accepts their invitation and opens Stump with their role. `rer dev --as person@example.com` starts the app signed in as them. Once deployed with mail, they use the sign-in link Stump emails them.

## The owner

The owner cannot be removed or demoted until ownership is transferred to someone else, and the transfer is recorded. Nobody can widen their own access.

## When someone leaves

Removing a person lists their open hand-offs and the posts that go back to draft, so nothing is lost.
