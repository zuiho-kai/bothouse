const BACKENDS: Record<string, string> = {
  claudecode: 'Claude Code', codex: 'Codex', gemini: 'Gemini', opencode: 'OpenCode', dsh: 'DSH',
  antigravity: 'Antigravity', cursor: 'Cursor', iflow: 'iFlow', qoder: 'Qoder', copilot: 'Copilot',
};
export const backendLabel = (backend: string) => BACKENDS[backend] || backend;
export function nextRoleName(backend: string, used: readonly string[]) {
  const base = backendLabel(backend);
  const taken = new Set(used.map(n => n.toLocaleLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLocaleLowerCase()); n++) name = `${base}-${n}`;
  return name;
}
export function roleLabel(name: string, backend: string) {
  const label = backendLabel(backend);
  return !label || name === label ? name : `${name}·${label}`;
}
export function personaWithName(text: string, presetName: string, name: string) {
  if (!presetName || presetName === name) return text;
  let out = text;
  for (const [from, to] of [
    [`「${presetName}」`, `「${name}」`],
    [`"${presetName}"`, `"${name}"`],
    [`“${presetName}”`, `“${name}”`],
    [`# 角色：${presetName}`, `# 角色：${name}`],
    [`# Character: ${presetName}`, `# Character: ${name}`],
  ]) out = out.split(from).join(to);
  return out;
}
