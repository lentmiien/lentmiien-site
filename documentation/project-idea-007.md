# Project Idea 007 – Test Coverage Expansion

## Goal
Increase confidence in critical services by expanding the Jest suite, adding new unit/integration tests, and enforcing baseline coverage thresholds. Focus on areas with high complexity or upcoming refactors (chat templates, setup script, finance workflows).

## Scope Overview
- Audit existing tests under `tests/unit` and identify gaps (template service, batch workflows, cooking/health analytics, setup diagnostics).
- Write new Jest suites or extend current ones to cover edge cases, error paths, and integration points.
- Configure coverage thresholds in `jest.config.js` and ensure generated reports feed CI or manual review.
- Document how to run targeted tests and interpret coverage data.

## Key Code Touchpoints
- `tests/unit/*.test.js`, new test files for uncovered services (e.g., `templateService.test.js`, `setup.test.js`).
- `jest.config.js` – adjust `collectCoverageFrom`, thresholds, and reporters.
- Source files under test: `services/templateService.js`, `services/conversationService.js`, `setup.js`, `services/budgetService.js`, etc.
- `package.json` scripts if adding watch or CI-specific commands.

## Implementation Notes
1. **Coverage audit** – Use `npm test -- --coverage` to identify low coverage modules. Prioritise those tied to Projects 001–006.
2. **Test scaffolding** – Create mocks for Mongo models, filesystem, and network utilities similar to existing suites (e.g., conversation service tests).
3. **Edge cases** – Ensure tests cover failure modes introduced by Project Idea 006 (e.g., setup retries) and new template logic.
4. **Thresholds** – Set minimum coverage (e.g., 70% statements/branches) and update documentation on how to interpret failures.
5. **Automation** – Optionally integrate with git hooks or CI (future) to prevent regressions.

## Dependencies / Follow-ups
- Build alongside projects that modify services (001–006) so coverage grows with new features.
- Consider adding property-based or integration tests after foundational coverage is achieved.
