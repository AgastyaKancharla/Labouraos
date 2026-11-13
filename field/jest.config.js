/**
 * Two projects: the phone (iOS preset) and the installed web app (web
 * preset). Files ending in .web.test.ts(x) run only in the web project;
 * every other test runs as the phone app.
 */
const shared = {
  testTimeout: 20000,
  setupFiles: ['<rootDir>/src/test/setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dist-root/'],
};

module.exports = {
  // CI machines are slower than a laptop on the first render of a file.
  testTimeout: 20000,
  projects: [
    {
      ...shared,
      displayName: 'phone',
      preset: 'jest-expo/ios',
      testMatch: ['<rootDir>/**/*.test.ts?(x)'],
      testPathIgnorePatterns: [...shared.testPathIgnorePatterns, '\\.web\\.test\\.tsx?$', '<rootDir>/scripts/'],
    },
    {
      ...shared,
      displayName: 'web',
      preset: 'jest-expo/web',
      testMatch: ['<rootDir>/**/*.web.test.ts?(x)'],
    },
    {
      displayName: 'scripts',
      testTimeout: 20000,
      testEnvironment: 'node',
      testMatch: ['<rootDir>/scripts/**/*.test.js'],
    },
  ],
};
