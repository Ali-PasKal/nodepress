// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/generated/**',
    '**/playwright-report/**',
    '**/test-results/**',
    '**/node_modules/**',
  ]),

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Template literals with numbers are common and safe (e.g. `${ms}ms`).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Floating promises hide failures; always handle or explicitly void them.
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },

  // Packages must never depend on applications (one-way dependency rule).
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@nexora/api', '@nexora/admin', '**/apps/**'],
              message: 'packages/* must not import from apps/*.',
            },
          ],
        },
      ],
    },
  },

  // NestJS API: classes with decorators and DI metadata.
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Nest modules are classes that only carry decorator metadata.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },

  // React (admin app and UI package).
  {
    files: ['apps/admin/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
    },
  },

  // CLI is a Node program that legitimately writes to stdout.
  {
    files: ['packages/cli/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
      // node:test's describe/it return promises that the runner itself awaits.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            { from: 'package', package: 'node:test', name: ['describe', 'it', 'test'] },
          ],
        },
      ],
    },
  },

  // Tests: relax rules that fight common testing idioms.
  {
    files: ['**/*.test.{ts,tsx}', '**/test/**/*.ts', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Plain JS config files are not part of a TS project.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Static scripts served to the browser as-is (no bundling).
  {
    files: ['apps/admin/public/**/*.js'],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
  },
);
