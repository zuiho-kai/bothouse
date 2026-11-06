/**
 * Main panel that shows one of the collab host's own pages (team desk, wiki galaxy)
 * inside the DSH shell, so the desktop app — which has no address bar — can open them
 * from the sidebar. The page is same-origin, so it uses the shell's sign-in.
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import styles from './PanelPages.module.css'

/** What the slot injects: the collab page path, relative to the shell's base URL. */
export interface EmbedInjected {
  path: string
  title: string
}

export type EmbedPageProps = PropsRuntime<'main'> & InjectFace<EmbedInjected> & PropsLocale<typeof NS>

/**
 * Fill the main area with the collab page.
 * @param props - injected page path and title.
 * @returns the framed page.
 */
export function EmbedPage({ path, title }: EmbedPageProps) {
  // Relative to document.baseURI so the panel proxy's /dsh/ prefix is kept.
  const src = new URL(path, document.baseURI).toString()
  return (
    <div className={styles.embed}>
      <EmbedFrame src={src} title={title} />
    </div>
  )
}

/**
 * The frame both the panel and the delivery card (#1023) use. `sandboxed` is for pages the
 * owner did not write (a bot's delivery): scripts run, but a page from this origin gets an
 * opaque origin so it cannot act with the owner's sign-in.
 */
export function EmbedFrame({ src, title, sandboxed = false, sameOrigin = false }: {
  readonly src: string
  readonly title: string
  readonly sandboxed?: boolean
  readonly sameOrigin?: boolean
}) {
  const sandbox = !sandboxed ? undefined
    : sameOrigin ? 'allow-scripts allow-forms allow-popups allow-modals'
      : 'allow-scripts allow-forms allow-popups allow-modals allow-same-origin'
  // Trusted pages need a same-origin Referer for the proxy's port-less Origin check.
  // Delivery pages remain private and sandboxed.
  return <iframe className={styles.frame} src={src} title={title} sandbox={sandbox} loading="lazy" referrerPolicy={sandboxed ? 'no-referrer' : 'same-origin'} />
}
