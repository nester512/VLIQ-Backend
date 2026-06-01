import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/api/generated/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Allow useRef variables that appear to be "unused" but are bound via JSX ref={}
      // props — the TS-ESLint no-unused-vars rule doesn't count ref={x} as a "use"
      // in some versions, producing false positives on ref declarations.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: 'Ref$', ignoreRestSiblings: true },
      ],
    },
  },
])
