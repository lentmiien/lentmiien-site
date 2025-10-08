module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  collectCoverageFrom: ['services/**/*.js', '!services/**/__mocks__/**'],
  coverageDirectory: 'coverage',
  clearMocks: true
};
