Stump drafts with your company's own AI provider and model, with your key. Nothing is drafted through anyone else's account.

## Set your provider

An owner or admin opens **Settings › Connections › AI provider** and enters:

- **Provider address**: any OpenAI-compatible API, such as `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, a Cloudflare AI Gateway address, or a server on this computer (`http://127.0.0.1:PORT/v1`). It must be https, or plain http on this computer.
- **Model**: the model's exact id, such as `gpt-4.1-mini`.
- **Key**: the provider's API key. Stump seals it and never shows it again; the screen shows its last four characters.

The same setting works locally and once deployed, and an agent can read or change it through `stump.setup.ai` (reading it is standard work; changing it is a security change under your company's policy). **Remove** takes the provider out; drafts from a source then stop until a new one is set.

### Through the installation's settings instead

An installation can also set the provider before anyone signs in, through Base's AI settings:

| Setting | Value |
| --- | --- |
| `AI_ENABLED` | `true` |
| `AI_BASE_URL` | the provider address |
| `AI_MODEL` | the model id |
| `AI_API_KEY` | the key |

Locally, put them in the checkout's private `.dev.vars` file and start `rer dev` again. For a deployed Stump, set them as secrets in the environment you deploy from; `rer deploy` uploads them (`rer deploy --dry-run` lists them as optional). A provider saved in Settings is used instead of these, and Settings says which one applies.

`rer dev --models live --models-service URL` is a different path: it links a capped dev app on a Just Every Models service for local testing, with the key piped on stdin. It is not needed for your own provider.

## What a request sends

Only what the draft needs: the source, the person's voice guide, the claims and the venue's rules.

## Cost

Each request records its model and its cost in US dollars on the draft.

## When the provider fails

The draft is not written, and Compose shows why: no provider set yet, a key the provider refused, a limit or an outage, with the provider's own message where it gave one. Stump never fills in generic copy instead. A draft that fails the claim check or the venue check stays a draft, with its flags.

## Where AI text is banned

A venue whose rules ban AI-written text gets a brief and facts, and no request is made to the provider. See [Hand-offs](/docs/handoffs).
