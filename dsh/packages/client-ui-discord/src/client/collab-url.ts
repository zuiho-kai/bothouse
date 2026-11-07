/**
 * #236: which DSH a channels panel talks to. The local panel uses the collab paths as they are
 * (`collab/api/…`, relative to document.baseURI); a panel opened from 其他电脑 on a paired
 * computer sends the same paths through this DSH's forwarder `collab/remote/<link>/…`
 * (dsh/collab/pairing.mjs remoteProxyRoute), so mentions, avatars, replies, attachments and the
 * task board all read and write the other computer and never this one.
 */
import { createContext, useContext } from 'react'
import type { ChannelTransport } from './channel-source.ts'

/** Maps a `collab/…` path to the URL this panel should use. */
export type CollabUrl = (path: string) => string

/** Local panel: paths stay as they are. */
export const localCollabUrl: CollabUrl = path => path

/** A paired link id, as dsh/collab/pairing.mjs PairClient issues them (randomUUID). */
const LINK_ID = /^[0-9a-f-]{36}$/

/**
 * Paths of a paired computer, through this DSH's remote forwarder.
 * @param linkId - link id from `GET collab/api/remote/links`.
 * @returns the path mapper; non-collab paths (http links) are left alone.
 */
export function remoteCollabUrl(linkId: string): CollabUrl {
  if (!LINK_ID.test(linkId)) throw new Error(`bad remote link id: ${linkId}`)
  const mount = `collab/remote/${linkId}/`
  return path => path.startsWith('collab/') ? mount + path.slice('collab/'.length) : path
}

/**
 * Same transport with its paths sent to a paired computer.
 * @param base - transport bound to this page (browserTransport).
 * @param map - path mapper from remoteCollabUrl.
 * @returns the remote transport.
 */
export function mappedTransport(base: ChannelTransport, map: CollabUrl): ChannelTransport {
  return { ...base, url: path => base.url(map(path)) }
}

/** The mapper of the panel a component renders in; the local panel when none is provided. */
export const CollabUrlContext = createContext<CollabUrl>(localCollabUrl)

/** Read the mapper of the surrounding channels panel. */
export const useCollabUrl = (): CollabUrl => useContext(CollabUrlContext)
