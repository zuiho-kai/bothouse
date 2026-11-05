// #1044: team desk, bothouse panel and other computers used to sit in the DSH sidebar. They are
// separate rows on the Plugins page now and start off. Someone who had them keeps them: the first
// start of this version on an existing install switches on, once, exactly the pages the old version
// showed, through DSH's own plugin manager (the same call as the row switch on the Plugins page).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PAGE_ROWS = ['bothouse-desk', 'bothouse-panel', 'bothouse-devices'];
// What bothouse-dsh on npm showed before: 0.1.47 and 0.1.48 had desk and panel, no version had
// other computers (0.1.46 and older had channels only, but cannot be told apart after the upgrade).
export const NPM_PAGES_BEFORE = ['bothouse-desk', 'bothouse-panel'];
// Bridge install (conest-channels-ui) and npm install (bothouse-channels).
const BRIDGE_CHANNELS = 'conest-channels-ui';
const NPM_CHANNELS = 'bothouse-channels';

/**
 * Switch on the pages this install showed before, then record that it ran.
 * @param {{ listPlugins(): Promise<any[]>, setPluginEnabled(id: string, enabled: boolean): Promise<unknown> } | undefined} manager
 * @param {{ markerFile: string, beforeFile: string, existed: boolean, logger?: { info: Function } }} opts
 *   existed — the collab database was there before this start (an install from before #1044).
 *   beforeFile — the bridge writes the rows its old channels UI showed (bridge core/setup_dsh_embed.go).
 * @returns {Promise<string>} 'done-before' | 'fresh' | 'no-manager' | 'channels-off' | 'enabled'
 */
export async function migratePageRows(manager, { markerFile, beforeFile, existed, logger }) {
  if (existsSync(markerFile)) return 'done-before';
  const mark = (outcome) => {
    mkdirSync(dirname(markerFile), { recursive: true });
    writeFileSync(markerFile, `${outcome} ${new Date().toISOString()}\n`);
    return outcome;
  };
  if (!existed) return mark('fresh');
  // No plugin manager (not a base-backed profile): try again next start.
  if (!manager) return 'no-manager';
  const rows = await manager.listPlugins();
  const channels = rows.find(row => row.patchId === BRIDGE_CHANNELS || row.patchId === NPM_CHANNELS);
  // Channels off before = no page showed before (they all came with the channels UI).
  if (channels && channels.enabled === false) return mark('channels-off');
  let before = [];
  if (existsSync(beforeFile)) before = JSON.parse(readFileSync(beforeFile, 'utf8')).rows ?? [];
  else if (channels?.patchId === NPM_CHANNELS) before = NPM_PAGES_BEFORE;
  const on = [];
  for (const id of PAGE_ROWS.filter(id => before.includes(id))) {
    const row = rows.find(r => r.patchId === id);
    if (!row || row.enabled || !row.entryId || row.readOnlyReason) continue;
    await manager.setPluginEnabled(row.entryId, true);
    on.push(id);
  }
  logger?.info('conest-collab: kept the pages this install had: %s', on.join(', ') || 'none');
  return mark('enabled');
}
