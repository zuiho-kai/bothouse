// Where the panel is mounted. index.html carries <base href="/">; a proxy that mounts the
// panel under a sub-path (the DSH sidebar's "bothouse" entry, /collab/panel/) rewrites it,
// so every absolute URL the page builds goes through withBase().

/** Mount path without a trailing slash: '' at the root, e.g. '/collab/panel' under a proxy. */
export const BASE_PATH: string = typeof document === 'undefined'
  ? ''
  : new URL(document.baseURI).pathname.replace(/\/+$/, '');

/**
 * Prefix an absolute path with the mount path.
 * @param path - path starting with '/'.
 * @returns the path the browser should request.
 */
export function withBase(path: string): string {
  return `${BASE_PATH}${path}`;
}

/**
 * True when the page is served by a proxy that signs API calls itself (it adds
 * <meta name="bothouse-auth" content="proxy">); the page then needs no token of its own.
 */
export function proxySignsRequests(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('meta[name="bothouse-auth"]')?.getAttribute('content') === 'proxy';
}
