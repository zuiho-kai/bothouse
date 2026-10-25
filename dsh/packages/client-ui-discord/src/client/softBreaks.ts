import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-math'
import { mathCompatibility } from './mathCompatibility.ts'

interface Node {
  type: string
  children?: Node[]
  position?: { start: { offset?: number }, end: { offset?: number } }
}

/**
 * Turns each soft line break in a paragraph into a markdown hard break (two trailing spaces), so
 * a message reads line by line as typed — the same rule as remark-breaks. The text is parsed with
 * MarkdownText's own settled grammar (GFM + math), so only line endings inside paragraph text
 * change; code, math, tables, HTML, inline code and existing hard breaks keep their bytes.
 */
export function softBreaksToHard(text: string): string {
  const source = text.replace(/\r\n/g, '\n')
  const tree = fromMarkdown(source, {
    extensions: [gfm(), mathCompatibility(), math()],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  }) as Node
  const breaks: number[] = []
  const visit = (node: Node, inParagraph: boolean) => {
    if (inParagraph && node.type === 'text') {
      const start = node.position?.start.offset
      const end = node.position?.end.offset
      if (start === undefined || end === undefined) return
      for (let i = source.indexOf('\n', start); i !== -1 && i < end; i = source.indexOf('\n', i + 1)) breaks.push(i)
      return
    }
    for (const child of node.children ?? []) visit(child, inParagraph || node.type === 'paragraph')
  }
  visit(tree, false)
  let out = source
  for (let k = breaks.length - 1; k >= 0; k--) out = out.slice(0, breaks[k]) + '  ' + out.slice(breaks[k])
  return out
}
