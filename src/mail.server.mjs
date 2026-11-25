import { createMailSender } from './modules/mail/index.mjs'

const disabledSender = Object.freeze({
 async send() {
  return { status: 'rejected', provider: 'none', providerMessageId: null, code: 'mail_off' }
 },
})

export function operatorMail(env) {
 if (env.RER_DEMO === '1' || env.AUTH_LOCAL === 'true') {
  return createMailSender({ provider: 'development', mode: 'development' })
 }
 if (env.MAIL_PROVIDER === 'none') return disabledSender
 if (!env.MAIL_PROVIDER || env.MAIL_PROVIDER === 'development') return undefined
 return {
  async send(message) {
   return createMailSender({ provider: env.MAIL_PROVIDER, mode: 'production', apiKey: env.MAIL_API_KEY, ...(env.MAIL_PROVIDER === 'cloudflare' ? { accountId: env.MAIL_ACCOUNT_ID } : {}) }).send(message)
  },
 }
}
