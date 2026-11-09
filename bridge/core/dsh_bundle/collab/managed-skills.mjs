import { join } from 'node:path';
import { dataDirCandidates } from './memory-sources.mjs';

/** Add the role view to this Agent's scope, preserving its preset and global skills. */
export function mountManagedSkills(agentCtx, member, filesystem, dataDir = dataDirCandidates()[0]) {
  filesystem.apply(agentCtx, {
    providerName: 'bothouse-managed',
    includeDefaultRoots: false,
    customSkillDirs: [join(dataDir, 'skills', 'views', member.id)],
  });
}
