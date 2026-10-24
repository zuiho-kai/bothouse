// Default value for the login page "Server URL" field.
// A value the user saved on a previous login wins; otherwise use the address
// this page was opened from, so a Tailscale IP or a phone shows its own host
// instead of localhost.
export function initialServerUrl(): string {
  const saved = localStorage.getItem('cc_server_url');
  if (saved) return saved;
  return typeof window !== 'undefined' ? window.location.origin : '';
}
