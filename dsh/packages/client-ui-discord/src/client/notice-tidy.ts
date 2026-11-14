/**
 * #1616 (user 11-14「dsh页面太乱」; Fable's list items 33, 48–52): how a system notice and a
 * member's hand-back read on the page. The stored text is unchanged — the lead and the bridge
 * read it as it is — only the page shows it shorter:
 * - a task title quoted 「…」 in a notice is cut to its start (the task card above shows it whole),
 *   instead of the same long sentence five or six times down the log;
 * - the line telling the lead how to accept (验收 #N：回复里单独一行写…) is not for the person;
 * - 「要你做的：无」「我加的：无」 say nothing;
 * - a 📬 细节 post folds under one line (its own header says 想看再展开);
 * - a member's 「[report] #N 」 marker is for the bridge, the page shows what follows it.
 */

export interface TidyNotice { readonly text: string; readonly detail?: { readonly summary: string; readonly body: string } }

// 来源：Fable 清单第 33 条「同一件活的整句标题被重复五六遍」；任务卡里的标题本身就截在两行内，这里取同样一眼读完的长度。
const TITLE_KEEP = 18

const EMPTY_PART = /^(要你做的|我加的)[：:]\s*(无|没有|暂无|无需|不用)?[。.]?\s*$/
const ACCEPT_HOW = /^验收 #\d+：回复里单独一行写/
const DETAIL_HEAD = /^📬 细节「(.*?)」（来自 (.+?)，想看再展开，不用回）$/

/** A quoted title longer than TITLE_KEEP keeps its start and an ellipsis. */
export function clipTitles(text: string): string {
  return text.replace(/「([^「」\n]+)」/g, (whole, title: string) => [...title].length > TITLE_KEEP + 2 ? `「${[...title].slice(0, TITLE_KEEP).join('')}…」` : whole)
}

export function tidyNotice(text: string): TidyNotice {
  const lines = text.split('\n').filter(line => !ACCEPT_HOW.test(line.trim()) && !EMPTY_PART.test(line.trim()))
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  const head = DETAIL_HEAD.exec(lines[0]?.trim() ?? '')
  if (head !== null) return { text: '', detail: { summary: clipTitles(`📬 细节「${head[1]}」· ${head[2]}`), body: lines.slice(1).join('\n') } }
  return { text: clipTitles(lines.join('\n')) }
}

/** A member's hand-back without its leading [report] / [ask] marker and task number. */
export function withoutExitMark(text: string): string {
  return text.replace(/^[ \t]*\[(report|ask)\]([ \t]*#\d+)?[ \t]*/gim, '')
}

/** A member's message carrying a hand-back: a line opening with [report] or [ask]. */
export const hasExitMark = (text: string): boolean => /^[ \t]*\[(report|ask)\]/im.test(text)
