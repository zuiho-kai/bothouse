// The transport model and mention completion have no runtime DSH dependencies. Run its regressions
// directly in CoNest; the package tsconfig targets the separate DSH checkout.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// CI installs dsh/package.json into a temp dir (ci.yml "Channel client regressions"), outside the
// spec's node_modules lookup path. Resolve the React test deps next to the vitest that runs us;
// without such an install (local dsh/node_modules), fall back to normal resolution.
const fromVitest = createRequire(process.argv[1] ?? import.meta.url);
const alias = [];
for (const name of ['react-dom', 'react', '@testing-library/react', '@testing-library/dom']) {
  try {
    const dir = dirname(fromVitest.resolve(`${name}/package.json`));
    alias.push({ find: new RegExp(`^${name.replace('/', '\\/')}(?=/|$)`), replacement: dir });
  } catch {}
}

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  oxc: { tsconfig: false },
  resolve: { alias },
  test: {
    include: [
      'dsh/packages/client-ui-discord/tests/channel-source.client.spec.ts',
      'dsh/packages/client-ui-discord/tests/mention-complete.client.spec.ts',
      'dsh/packages/client-ui-discord/tests/task-board.client.spec.ts',
      'dsh/packages/client-ui-discord/tests/channels-page.client.spec.tsx',
    ],
  },
};
