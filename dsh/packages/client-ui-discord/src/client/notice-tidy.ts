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
 *
 * #1620 rework (lead 11-14 on the joint-job walk shots):
 * - the 【交接】 row of a job called to several members carries what the member is told (shared
 *   directory, how to hand back) — half a screen for two rows. The page shows one line, who does
 *   which part and who shares the workspace; the whole note folds under it;
 * - a hand-back that writes 「做了什么：」 on two lines reads as one part: the repeated label is dropped.
 */

export interface TidyNotice { readonly text: string; readonly detail?: { readonly summary: string; readonly body: string } }

// 来源：Fable 清单第 33 条「同一件活的整句标题被重复五六遍」；任务卡里的标题本身就截在两行内，这里取同样一眼读完的长度。
const TITLE_KEEP = 18

const EMPTY_PART = /^(要你做的|我加的)[：:]\s*(无|没有|暂无|无需|不用)?[。.]?\s*$/
const ACCEPT_HOW = /^验收 #\d+：回复里单独一行写/
const DETAIL_HEAD = /^📬 细节「(.*?)」（来自 (.+?)，想看再展开，不用回）$/

// #1616 返工（用户 11-14「📬 标题截断成『fib....』四个点，统一成一个省略号」）：截在 fib.py 这类英文词中间时，
// 词不超过 WORD_REACH 个字就留整，再去掉结尾的点、逗号、空格，最后只加一个省略号。
const WORD_REACH = 8
const ASCII_WORD = /[A-Za-z0-9_.\-/]/
const CUT_TAIL = /[\s.。,，、:：;；…·-]+$/u

/** A quoted title longer than TITLE_KEEP keeps its start and one ellipsis. */
export function clipTitles(text: string): string {
  return text.replace(/「([^「」\n]+)」/g, (whole, title: string) => {
    const chars = [...title.replace(/(\.{3}|…)+$/u, '')]
    if (chars.length <= TITLE_KEEP + 2 && chars.length === [...title].length) return whole
    if (chars.length <= TITLE_KEEP + 2) return `「${chars.join('').replace(CUT_TAIL, '')}…」`
    let end = TITLE_KEEP
    while (end < chars.length && end < TITLE_KEEP + WORD_REACH && ASCII_WORD.test(chars[end]!) && ASCII_WORD.test(chars[end - 1]!)) end++
    if (end < chars.length && ASCII_WORD.test(chars[end]!) && ASCII_WORD.test(chars[end - 1]!)) end = TITLE_KEEP
    return `「${chars.slice(0, end).join('').replace(CUT_TAIL, '')}…」`
  })
}

const PART_LABEL = /^(背景|做了什么|要你做的|我加的)[：:][ \t]*/
const HANDOFF_HEAD = /^【交接】([^：:\n]{1,24})[：:](.*)$/
// tasks.mjs jointNote: 「同一件活 小蓝 也在这个工作区」 / 「同一件活还 @ 了 小橙，她接了也进这个工作区」
const JOINT_MATES = /同一件活(?:还 @ 了 (.+?)，她接了也进| (.+?) 也在)这个工作区/
// One line on the page: the member's own clause of the job, cut like a title.
const CLAUSE_KEEP = 28

/** 「做了什么：a」「做了什么：b」 → 「做了什么：a」「b」: a part's label once. */
function onceEachLabel(lines: string[]): string[] {
  const seen = new Set<string>()
  return lines.map(line => {
    const m = PART_LABEL.exec(line.trim())
    if (m === null) return line
    if (!seen.has(m[1]!)) { seen.add(m[1]!); return line }
    return line.trim().slice(m[0].length)
  })
}

/** The 【交接】 row of a joint job: one line (whose part, who shares the workspace), the note folded. */
function jointHandoff(lines: string[]): TidyNotice | undefined {
  const head = HANDOFF_HEAD.exec(lines[0]?.trim() ?? '')
  const mates = JOINT_MATES.exec(lines.join('\n'))
  if (head === null || mates === null) return undefined
  const name = head[1]!.trim()
  const clauses = head[2]!.split(/[；;。]/).map(c => c.replace(/^.*?一起做一件活[：:]/, '').trim()).filter(Boolean)
  const own = clauses.find(c => c.startsWith(name)) ?? clauses[0] ?? ''
  const chars = [...own]
  const part = chars.length <= CLAUSE_KEEP ? own : `${chars.slice(0, CLAUSE_KEEP).join('').replace(CUT_TAIL, '')}…`
  return { text: '', detail: { summary: `【交接】${name}：${part}（和 ${(mates[1] ?? mates[2])!.trim()} 同一工作区）`, body: lines.join('\n') } }
}

export function tidyNotice(text: string): TidyNotice {
  const joint = jointHandoff(text.split('\n'))
  if (joint !== undefined) return joint
  // #1616 返工（用户「两份汇报块之间空了一大片」）：删掉的行留下的空行不连成一片，头尾不留空行。
  const lines = onceEachLabel(text.split('\n')).filter(line => !ACCEPT_HOW.test(line.trim()) && !EMPTY_PART.test(line.trim()))
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && all[i - 1]!.trim() !== ''))
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
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
