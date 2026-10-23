import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    // Match the existing TS compiler policy; wizard API payloads use any.
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'react-hooks/rules-of-hooks': 'error',
    },
  },
  {
    // Introduce dependency checking on the wizard and edited layout components.
    // Other pages have pre-existing dependency warnings to migrate separately.
    files: ['src/pages/Setup/**', 'src/components/Layout/Header.tsx', 'src/components/Layout/Layout.tsx'],
    rules: { 'react-hooks/exhaustive-deps': 'error' },
  },
);
