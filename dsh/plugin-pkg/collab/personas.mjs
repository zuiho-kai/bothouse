// Generated from bridge/core/persona_presets.go; verified by TestDSHPersonaCatalog.
import { readFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync(new URL('./personas.json', import.meta.url), 'utf8'));
export function personaLibrary(lang) { return catalog[lang.toLowerCase().startsWith('zh') ? 'zh' : 'en']; }
