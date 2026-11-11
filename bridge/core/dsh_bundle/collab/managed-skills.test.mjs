import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mountManagedSkills } from './managed-skills.mjs';

test('native managed skills mount from an agent scope without inherited skills injection', {
  skip: !process.env.DSH_SKILL_TEST_ENTRY,
}, async () => {
  const require = createRequire(process.env.DSH_SKILL_TEST_ENTRY);
  const load = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
  const [{ Context }, { SkillRegistry }, { createScope }, filesystem, toolPlugin] = await Promise.all([
    load('cordis'), load('dsh-skill'), load('dsh-scope'),
    load('dsh-skill-filesystem'), load('dsh-tool-skill'),
  ]);
  const root = mkdtempSync(join(process.env.DSH_SKILL_TEST_DIR ?? tmpdir(), 'bothouse-skills-inject-'));
  const skill = join(root, 'skills', 'views', 'author', 'injection-probe');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '---\nname: injection-probe\ndescription: Verify native plugin injection\n---\nINJECTION-RECEIPT');
  const ctx = new Context();
  const registry = await ctx.plugin(SkillRegistry);
  const agent = { cwd: root };
  let scope, tool;
  toolPlugin.apply({
    skills: ctx.skills,
    tools: { register: value => { tool = value; } },
    workingDirectory: { ensure: agent => agent.cwd },
    on() {},
  });
  // Like DshMembers.setup: the owning plugin does not inject the skills service.
  const fixture = ctx.plugin({
    name: 'collab-context-fixture',
    async apply(pluginCtx) {
      scope = createScope(pluginCtx, agent);
      await mountManagedSkills(scope.ctx, { id: 'author' }, filesystem, root);
    },
  });
  try {
    await fixture;
    const result = await tool.execute({ name: 'injection-probe' }, {
      agent, signal: new AbortController().signal,
    });
    assert.equal(result.provider, 'bothouse-managed');
    assert.match(result.content, /INJECTION-RECEIPT/);
  } finally {
    await scope?.dispose();
    await fixture.dispose();
    await registry.dispose();
  }
});

test('managed skills add only the selected role view without replacing default roots', () => {
  let received;
  const filesystem = {};
  const context = { plugin: (plugin, config) => { received = { plugin, config }; } };
  mountManagedSkills(context, { id: 'writer' }, filesystem, '/isolated');
  assert.equal(received.plugin, filesystem);
  assert.deepEqual(received.config, {
    providerName: 'bothouse-managed', includeDefaultRoots: false,
    customSkillDirs: [join('/isolated', 'skills', 'views', 'writer')],
  });
});

// Opt in with the installed DSH entrypoint; never boots the user's profile or a model.
test('native DSH skill tool loads enabled role views in main and git workspaces only', {
  skip: !process.env.DSH_SKILL_TEST_ENTRY,
}, async () => {
  const require = createRequire(process.env.DSH_SKILL_TEST_ENTRY);
  const load = name => import(pathToFileURL(require.resolve(`@deepseek-ai/${name}`)).href);
  const skillRequire = createRequire(require.resolve('@deepseek-ai/dsh-skill'));
  const [{ Context }, { SkillRegistry }, { createScope }, filesystem, toolPlugin] = await Promise.all([
    load('cordis'), load('dsh-skill'), import(pathToFileURL(skillRequire.resolve('@deepseek-ai/dsh-scope')).href),
    load('dsh-skill-filesystem'), load('dsh-tool-skill'),
  ]);
  const root = mkdtempSync(join(tmpdir(), 'bothouse-skills-'));
  const ctx = new Context();
  new SkillRegistry(ctx);
  const author = {}, other = {};
  const authorScope = createScope(ctx, author), otherScope = createScope(ctx, other);
  let tool;
  toolPlugin.apply({
    skills: ctx.skills,
    tools: { register: value => { tool = value; } },
    workingDirectory: { ensure: agent => agent.cwd },
    on() {},
  });
  const skill = join(root, 'skills', 'views', 'author', 'receipt-probe');
  const pending = join(root, 'skills', 'pending', 'author');
  mkdirSync(pending, { recursive: true });
  writeFileSync(join(pending, 'pending-probe.md'), '---\nname: pending-probe\ndescription: Pending\n---\nDRAFT');
  await mountManagedSkills(authorScope.ctx, { id: 'author' }, filesystem, root);
  await mountManagedSkills(otherScope.ctx, { id: 'other' }, filesystem, root);
  const signal = new AbortController().signal;
  try {
    for (const cwd of [join(root, 'main'), join(root, 'worktree')]) {
      mkdirSync(cwd, { recursive: true });
      if (cwd.endsWith('worktree')) mkdirSync(join(cwd, '.git'));
      author.cwd = other.cwd = cwd;
      await assert.rejects(tool.execute({ name: 'pending-probe' }, { agent: author, signal }), /unknown/);
      mkdirSync(skill, { recursive: true });
      writeFileSync(join(skill, 'SKILL.md'), '---\nname: receipt-probe\ndescription: Verify role skill loading\n---\nRECEIPT-1287');
      // Filesystem watchers invalidate the registry after published changes.
      let result;
      for (let attempt = 0; attempt < 30; attempt++) {
        try { result = await tool.execute({ name: 'receipt-probe' }, { agent: author, signal }); break; }
        catch (error) { if (attempt === 29) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
      }
      assert.equal(result.provider, 'bothouse-managed');
      assert.match(result.content, /RECEIPT-1287/);
      await assert.rejects(tool.execute({ name: 'receipt-probe' }, { agent: other, signal }), /unknown/);
      renameSync(skill, join(root, `retired-${cwd.endsWith('worktree') ? 'worktree' : 'main'}`));
      await assert.rejects(tool.execute({ name: 'receipt-probe' }, { agent: author, signal }));
    }
  } finally {
    await authorScope.dispose(); await otherScope.dispose();
  }
});
