// Stump's words on Base's shared sign-in page (SPEC §4.2 Sign-in): the button reads
// "Email me a sign-in link", and after a send the card reads "Check your email" with
// the address in place of the form. The address travels in a short-lived HttpOnly
// cookie scoped to /signin, never in the URL. Base's page and its handlers stay unedited.

const SENT_COOKIE = 'stump_signin_sent'
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const address = (value: string) => {
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@<>"'`]+@[^\s@<>"'`]+$/.test(email) ? email : null
}
const formPost = (request: Request) => request.method === 'POST' && /^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(request.headers.get('content-type') ?? '')

/** The address a sign-in form posts, read from a copy of the request before Base reads it. */
export async function postedAddress(request: Request): Promise<string | null> {
  if (new URL(request.url).pathname !== '/auth/magic-link' || !formPost(request)) return null
  try { return address(String((await request.clone().formData()).get('email') ?? '')) } catch { return null }
}

/** After a send that lands on the sent notice, remember the address for the next page only. */
export function rememberSent(response: Response | null, email: string | null, request: Request): Response | null {
  const location = response?.headers.get('location') ?? ''
  if (!response || !email || response.status !== 303 || !/^\/signin\?(.*&)?notice=sent(&|$)/.test(location)) return response
  const headers = new Headers(response.headers)
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  headers.append('set-cookie', `${SENT_COOKIE}=${encodeURIComponent(email)}; Path=/signin; Max-Age=600; HttpOnly; SameSite=Lax${secure}`)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function sentAddress(request: Request): string | null {
  const cookie = (request.headers.get('cookie') ?? '').split(/;\s*/).find(part => part.startsWith(`${SENT_COOKIE}=`))
  if (!cookie) return null
  try { return address(decodeURIComponent(cookie.slice(SENT_COOKIE.length + 1))) } catch { return null }
}

/** Base's sign-in page in Stump's words; the sent state replaces the form with "Check your email". */
export async function stumpSignIn(request: Request, page: Response): Promise<Response> {
  if (request.method !== 'GET' || !page.headers.get('content-type')?.startsWith('text/html')) return page
  let html = (await page.text()).replace('>Email a sign-in link</button>', '>Email me a sign-in link</button>')
  const headers = new Headers(page.headers)
  headers.delete('content-length')
  if (new URL(request.url).searchParams.get('notice') === 'sent') {
    const email = sentAddress(request)
    const line = email
      ? `<p class="sent">A sign-in link is on its way to <strong>${escape(email)}</strong> if it can sign in here. Open it on this device and press Confirm.</p>`
      : '<p class="sent">If your address can sign in here, a sign-in link is on its way. Open it on this device and press Confirm.</p>'
    html = html.replace(/<h1>[^<]*<\/h1>/, '<h1>Check your email</h1>')
      .replace(/<p class="notice" role="status">[\s\S]*?<\/p>/, '')
      .replace(/<form method="post" action="\/auth\/magic-link">[\s\S]*?<\/form>/, `${line}<p class="secondary-link"><a href="/signin">Use another email</a></p>`)
    headers.append('set-cookie', `${SENT_COOKIE}=; Path=/signin; Max-Age=0; HttpOnly; SameSite=Lax`)
  }
  return new Response(html, { status: page.status, statusText: page.statusText, headers })
}
