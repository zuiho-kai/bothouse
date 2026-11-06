/**
 * #236: a paired computer's channels, opened from 其他电脑. It is the same ChannelsPage as the local
 * one (mention list, avatar menu, hover reply/copy/task tools), with every collab path sent through
 * this DSH's forwarder to that computer (collab-url.ts), under a bar naming the computer.
 */
import type { CSSProperties } from 'react'
import { ChannelsPage, type ChannelsPageProps } from './ChannelsPage.tsx'
import { CollabUrlContext, type CollabUrl } from './collab-url.ts'
import styles from './PanelPages.module.css'

export interface RemoteChannelsInjected {
  /** Name of the paired computer, as the 其他电脑 page shows it. */
  readonly remoteName: string
  readonly collabUrl: CollabUrl
  /** Back to the 其他电脑 page. */
  readonly back: () => void
}

export type RemoteChannelsPageProps = ChannelsPageProps & RemoteChannelsInjected

// The bar already clears the frame top; the page under it starts right below.
const BELOW_BAR = { '--dsh-frame-top-clearance': '0px' } as CSSProperties

export function RemoteChannelsPage(props: RemoteChannelsPageProps) {
  const { remoteName, collabUrl, back, t } = props
  return (
    <CollabUrlContext.Provider value={collabUrl}>
      <div className={styles.remote}>
        <div className={styles.remoteBar} role="status">
          <span className={styles.remoteName}>{t('remoteViewing', { name: remoteName })}</span>
          <button type="button" className={styles.remoteBack} onClick={back}>{t('remoteBack')}</button>
        </div>
        <div className={styles.remoteBody} style={BELOW_BAR}>
          <ChannelsPage {...props} />
        </div>
      </div>
    </CollabUrlContext.Provider>
  )
}
