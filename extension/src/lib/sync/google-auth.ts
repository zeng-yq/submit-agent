const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

const KEY_SERVICE_ACCOUNT = 'submitAgent_serviceAccount'
const KEY_ACCESS_TOKEN = 'submitAgent_saAccessToken'
const KEY_EXPIRES_AT = 'submitAgent_saExpiresAt'

interface ServiceAccountKey {
  client_email: string
  private_key: string
  project_id?: string
}

interface StoredTokens {
  accessToken: string
  expiresAt: number
}

// --- JWT helpers ---

function base64url(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str))
}

async function createJwt(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: sa.client_email,
    scope: SCOPES.join(' '),
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600,
  }

  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const unsigned = `${headerB64}.${payloadB64}`

  // Import the PEM private key for signing
  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '')
  const pemBuffer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  )

  return `${unsigned}.${base64url(new Uint8Array(signature))}`
}

// --- Token management ---

const DEFAULT_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'gen-lang-client-0494109016',
  private_key_id: '50997eaa610be9dabca72a375b5eaef41968ae3b',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDbRlvK495g7oU1\nLGmRvADjeGziBZ1yKAKfxEdf5b1ZS1JKBf16f26ekTdO+00xBG69ys0toVHb0aH7\ng77kjWenDZJeouvU4Td9jPR7eTCi/NjTMw7C6JtXrbcm9RRF9ld87EWZqKV9EBw5\nHWGWdw5TZoszRar3qLexbVot50+k/qYSFvK2KK/mwwpwAv1eh2vpO9M05ADdn0Xj\n6A0IqNVP9KN18hLct+IB57QsXF4DTU+96OrsWX4GvWDbDIjlvQVOSozV18jEM10d\nETVc8+d1b705gJb5galoUA7I6LMwFAA44mVeyGH//uQLDoNmN5jz6gniLSCorsSu\nEYlQzjTTAgMBAAECggEACWAjRElk9JZjlLKe8EUZG/YbYGNRaD76Cb8YjCr5uHaG\nK2Br26UqONZzBnSr8sNtQWkz8lZaS9X/9o3wshCyagv5rQPgpdwGsDQVhK1ZsoZc\nIP+nCxdrWPQ2XLs65YOTGbt30wpJH8/6B5560eD/ovpDS8BtVHnezNPPo3R8oncl\nRctKurXYZxIbVxgCOxatCD7UfSE+2wLr9gPvrJdPK8Jw8FJOelFYyYjsvHvpp7Y3\n8NaGpi5+kToPC0OqJJlxXqt537mcNhTMCkkkHbZcXPiNuJU7+0kZ3fxyr/yI9mbq\n7zXMBxOYvm2637l/WaJ67HdqKxJTSGWW10OiA4kP4QKBgQD87PJ01cZ7tH07sa+3\ntsaMGTRpCBhFJ5YBaqebc+AdOvfTZH6Q23VFsDoJTxYsG9fosnH7Q4JjmaixOloM\n9KiQ2FWnR8rI+Vs4Ut+tLBKRMYpieepi4DfhAEfLXOgj0itkv9awBDuFKfUDYUWo\nD0SI+nWCuIb2L3P+V+zFlQrNcwKBgQDd8LJ9evwZ5Jo3Fhace2heLtcv1NesCPLX\ndYAOn3WPOTdHZzqkAleRUjzUtu+a/BoPp+M2Lx+K4fYxhjrj0mvnB0pnV0CyxoEJ\nwWv6xGEvd/4j/1AcY7zCDI3jjDsvnULSq/jKdCZIvh7U8W+ne2Lk8yLD/jlnBgYV\n0OaKKaEjIQKBgQDkJiULSS7ytbvl1gGIucHd7Hp/aALklrHUc03fhyYZl/CnalZU\n+vGNPEsNzJ5WiYM4b4crvRjoGVq3C8jhOOy5Q7v32mXM5knnw7Hq9v+Eo2iOLiVE\nrbcaKnOYuSTZ8yKbjgTt39OE6nUOaHc6AxOycCMCGMv9VI7QVqXJEQmeiwKBgHSu\ncbiEqvuV8vnZFAQq4UD60UklVkns3ncmIDAP54dn5kcU34CQdqdBHBgdITVTKwRm\nGI9JEQU8LOn2jwltfCsW6ygPeEVFFVwio3lQO2Pwat1UAjMawIcogIRMGmW7AQGv\nRfpyPBpsUdtUH4Zm2SRTK0jtZBJk2Vgo3rtujXfhAoGBAMsplu7vW2Ta5xAp1XUF\nWwlvoh8vEHnoTSir5FdR4UflE1iTZPygUUCVZ+D1tDhn5yRnVweQ2cqsWpDm3mcv\nKbXH3cMLEsIROPxlRm5MTZ9PojEqsLc004c0zrNG4FlNG3uQpLuHurW3DvZitC9g\nuW/6ayWnLTpxGXKrYVmW2ZTu\n-----END PRIVATE KEY-----\n',
  client_email: 'backlink@gen-lang-client-0494109016.iam.gserviceaccount.com',
  client_id: '114535932967242989757',
  auth_uri: 'https://accounts.google.com/o/oauth2/auth',
  token_uri: 'https://oauth2.googleapis.com/token',
  auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
  client_x509_cert_url:
    'https://www.googleapis.com/robot/v1/metadata/x509/backlink%40gen-lang-client-0494109016.iam.gserviceaccount.com',
  universe_domain: 'googleapis.com',
}, null, 2)

