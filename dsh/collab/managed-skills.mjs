import { join } from 'node:path';
import { dataDirCandidates } from './memory-sources.mjs';

/** Add the role view to this Agent's scope, preserving its preset and global skills. */
export function mountManagedSkills(agentCtx, member, filesystem, dataDir = dataDirCandidates()[0]) {
  // Mount through Cordis so the provider's skills injection and teardown apply.
  return agentCtx.plugin(filesystem, {
    providerName: 'bothouse-managed',
    includeDefaultRoots: false,
    customSkillDirs: [join(dataDir, 'skills', 'views', member.id)],
  });
}
