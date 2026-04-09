const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

/**
 * Get an OAuth access token via chrome.identity.
 * On first call, Chrome shows the account picker + consent dialog.
 * Subsequent calls return a cached token.
 */
export async function getAuthToken(): Promise<string> {
  const token = await chrome.identity.getAuthToken({ interactive: true, scopes: SCOPES })
  return token.token
}

/**
 * Remove the cached token (useful after auth errors).
 */
export async function removeCachedToken(token: string): Promise<void> {
  await chrome.identity.removeCachedAuthToken({ token })
}

/**
 * Create a credential object compatible with googleapis' `auth` parameter.
 * googleapis expects an object with a `getAccessToken()` method that returns
 * `{ token: string }`.
 */
export function createCredential(token: string) {
  return {
    async getAccessToken() {
      return { token }
    },
  }
}
