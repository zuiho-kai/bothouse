/**
 * Rewrite only the identity references in a persona text. Replacing every
 * occurrence also changes ordinary prose such as 橘色长发, 女仆长制服 or
 * 一只渡鸦 when the persona name happens to be a common word.
 */
export function renamePersonaIdentity(text: string, oldName: string, newName: string): string {
  if (!oldName || oldName === newName) return text
  let out = text
  for (const [from, to] of [
    [`「${oldName}」`, `「${newName}」`],
    [`"${oldName}"`, `"${newName}"`],
    [`“${oldName}”`, `“${newName}”`],
    [`# 角色：${oldName}`, `# 角色：${newName}`],
    [`# Character: ${oldName}`, `# Character: ${newName}`],
  ] as const) out = out.split(from).join(to)
  return out
}
