/**
 * QQ bridge client: the channels panel's view of the relay config and process.
 * All requests stay on the page's own origin, so the owner session cookies apply.
 */

/** State of the QQ relay as the panel needs it. */
export interface QqStatus {
  readonly configured: boolean
  readonly appId: string
  readonly appSecretMasked: string
  readonly roomId: number
  readonly botName: string
  readonly defaultMember: string
  readonly mirror: boolean
  readonly allowSenders: readonly string[]
  readonly running: boolean
  readonly pid: number | null
  readonly startedAt: number | null
  readonly exitCode: number | null
  readonly lastError: string | null
  readonly log: readonly string[]
}

/** What the form sends back; an empty appSecret keeps the stored one. */
export interface QqInput {
  readonly appId: string
  readonly appSecret?: string
  readonly roomId: number
  readonly defaultMember?: string
  readonly mirror?: boolean
}

/** Error with the server's own message, shown verbatim in the panel. */
export class QqError extends Error {}

function endpoint(path: string): string {
  return new URL(`collab/api/qq${path}`, document.baseURI).toString()
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), { credentials: 'same-origin', ...init })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new QqError(body.error ?? response.statusText)
  return body as T
}

const jsonBody = (value: unknown): RequestInit => ({
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
})

/** The four operations the panel needs. */
export const qqApi = {
  /** Current config (secret masked) and process state. */
  get: (): Promise<QqStatus> => call<QqStatus>(''),
  /** Persist the form; the server validates AppID, AppSecret and the room. */
  save: (input: QqInput): Promise<QqStatus> => call<QqStatus>('', jsonBody(input)),
  /** Start or restart the relay with the saved config. */
  start: (): Promise<QqStatus> => call<QqStatus>('/start', { method: 'POST' }),
  /** Stop the relay. */
  stop: (): Promise<QqStatus> => call<QqStatus>('/stop', { method: 'POST' }),
  /** Ask QQ whether these credentials mint an access token. */
  test: (input: { appId: string; appSecret?: string }): Promise<{ ok: boolean; expiresIn: number | null }> =>
    call<{ ok: boolean; expiresIn: number | null }>('/test', jsonBody(input)),
}
