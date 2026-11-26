'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {DatabaseSync, backup} = require('node:sqlite');
const {SocialStore} = require('../server/store.cjs');

function prepareRestoredDatabase(file) {
  const store = new SocialStore(file);
  try {
    store.transaction(() => {
      store.run('DELETE FROM sessions');
      store.run('DELETE FROM bothouse_pair_codes');
      store.run('DELETE FROM bothouse_links');
      // Other role preferences cascade from these same legacy rows.
      store.run('DELETE FROM ai_friend_preferences');
      store.run("UPDATE requests SET state='declined' WHERE state='pending' AND sender IN (SELECT number FROM users WHERE kind='ai')");
      store.run(`INSERT INTO ai_direct_permissions(chat,enabled,revision,context_floor)
        SELECT g.chat,0,coalesce(p.revision,0)+1,coalesce(p.context_floor,0)
        FROM ai_direct_grants g LEFT JOIN ai_direct_permissions p ON p.chat=g.chat
        WHERE coalesce(p.enabled,1)=1
        ON CONFLICT(chat) DO UPDATE SET enabled=0,revision=excluded.revision`);
      store.run("UPDATE ai_direct_turns SET state='failed' WHERE state='pending'");
      store.run('UPDATE ai_direct_proactive SET enabled=0,revision=revision+1 WHERE enabled=1');
      store.run("UPDATE ai_proactive_turns SET state='failed' WHERE state='pending'");
      store.run("UPDATE ai_appointments SET state='cancelled',revision=revision+1 WHERE state='pending'");
      store.run('DELETE FROM ai_appointment_drafts');
      store.run('DELETE FROM ai_group_role_consents');
      store.run('DELETE FROM ai_voice_choices');
      store.run('DELETE FROM ai_voice_preferences');
      store.run('DELETE FROM ai_voice_scopes');
      store.run('DELETE FROM personal_voice_defaults WHERE enabled=1');
      store.run('DELETE FROM personal_voice_offers');
      store.run('DELETE FROM ai_group_cards');
      store.run('DELETE FROM personal_ai_public_profiles');
      store.run('DELETE FROM personal_ai_private_profiles');
      store.run('DELETE FROM personal_ai_direct_context');
      store.run('DELETE FROM personal_ai_friend_settings');
      store.run('DELETE FROM ai_group_lorebooks');
      store.run('DELETE FROM ai_group_draw_settings');
      store.run('INSERT OR IGNORE INTO ai_group_draw_pauses SELECT chat,ai FROM ai_group_roles');
      store.run('DELETE FROM image_ai_permissions');
      store.run("UPDATE ai_image_turns SET state='failed' WHERE state='pending'");
      store.run('UPDATE ai_web_search_settings SET enabled=0,revision=revision+1 WHERE enabled=1');
      store.run('INSERT OR IGNORE INTO ai_web_search_settings SELECT DISTINCT chat,0,1 FROM ai_group_roles');
      store.run("UPDATE ai_group_turns SET state='failed' WHERE state='pending'");
      store.run('DELETE FROM ai_feed_follows');
      store.run("UPDATE ai_feed_turns SET state='failed' WHERE state='pending'");
    });
  } finally {
    store.db.close();
  }
}

async function makeBackup(source, destinationDirectory, {prepareRestore=false} = {}) {
  const sourcePath = fs.realpathSync(source);
  if (!fs.statSync(sourcePath).isFile()) throw new Error('Backup source is not a file');

  // Claim a fresh, private directory before SQLite can open its destination.
  fs.mkdirSync(destinationDirectory, {mode: 0o700});
  const destination = path.join(destinationDirectory, 'social.sqlite');
  const partial = path.join(destinationDirectory, 'social.sqlite.partial');
  const db = new DatabaseSync(sourcePath, {readOnly: true, timeout: 5000});
  try {
    await backup(db, partial);
  } finally {
    db.close();
  }
  const snapshot = new DatabaseSync(partial);
  try {
    const result = snapshot.prepare('PRAGMA quick_check').get();
    const tables = snapshot.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name IN ('users','chats','messages','sessions')"
    ).get();
    if (result.quick_check !== 'ok' || tables.count !== 4) {
      throw new Error('Invalid social database backup');
    }
  } finally {
    snapshot.close();
  }
  if (prepareRestore) prepareRestoredDatabase(partial);
  const ready = new DatabaseSync(partial);
  try {
    // Make the checked copy a self-contained file before publishing it.
    if (ready.prepare('PRAGMA journal_mode=DELETE').get().journal_mode !== 'delete') {
      throw new Error('Could not finalize the social database snapshot');
    }
  } finally {
    ready.close();
  }
  fs.renameSync(partial, destination);
  return destination;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const prepareRestore = args[0] === '--prepare-restore';
  const [source, destination, ...extra] = prepareRestore ? args.slice(1) : args;
  if (!source || !destination || extra.length) {
    console.error('Usage: node backup.cjs [--prepare-restore] INPUT_SQLITE NEW_OUTPUT_DIRECTORY');
    process.exitCode = 1;
  } else {
    makeBackup(source, destination, {prepareRestore}).then(file => console.log(file)).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {makeBackup};
