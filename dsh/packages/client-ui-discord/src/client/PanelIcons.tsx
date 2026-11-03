/** Decorative occupants for the desk, wiki galaxy and usage sidebar entries (#105). */
import { IconChecklistOutlineRegular, IconGaugeOutlineRegular, IconSparkleRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

type IconProps = PropsRuntime<'sidebar.panellist'>

/** Team desk glyph; the sidebar owns the label. */
export function DeskIcon({ size }: IconProps) {
  return <IconChecklistOutlineRegular size={size} />
}

/** Wiki galaxy glyph. */
export function GalaxyIcon({ size }: IconProps) {
  return <IconSparkleRegular size={size} />
}

/** Token usage glyph. */
export function UsageIcon({ size }: IconProps) {
  return <IconGaugeOutlineRegular size={size} />
}
