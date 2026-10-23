import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { memberId } from './identity.mjs';

// Shared with bridge/core/setup_collab.go. Created by the installation wizard, never logged.
export function loadBotCredentials(dataDir) {
  const file = join(dataDir, 'cloud-web-bot-tokens.json');
  let stat;
  try { stat = lstatSync(file); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw Error('cannot inspect collab credentials file');
  }
  if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
    throw Error('collab credentials must be a regular private file (chmod 600)');
  }
  let tokens;
  try { tokens = JSON.parse(readFileSync(file, 'utf8')); } catch {
    throw Error('invalid collab credentials JSON file');
  }
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw Error('invalid collab credentials JSON object');
  for (const [id, secret] of Object.entries(tokens)) {
    memberId(id);
    if (typeof secret !== 'string' || !secret.trim()) throw Error('invalid collab bot secret');
  }
  return tokens;
}
