module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  moduleDirectories: ['node_modules', '<rootDir>'],
  collectCoverageFrom: [
    'setup.js',
    'services/templateService.js',
    'services/budgetService.js',
    'utils/startupChecks.js',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: {
      statements: 50,
      branches: 35,
      functions: 50,
      lines: 50,
    },
    './setup.js': {
      statements: 35,
      branches: 25,
      functions: 40,
      lines: 35,
    },
    './services/templateService.js': {
      statements: 70,
      branches: 50,
      functions: 80,
      lines: 70,
    },
    './services/budgetService.js': {
      statements: 70,
      branches: 35,
      functions: 65,
      lines: 70,
    },
    './utils/startupChecks.js': {
      statements: 70,
      branches: 40,
      functions: 80,
      lines: 70,
    },
  },
  clearMocks: true,
};
