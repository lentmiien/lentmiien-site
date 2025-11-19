# Testing Strategy Guide

This document explains the recommended approach to ensure robust, scalable, and maintainable testing for your NodeJS Express server projects.

## Philosophy and strategy:

- **Core Service Logic (Priority 1)**: Fully and robustly tested (automatic unit tests).
- **Express API endpoints (Priority 2)**: Integration tests to validate endpoint correctness.
- **Frontend/browser (Priority 3 - "good enough")**: Manual testing where appropriate, optionally automated later if complexity grows.

## Project Structure for testing

```
project-root/
├── src/
│   ├── services/  <-- Business logic, tested with robust unit tests.
│   ├── routes/    <-- Express route handlers, integration tested moderately.
│   └── controllers/ (Optional: If you separate route logic out)
├── tests/
│   ├── unit/          <-- Service classes tests
│   └── integration/   <-- Express APIs test
├── package.json
├── jest.config.js
└── testing-guide.md
```

---

### Recommended Testing Libraries

- **Jest** – Simple and flexible testing library (unit and integration tests).
```bash
npm install --save-dev jest
```

- **Supertest** – Integration testing HTTP endpoints.
```bash
npm install --save-dev supertest
```

Optionally add types, if TypeScript is used:
```bash
npm install --save-dev @types/jest @types/supertest ts-jest
```

---

## Writing Service Class Tests (Unit Tests):

Your service classes should expose simple, testable methods. Example:

```js
// Example service class (services/userService.js)
class UserService {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async getUserById(userId) {
    if (!userId) throw new Error("User ID is required");
    const user = await this.userRepository.findById(userId);
    if (!user) throw new Error("User not found");
    return user;
  }
}

module.exports = UserService;
```

Simple Jest unit test example (tests/unit/userService.test.js):

```js
const UserService = require('../../src/services/userService');

describe('UserService', () => {
  // Mock userRepository
  const mockUserRepo = {
    findById: jest.fn()
  };

  const userService = new UserService(mockUserRepo);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('getUserById returns user', async () => {
    const fakeUser = { id: 1, name: 'John' };
    mockUserRepo.findById.mockResolvedValue(fakeUser);

    const user = await userService.getUserById(1);
    
    expect(mockUserRepo.findById).toHaveBeenCalledWith(1);
    expect(user).toEqual(fakeUser);
  });

  test('getUserById throws if no id provided', async () => {
    await expect(userService.getUserById(null))
      .rejects
      .toThrow('User ID is required');
  });

  test('getUserById throws user not found error', async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    await expect(userService.getUserById(2))
      .rejects
      .toThrow('User not found');
  });
});
```

---

## Writing Integration Tests for Your API (Supertest):

Example integration test (tests/integration/userRoutes.test.js):

```js
const request = require('supertest');
const app = require('../../src/app'); // import your express app

describe('GET /api/users/:id', () => {
  test('should respond with user info', async () => {
    const response = await request(app).get('/api/users/1');
    expect(response.statusCode).toBe(200);
    expect(response.body).toHaveProperty('name');
  });

  test('should return 404 for non-existent user', async () => {
    const response = await request(app).get('/api/users/99999');
    expect(response.statusCode).toBe(404);
  });
});
```

---

## Running All Tests Before Every Deployment:

Make sure your `package.json` has the following script:

```json
"scripts": {
  "test": "jest --coverage"
}
```

Then before every deployment or merging code into your `main` branch (production), run:

```bash
npm test
```

To get a neat coverage summary and guarantee robust tested code.

### Coverage Expectations & Reports

- Coverage is collected for the critical files (`setup.js`, `services/templateService.js`, `services/budgetService.js`, `utils/startupChecks.js`). CI fails if any of them dip below their floor: global averages must stay ≥50% statements/lines/functions and ≥35% branches, while each target has its own guard (template/budget/startup checks at 70/70/80/50+, setup currently 35/35/40/25 while we continue to raise diagnostics coverage).
- `npm test` already runs with coverage enabled; inspect the detailed HTML/LCOV output under `coverage/` or open the text summary in the console.
- For a compact run while iterating on a single suite you can execute `npm test -- --coverage --coverageReporters=text-summary` to avoid generating the full HTML assets.

### Targeted Suites

- Run an individual service suite with `npm test -- tests/unit/templateService.test.js` or `npm test -- tests/unit/budgetService.test.js`.
- Startup/diagnostic helpers (directory prep, retries, Dropbox readiness) live in `tests/unit/setup.test.js`. Execute `npm test -- tests/unit/setup.test.js` before editing `setup.js` so you immediately see regressions.
- When debugging flakier logic, pair a targeted run with `--runInBand` to keep execution serial: `npm test -- tests/unit/setup.test.js --runInBand`.

---

## Browser-side Testing (user side):

- Manual testing may be sufficient for simpler frontend applications.
- Optionally, use [Cypress](https://www.cypress.io/) for automated E2E browser testing if complexity increases. Cypress setup (optional):

```bash
npm install --save-dev cypress
```

But this is optional—measure your cost-benefit for frontend complexity/need. Simple projects may find manual tests adequate.

---

## Checklist Before Merging `dev` → `main`:

Always:

- [ ] Run all unit tests (`npm test`)
- [ ] Run integration tests (`npm test`)
- [ ] Review manual frontend testing or E2E tests
- [ ] Confirm coverage level (ideally > 80-90%, easy to maintain with Jest)

Your goal: Keep internal business logic coverage close to 100%. API endpoints moderately/highly covered. Frontend/browser "as-needed."

---

## Final Thoughts & Next Steps

- Document your service class and testing expectations clearly for every feature.
- Effectively communicate this testing strategy with others working on the project.
- Automate your test execution in CI/CD later for even more reliability (e.g., GitHub Actions & Jest), but start simple.

By following clear guidelines, you'll ensure every release from your `dev` branch to the `main` branch is robust, predictable, and maintainable long-term.
