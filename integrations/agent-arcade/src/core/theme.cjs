'use strict';
const STATES = ['idle','running','waiting','error','done','unknown','ended'];
function validateTheme(t) {
  if (!t || t.version !== 1 || typeof t.name !== 'string' || t.name.length > 50 || !t.name.trim()) throw Error('Theme needs version 1 and a name (1–50 characters).');
  const color = c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
  for (const k of ['sky','floor','accent','ink']) if (!color(t.colors?.[k])) throw Error(`Invalid theme color: ${k}`);
  if (!t.palette || Object.keys(t.palette).length > 20 || Object.entries(t.palette).some(([k,v]) => !/^[a-z0-9]$/.test(k) || !color(v))) throw Error('Palette must contain single-character keys and hex colors.');
  for (const s of STATES) {
    const rows = t.sprites?.[s];
    if (!Array.isArray(rows) || rows.length !== 16 || rows.some(r => typeof r !== 'string' || r.length !== 16 || [...r].some(c => c !== '.' && !Object.hasOwn(t.palette, c)))) throw Error(`Sprite ${s} must be a 16×16 grid using the palette or dots.`);
  }
  return { version: 1, name: t.name, author: typeof t.author === 'string' ? t.author.slice(0,80) : '', colors: Object.fromEntries(['sky','floor','accent','ink'].map(k=>[k,t.colors[k]])), palette: { ...t.palette }, sprites: Object.fromEntries(STATES.map(s=>[s,[...t.sprites[s]]])) };
}
module.exports = { validateTheme, STATES };
