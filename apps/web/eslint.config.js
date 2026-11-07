// @ts-check
import eslint from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'src/api/schema.gen.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  jsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['eslint.config.js'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Event handlers may return promises (react-hook-form handleSubmit).
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Never inject HTML; render text through React (security review, web section).',
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  { files: ['eslint.config.js'], ...tseslint.configs.disableTypeChecked },
  {
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
