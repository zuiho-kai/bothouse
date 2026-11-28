#!/usr/bin/env node
// #321: manage external chat bot members (AstrBot, MaiBot…) of the channel host running on this machine.
//
//   node external-member.mjs add <name> --room <channel id> [--mention-id <digits>]
//   node external-member.mjs list
//   node external-member.mjs rotate <member id>     new credential, the old one stops working
//   node external-member.mjs remove <member id>     the member is gone and its credential with it
//
// It reaches the host the way a second DSH on this machine does (local-host.mjs): the address and the
// local token are in <data dir>/collab.owner.json. The data directory is $CONEST_COLLAB_DATA, else
// ~/.conest-collab (the plugin's default); --data-dir <path> names another one.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OWNER_FILE } from './instance-lock.mjs';
import { WS_PATH } from './cloudweb.mjs';

function usage() {
  console.error('usage: external-member.mjs add <name> --room <channel id> [--mention-id <digits>] | list | rotate <member id> | remove <member id>   [--data-dir <path>]');
  process.exit(2);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const dataDir = flag('--data-dir') ?? (process.env.CONEST_COLLAB_DATA || join(homedir(), '.conest-collab'));
const room = flag('--room');
const mentionId = flag('--mention-id');
const [command, target] = args;

let local;
try {
  local = JSON.parse(readFileSync(join(dataDir, OWNER_FILE), 'utf8')).local;
} catch { /* reported below */ }
if (local?.origin === undefined) {
  console.error(`no channel host is running on ${dataDir} (start DSH with the bothouse plugin first)`);
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(local.origin + path, {
    method,
    headers: { 'x-collab-local': local.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`failed (${res.status}): ${data.error ?? res.statusText}`);
    process.exit(1);
  }
  return data;
}

function showCredential({ member, credential }) {
  console.log(`member:     ${member.name} (id ${member.id}), channel ${member.rooms[0]}`);
  console.log(`connect to: ${local.origin.replace(/^http/, 'ws')}${WS_PATH}`);
  console.log(`credential: ${credential}`);
  console.log('Send it as "Authorization: Bearer <credential>". It is shown only this once; keep it secret.');
}

if (command === 'add' && target && room) {
  showCredential(await call('POST', '/collab/api/members', { type: 'external', name: target, rooms: [Number(room)], ...(mentionId ? { mentionId } : {}) }));
} else if (command === 'list') {
  const state = await call('GET', '/collab/api/state');
  console.log('channels: ' + state.rooms.filter(r => r.kind === 'chat').map(r => `${r.id} ${r.name}`).join(', '));
  const members = state.members.filter(m => m.external);
  for (const m of members) console.log(`${m.id}\t${m.name}\tchannel ${m.rooms[0]}\t${m.online ? 'online' : 'offline'}`);
  if (!members.length) console.log('no external members');
} else if (command === 'rotate' && target) {
  showCredential(await call('POST', `/collab/api/members/${encodeURIComponent(target)}/credential`));
} else if (command === 'remove' && target) {
  await call('DELETE', `/collab/api/members/${encodeURIComponent(target)}`);
  console.log(`removed ${target}`);
} else {
  usage();
}
