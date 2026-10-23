import { defineConfig } from 'tsdown'

// Standalone build (no DSH monorepo needed). client.js is emitted as CJS and then
// wrapped by scripts/wrap-client.mjs into the window.__ModuleLoader__ format the
// DSH web frontend loads from /plugins/; style.css is inlined into that wrapper.
const external = [/^@deepseek-ai\//, 'react', 'react-dom', /^react\//]

export default defineConfig([
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib', format: 'cjs', platform: 'neutral',
    outExtensions: () => ({ js: '.js' }),
    external, dts: false, clean: true,
  },
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: 'esm', platform: 'node',
    outExtensions: () => ({ js: '.js' }),
    external, dts: false, clean: false,
  },
])
