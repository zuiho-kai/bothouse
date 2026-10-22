// The transport model and mention completion have no runtime DSH dependencies. Run its regressions
// directly in CoNest; the package tsconfig targets the separate DSH checkout.
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  oxc: { tsconfig: false },
  test: {
    include: [
      'dsh/packages/client-ui-discord/tests/channel-source.client.spec.ts',
      'dsh/packages/client-ui-discord/tests/mention-complete.client.spec.ts',
      'dsh/packages/client-ui-discord/tests/channels-page.client.spec.tsx',
    ],
  },
};
