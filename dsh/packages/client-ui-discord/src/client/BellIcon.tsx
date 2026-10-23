/**
 * Bell icon indicating notification toggle state (#145).
 */
export function BellIcon({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20 18.69L7.84 6.53 4.27 2.96 3 4.23l2.84 2.84C5.33 8.16 5 9.54 5 11v5l-2 2v1h15.46l2.31 2.31 1.27-1.27L20 18.69zM7 17v-6c0-.77.16-1.51.44-2.18l8.18 8.18H7zm5 5c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6.5-6.32V11c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68c-.76.18-1.46.49-2.09.89l1.45 1.45C11 7.02 11.48 7 12 7c2.49 0 4.5 2.01 4.5 4.5v3.88l2 2z" />
    </svg>
  )
}
