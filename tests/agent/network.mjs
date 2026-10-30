// The conformance journey's network edge: the company's AI provider, answering
// OpenAI-compatible chat completions with a JSON draft and its usage and cost.
// It runs in isolated workerd with no other network.
const ORIGIN = 'https://ai.synthetic-stump.example'

export default {
  async fetch(request) {
    const url = new URL(request.url)
    if (url.origin !== ORIGIN || request.method !== 'POST' || url.pathname !== '/v1/chat/completions') return new Response('Not declared', { status: 404 })
    const body = await request.json()
    const brief = JSON.parse(body.messages.at(-1).content)
    const text = brief.format === 'thread' ? null : `Synthetic draft for a ${brief.format} with ${Object.keys(brief).length} fields.`
    const content = JSON.stringify(brief.format === 'thread' ? { parts: ['Synthetic part one.', 'Synthetic part two.'] } : brief.format === 'pitch' ? { subject: 'Synthetic subject', text } : { text })
    return Response.json({ id: 'synthetic-stump-completion', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, cost: 0.00042 } })
  },
}
