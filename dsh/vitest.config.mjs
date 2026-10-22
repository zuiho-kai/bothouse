// The transport model and mention completion have no runtime DSH dependencies. Run its regressions
// directly in CoNest; the package tsconfig targets the separate DSH checkout.
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  oxc: { tsconfig: false },
  test: {
    // Every channel client spec runs here; a new spec needs no edit to this list.
    include: ['dsh/packages/client-ui-discord/tests/*.client.spec.{ts,tsx}'],
  },
};
