import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/dist-ssr/**',
    '**/node_modules/**',
    '**/.tmp/**',
    '**/coverage/**',
    'infra/local/data/**',
    'test-results/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'apps/admin-web/src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    files: [
      'apps/api/src/**/*.ts',
      'apps/admin-api/src/**/*.ts',
      'apps/worker/src/**/*.ts',
      'packages/**/*.ts',
      'server/**/*.ts',
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
])
