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
      <iframe className={styles.frame} src={src} title={title} />
    </div>
  )
}
