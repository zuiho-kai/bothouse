// The transport model and mention completion have no runtime DSH dependencies. Run its regressions
// directly in CoNest; the package tsconfig targets the separate DSH checkout.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI installs dsh/package.json into a temp dir (ci.yml "Channel client regressions"), outside the
// spec's node_modules lookup path. Resolve the React test deps next to the vitest that runs us;
// without such an install (local dsh/node_modules), fall back to normal resolution.
const fromVitest = createRequire(process.argv[1] ?? import.meta.url);
const alias = [];
// softBreaks.ts parses with the same markdown packages MarkdownText uses; resolve them the same way.
const markdown = ['mdast-util-from-markdown', 'mdast-util-gfm', 'mdast-util-math', 'micromark-extension-gfm', 'micromark-extension-math', 'micromark-factory-space', 'micromark-util-character', 'micromark-util-symbol'];
for (const name of ['react-dom', 'react', '@testing-library/react', '@testing-library/dom', '@deepseek-ai/dsh-client-ui-primitives', ...markdown]) {
  // Walk the lookup paths instead of resolving "<name>/package.json": the micromark packages do not export it.
  const dir = (fromVitest.resolve.paths(name) ?? []).map(base => join(base, name)).find(d => existsSync(join(d, 'package.json')));
  if (dir) alias.push({ find: new RegExp(`^${name.replace('/', '\\/')}(?=/|$)`), replacement: dir });
}

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  oxc: { tsconfig: false },
  resolve: { alias },
  test: {
    server: { deps: { inline: [/@deepseek-ai/] } },
    // Every channel client spec runs here; a new spec needs no edit to this list.
    include: ['dsh/packages/client-ui-discord/tests/*.client.spec.{ts,tsx}'],
  },
};
