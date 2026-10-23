// The transport model and mention completion have no runtime DSH dependencies. Run its regressions
// directly in CoNest; the package tsconfig targets the separate DSH checkout.
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  oxc: { tsconfig: false },
  test: {
    include: [
      'dsh/packages/client-ui-discord/tests/*.client.spec.{ts,tsx}',
    ],
  },
};
