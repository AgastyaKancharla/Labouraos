// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-root/*', '.expo/*', 'node_modules/*', 'coverage/*'],
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.test.js', 'src/test/**'],
    languageOptions: {
      globals: { jest: 'readonly', describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' },
    },
    rules: {
      // jest.mock factories must use require().
      '@typescript-eslint/no-require-imports': 'off',
      'react/display-name': 'off',
    },
  },
  {
    files: ['scripts/**/*.js', '*.config.js', 'public/**/*.js'],
    languageOptions: {
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly', process: 'readonly', self: 'readonly', caches: 'readonly', console: 'readonly' },
    },
  },
]);
