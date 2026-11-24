'use strict';
const fs = require('node:fs');
const {databasePath} = require('./config.cjs');
const {SocialStore,fail} = require('./store.cjs');
function moderate(store,command,id) {
  if (command === 'list') return store.all(`SELECT r.id,r.reporter,r.reason,r.created,m.sender,m.body AS reportedText
    FROM reports r JOIN messages m ON m.id=r.message WHERE r.status='open' ORDER BY r.created,r.id LIMIT 100`);
  if (!id || !['remove','dismiss'].includes(command)) throw new Error('Use list | remove REPORT_ID | dismiss REPORT_ID');
  return store.transaction(() => {
    const r = store.one('SELECT * FROM reports WHERE id=?',id);
    if (!r) fail(404,'report','Unknown report');
    if (r.status !== 'open') return {id,status:r.status};
    const reviewed = new Date().toISOString();
    if (command === 'remove') {
      store.run('UPDATE messages SET removed=1 WHERE id=?',r.message);
      store.run("UPDATE reports SET status='removed',reviewed=? WHERE message=? AND status='open'",reviewed,r.message);
    } else store.run("UPDATE reports SET status='dismissed',reviewed=? WHERE id=?",reviewed,id);
    return {id,status:command === 'remove' ? 'removed' : 'dismissed'};
  });
}
if (require.main === module) {
  const file = databasePath();
  if (!fs.existsSync(file)) throw new Error('No database at SOCIAL_DB');
  const store = new SocialStore(file);
  try { console.log(JSON.stringify(moderate(store,...process.argv.slice(2)),null,2)); }
  finally { store.db.close(); }
}
module.exports = {moderate};