const DEFAULT_SERVICE_ACCOUNT: ServiceAccountKey = JSON.parse(DEFAULT_SERVICE_ACCOUNT_JSON)

export async function getServiceAccountJson(): Promise<string> {
  const result = await chrome.storage.local.get(KEY_SERVICE_ACCOUNT)
  const raw = result[KEY_SERVICE_ACCOUNT] as string | null
  if (raw) return raw
  return DEFAULT_SERVICE_ACCOUNT_JSON
}

async function getServiceAccountKey(): Promise<ServiceAccountKey | null> {
  const result = await chrome.storage.local.get(KEY_SERVICE_ACCOUNT)
  const raw = result[KEY_SERVICE_ACCOUNT] as string | null
  if (!raw) return DEFAULT_SERVICE_ACCOUNT
  try {
    const parsed = JSON.parse(raw)
    if (parsed.client_email && parsed.private_key) {
      return parsed
    }
  } catch {
    // Invalid JSON, clear it
    await chrome.storage.local.remove(KEY_SERVICE_ACCOUNT)
  }
  return null
}

async function getStoredTokens(): Promise<StoredTokens | null> {
  const result = await chrome.storage.local.get([KEY_ACCESS_TOKEN, KEY_EXPIRES_AT])
  const accessToken = result[KEY_ACCESS_TOKEN] as string | null
  const expiresAt = result[KEY_EXPIRES_AT] as number | null
  if (accessToken && expiresAt) return { accessToken, expiresAt }
  return null
}

async function storeTokens(accessToken: string, expiresIn: number): Promise<void> {
  await chrome.storage.local.set({
    [KEY_ACCESS_TOKEN]: accessToken,
    [KEY_EXPIRES_AT]: Date.now() + expiresIn * 1000,
  })
}

async function clearStoredTokens(): Promise<void> {
  await chrome.storage.local.remove([KEY_ACCESS_TOKEN, KEY_EXPIRES_AT])
}

async function fetchNewToken(sa: ServiceAccountKey): Promise<string> {
  const jwt = await createJwt(sa)
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token request failed: ${body}`)
  }
  const data = await res.json()
  return data
}

// --- Public API ---

/**
 * Get an access token for Google Sheets API using service account credentials.
 * Tokens are cached and auto-refreshed.
 */
export async function getAuthToken(): Promise<string> {
  const sa = await getServiceAccountKey()
  if (!sa) {
    throw new Error('Service account not configured')
  }

  // Check cached token (with 60s safety buffer)
  const stored = await getStoredTokens()
  if (stored && Date.now() < stored.expiresAt - 60_000) {
    return stored.accessToken
  }

  // Fetch new token
  const data = await fetchNewToken(sa)
  await storeTokens(data.access_token, data.expires_in)
  return data.access_token
}

/**
 * Remove cached tokens, forcing re-authentication on next use.
 */
export async function removeCachedToken(_token?: string): Promise<void> {
  await clearStoredTokens()
}

/**
 * Check if a service account is configured.
 */
export async function isOAuthConfigured(): Promise<boolean> {
  const sa = await getServiceAccountKey()
  return !!sa
}

/**
 * Get the service account email (for sharing Google Sheets).
 */
export async function getServiceAccountEmail(): Promise<string> {
  const sa = await getServiceAccountKey()
  return sa?.client_email ?? ''
}

/**
 * Parse and store the service account JSON key.
 * Returns the client_email if valid, or throws on invalid input.
 */
export async function setServiceAccountKey(jsonStr: string): Promise<string> {
  const parsed = JSON.parse(jsonStr)
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid service account key: missing client_email or private_key')
  }
  await chrome.storage.local.set({ [KEY_SERVICE_ACCOUNT]: jsonStr })
  await clearStoredTokens()
  return parsed.client_email
}

/**
 * Clear the stored service account key and tokens.
 */
export async function clearServiceAccountKey(): Promise<void> {
  await chrome.storage.local.remove(KEY_SERVICE_ACCOUNT)
  await clearStoredTokens()
}
