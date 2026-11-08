// Where to land after login. `next` comes from the URL the bridge prints (or from the path
// ProtectedRoute remembers), so only a same-site absolute path is allowed: an absolute URL or a
// protocol-relative `//host` would send the browser off-site right after a login.
export function sameSitePath(next: string | null | undefined): string {
  if (!next) return '/';
  if (!next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}