Stump drafts with your company's own AI provider and model, with your key. Nothing is drafted through anyone else's account.

## Set your provider

An owner or admin opens **Settings › Connections › AI provider** and enters:

- **Provider address**: any OpenAI-compatible API, such as `https://api.openai.com/v1`, `https://openrouter.ai/api/v1`, a Cloudflare AI Gateway address, or a server on this computer (`http://127.0.0.1:PORT/v1`). It must be https, or plain http on this computer.
- **Model**: the model's exact id, such as `gpt-4.1-mini`.
- **Key**: the provider's API key. Stump seals it and never shows it again; the screen shows its last four characters.

The same setting works locally and once deployed, and an agent can read or change it through `stump.setup.ai` (reading it is standard work; changing it is a security change under your company's policy). **Remove** takes the provider out; drafts from a source then stop until a new one is set.

### A model on your own computer

Any OpenAI-compatible server on this computer works, with no account anywhere. With [Ollama](https://ollama.com):

1. Install it and fetch a model: `ollama pull llama3.2`.
2. In **Settings › Connections › AI provider**, enter the address `http://127.0.0.1:11434/v1`, the model `llama3.2` and, as the key, any word such as `ollama`: a server on your own computer ignores it, but the field takes one.
3. In **Compose**, paste a changelog link under **From a source**, pick the accounts and choose **Draft from source**.

LM Studio's server works the same way at `http://127.0.0.1:1234/v1`. A small local model writes plainer drafts than a hosted one; every draft still goes through the claim check.

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

With no provider set, Compose says so as soon as you put a link under **From a source** with no text of your own, with a link to **Settings › Connections**, before you press anything. A post you write yourself needs no provider. An agent or a hand-off that asks for an AI draft while no provider is set is refused at once with the same reason, before any approval is asked for. When a request fails, the draft is not written, and Compose shows why: no provider set yet, a key the provider refused, a limit or an outage, with the provider's own message where it gave one. Stump never fills in generic copy instead. A draft that fails the claim check or the venue check stays a draft, with its flags.

## Where AI text is banned

A venue whose rules ban AI-written text gets a brief and facts, and no request is made to the provider. See [Hand-offs](/docs/handoffs).
