import { defineConfig } from 'tsdown'

// Standalone build (no DSH monorepo needed). client.js is emitted as CJS and then
// wrapped by scripts/wrap-client.mjs into the window.__ModuleLoader__ format the
// DSH web frontend loads from /plugins/; style.css is inlined into that wrapper.
const external = [/^@deepseek-ai\//, 'react', 'react-dom', /^react\//]

// Lightning CSS's default [hash] includes the absolute file path, so the same source
// produced different class names (and byte sizes) in different worktrees. There is one
// CSS module in this package; a fixed prefix keeps scoped names stable and readable.
const css = { modules: { generateScopedName: 'dshc_[local]' } }

export default defineConfig([
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib', format: 'cjs', platform: 'neutral',
    outExtensions: () => ({ js: '.js' }),
    external, dts: false, clean: true,
    css,
  },
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib', format: 'esm', platform: 'node',
    outExtensions: () => ({ js: '.js' }),
    external, dts: false, clean: false,
    css,
  },
])
