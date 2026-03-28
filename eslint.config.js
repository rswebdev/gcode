import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'tests/**'] },

  // JS files
  {
    ...js.configs.recommended,
    files: ['**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_$' }],
      'no-empty':       ['error', { allowEmptyCatch: true }],
    },
  },

  // Svelte files
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2022 },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Svelte 4 event syntax (on:click etc.) is still valid in Svelte 5 compatibility mode
      'svelte/no-unused-svelte-ignore': 'warn',
    },
  },
];
