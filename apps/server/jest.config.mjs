export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
  globalSetup: '<rootDir>/tests/global-setup.ts',
  testTimeout: 30000,
};
