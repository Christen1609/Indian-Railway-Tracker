import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'fixtures/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'No default exports. Use a named export.',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    ignores: ['packages/core/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'packages/core is pure. Network calls live in apps/ingest.' },
        { name: 'process', message: 'packages/core is pure. Read config in apps/ingest.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'packages/core is pure. Pass now in.' },
        { object: 'Math', property: 'random', message: 'packages/core is pure. No randomness.' },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['**/*.config.js', '**/*.config.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
