// #1044: team desk, bothouse panel and other computers used to sit in the DSH sidebar for everyone.
// They are separate rows on the Plugins page now and start off. Someone who had them before keeps
// them: the first start of this version on an existing install switches the three rows on, once,
// through DSH's own plugin manager (the same call as the row switch on the Plugins page).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const PAGE_ROWS = ['bothouse-desk', 'bothouse-panel', 'bothouse-devices'];
// Bridge install (conest-channels-ui) and npm install (bothouse-channels).
const CHANNEL_ROWS = ['conest-channels-ui', 'bothouse-channels'];

/**
 * Switch the page rows on for an install that had them, then record that it ran.
 * @param {{ listPlugins(): Promise<any[]>, setPluginEnabled(id: string, enabled: boolean): Promise<unknown> } | undefined} manager
 * @param {{ markerFile: string, existed: boolean, logger?: { info: Function, warn: Function } }} opts
 *   existed — the collab database was there before this start (an install from before #1044).
 * @returns {Promise<string>} what happened: 'done-before' | 'fresh' | 'no-manager' | 'channels-off' | 'enabled'
 */
export async function migratePageRows(manager, { markerFile, existed, logger }) {
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
  // Channels off before = no page showed before (they all came with the channels UI).
  const channels = rows.find(row => CHANNEL_ROWS.includes(row.patchId));
  if (channels && channels.enabled === false) return mark('channels-off');
  const on = [];
  for (const id of PAGE_ROWS) {
    const row = rows.find(r => r.patchId === id);
    if (!row || row.enabled || !row.entryId || row.readOnlyReason) continue;
    await manager.setPluginEnabled(row.entryId, true);
    on.push(id);
  }
  logger?.info('conest-collab: kept the pages this install had: %s', on.join(', ') || 'none');
  return mark('enabled');
}
