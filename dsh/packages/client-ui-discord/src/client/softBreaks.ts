/**
 * Turns each single newline in prose into a markdown hard break (two trailing spaces), so a
 * message reads line by line as typed — the same rule as remark-breaks. Fenced and indented code
 * keep their text unchanged.
 */
export function softBreaksToHard(text: string): string {
  const lines = text.split('\n')
  let fence: string | undefined
  let indentedCode = false
  return lines.map((line, i) => {
    if (fence !== undefined) {
      if (line.trimStart().startsWith(fence) && line.trim().replace(/^[`~]+/, '') === '') fence = undefined
      return line
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (open) {
      fence = open[1]
      indentedCode = false
      return line
    }
    const previous = i > 0 ? lines[i - 1] : ''
    if (/^( {4}|\t)/.test(line) && (previous.trim() === '' || indentedCode)) {
      indentedCode = true
      return line
    }
    indentedCode = false
    const next = lines[i + 1]
    if (line.trim() === '' || next === undefined || next.trim() === '') return line
    if (line.endsWith('  ') || line.endsWith('\\')) return line
    if (/^ {0,3}(`{3,}|~{3,})/.test(next)) return line
    return line + '  '
  }).join('\n')
}
