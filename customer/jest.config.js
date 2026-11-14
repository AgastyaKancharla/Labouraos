/**
 * The phone app (iOS preset; the screens are the same on Android).
 * Native modules are replaced with small fakes in src/test/setup.ts.
 */
module.exports = {
  preset: 'jest-expo/ios',
  testTimeout: 20000,
  setupFiles: ['<rootDir>/src/test/setup-env.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: ['<rootDir>/**/*.test.ts?(x)'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
