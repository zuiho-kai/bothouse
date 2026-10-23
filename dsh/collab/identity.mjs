// Identity rules shared by configuration, persistent roster and transport.
// Slug/credential validation adapted in parts from the read-only reference
// bothouse-55-review-fixes (c29f648 + local identity.mjs); no UI changes imported.
import { CollabError } from './store.mjs';

export const RESERVED_IDS = new Set(['owner', 'user', 'system']);

export function memberId(id) {
  // 来源：existing overlay identity contract, maximum 32 ASCII characters.
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id) || RESERVED_IDS.has(id)) {
    throw new CollabError('bad-member-id', 'invalid or reserved member id');
  }
  return id;
}

export function validateCredentials(tokens, shared = '', dshIds = new Set()) {
  const ids = new Set();
  for (const [secret, id] of tokens) {
    memberId(id);
    if (typeof secret !== 'string' || !secret || secret === shared || ids.has(id)) {
      throw new CollabError('invalid', 'duplicate or ambiguous bot credential');
    }
    if (dshIds.has(id)) throw new CollabError('invalid', 'bot identity collision');
    ids.add(id);
  }
}
