/** Decorative occupants for the desk, bothouse panel and other-computers sidebar entries (#105). */
import { IconChecklistOutlineRegular, IconGaugeOutlineRegular, IconLinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

type IconProps = PropsRuntime<'sidebar.panellist'>

/** Team desk glyph; the sidebar owns the label. */
export function DeskIcon({ size }: IconProps) {
  return <IconChecklistOutlineRegular size={size} />
}

/** bothouse management panel glyph. */
export function PanelIcon({ size }: IconProps) {
  return <IconGaugeOutlineRegular size={size} />
}

/** Other computers (#131): pair with another DSH by a one-time number. */
export function DevicesIcon({ size }: IconProps) {
  return <IconLinkOutlineRegular size={size} />
}
