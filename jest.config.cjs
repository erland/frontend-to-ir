/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.ts',
    '<rootDir>/src/**/__tests__/**/*.spec.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true
};
