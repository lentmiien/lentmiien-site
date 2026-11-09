# Testing Strategy Guide

## Repository test layout

- `tests/unit/**/*.test.js`: service, controller, route, model, browser-client and security checks. Some database/contract integration checks also live here.
- `tests/integration/**/*.test.js`: Local AI checks using disposable Mongo and, for some suites, a pinned Gateway checkout and Python environment.
- `tests/startupChecks.test.js`: startup diagnostic helpers.
- `tests/helpers/` and `tests/fixtures/`: shared harnesses and synthetic data.
- `tests/browser/`: standalone browser smoke scripts; not discovered by Jest.
- `tests/python/`: Python unittest checks, with some also invoked by Jest wrappers.

Application modules live directly in `services/`, `routes/`, `controllers/`, etc.; there is no `src/` directory. Jest discovers `tests/**/*.test.js` through `jest.config.js`. Jest and jsdom are already development dependencies; use `npm ci` for a clean install rather than adding testing packages ad hoc.

## Routine commands

Use the Node version pinned by Volta in `package.json`. Check `node --version` first: an agent shell can have a different Node installation earlier in `PATH`. Select the pinned installation before testing; do not change the repository pin to match the shell.

```bash
# Focused behavior check; unrelated coverage targets do not apply.
npm test -- tests/unit/templateService.test.js --coverage=false

# Full Jest run, including configured coverage checks.
npm test

# Lower parallel memory use, retaining worker recycling.
npm test -- --maxWorkers=1
```

The npm script supplies `--experimental-vm-modules` for tests that import ESM dependencies and enables coverage. Prefer it over invoking bare `jest`.

Do not use `npm start` as a test command: `prestart` runs `setup.js`, which performs file/database maintenance and can synchronize Dropbox. Importing `app.js` also starts the application lifecycle and background services. Test routers/services with mocks or an isolated Express harness instead.

## Large-suite memory and diagnostics

The suite has hundreds of test files. `jest.config.js` limits execution to two workers and sets `workerIdleMemoryLimit: '512MiB'`. Jest checks worker memory after a test file finishes and recycles workers above the threshold. This limits accumulation across suites without increasing every Node process's heap allowance. The fixed threshold avoids depending on the host's reported total RAM. See [Jest's worker memory configuration](https://jestjs.io/docs/30.0/configuration#workeridlememorylimit-numberstring).

The threshold is **not a hard limit on total RAM**: a running file can exceed it, and the Jest parent, native allocations, and subprocesses use additional memory. Recycling also incurs some startup overhead. Coverage targets and assertions remain unchanged.

If a run fails with `FATAL ERROR: Reached heap limit`, `JavaScript heap out of memory`, or an agent summary such as "The full suite hit Node's memory limit":

1. Verify the pinned Node version and rerun with `npm test -- --maxWorkers=1`. With the installed Jest version and the configured idle-memory limit, one worker still runs in a recyclable child process.
2. Remove full-suite `--runInBand` or `--detectOpenHandles` flags. Both run tests in the main process and bypass worker recycling. Reserve them for focused diagnostics. An operating-system `SIGKILL` is different from a V8 heap error; investigate available system/container memory instead of assuming a bigger heap will help.
3. Use `npm test -- --maxWorkers=1 --logHeapUsage` to locate heavy suites. For a suspected individual file, use a focused diagnostic run:

   ```bash
   node --experimental-vm-modules --expose-gc node_modules/jest/bin/jest.js tests/unit/<name>.test.js --coverage=false --runInBand --logHeapUsage
   ```

4. If a **single file** exceeds Node's default heap and the machine has sufficient RAM, a temporary explicit increase is available:

   ```bash
   node --max-old-space-size=8192 --experimental-vm-modules node_modules/jest/bin/jest.js tests/unit/<name>.test.js --coverage=false --maxWorkers=1
   ```

   Worker recycling cannot interrupt a file mid-run. Investigate its fixtures, imports, mocks and resource cleanup; an 8 GiB heap is a fallback, not the default for every worker. Repeat full coverage validation after fixing the cause.

Do not skip tests, reduce coverage thresholds, add `--forceExit`, or turn off full-suite coverage to claim a successful validation. If the full run cannot finish, report the command, failure and validation gap.

## Coverage expectations and reports

Coverage currently covers four critical files. These are minimum thresholds, not whole-application coverage claims; `jest.config.js` is the source of truth.

| Target | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Global | 50% | 35% | 50% | 50% |
| `setup.js` | 35% | 25% | 40% | 35% |
| `services/templateService.js` | 70% | 50% | 80% | 70% |
| `services/budgetService.js` | 70% | 35% | 65% | 70% |
| `utils/startupChecks.js` | 70% | 40% | 80% | 70% |

`npm test` produces a console table, LCOV/HTML and JSON summary under ignored `coverage/`. For a compact report without HTML assets, use `npm test -- --coverageReporters=text-summary`; threshold checks still apply.

Startup directory preparation, retries and Dropbox readiness checks are in `tests/unit/setup.test.js`; preflight helpers are also tested in `tests/startupChecks.test.js`. Run relevant focused suites before full validation.

## Optional integrations and browser checks

An ordinary `npm test` run includes unit tests and any integration tests whose prerequisites are present. It is normal for explicitly gated suites to skip when disposable Mongo, a pinned external checkout or a Python environment is unavailable. Report those skips; a green default run does not prove those integrations passed.

- Local AI Mongo suites use `LOCAL_AI_TEST_MONGO_URI` with a disposable loopback `local_ai_test` database. They clear collections and drop the database. Run them with `--maxWorkers=1` because multiple files share that database. This also applies to full runs when the variable is set. See [Local AI session checks](local-ai-exclusive-sessions.md#isolated-checks) for Gateway/Python prerequisites; use the current Node pin and the worker-based commands above instead of historical release commands.
- TARIC Mongo suites use `TARIC_TEST_MONGO_URL` with an explicitly named disposable loopback test database. Inspect each suite's prerequisites and teardown before enabling it; never substitute production connection settings.
- Browser scripts have their own harnesses and Playwright/Chromium prerequisites. Check the relevant script/feature documentation before running them; they are not included by `npm test`, and Playwright is not a declared development dependency.
- The standalone TARIC converter check is `python3 -B -m unittest discover -s tests/python -p 'test_taric_dataset_converter.py'`. Its Jest wrapper skips when Python is unavailable; see [the dataset guide](taric-dataset-guide.md).

Do not load production `.env` or connect to live services to satisfy missing test prerequisites. Use synthetic data and isolated resources.

## Keeping tests maintainable

Prioritize behavior and failure cases in core services, route authorization/input validation, and security boundaries. Browser-client behavior can use jsdom; use manual or standalone browser checks for layout and interaction when appropriate.

- Keep fixtures bounded. Mock unrelated external services and avoid importing the application entry point.
- Close every jsdom window in `afterEach`/`afterAll` or `finally`, including when an assertion throws. Also stop timers/workers, close HTTP servers/connections, and remove temporary directories.
- Restore spies, fake timers and modified environment values. Do not use module resets as a blanket memory workaround; reserve them for tests that need fresh import-time state.
- Keep regression/security assertions when consolidating repetitive setup. Similar-looking suites can exercise different boundaries; remove tests only after establishing that their behavior remains covered.
- Use `--detectOpenHandles` on a focused suite to investigate resources preventing exit. Worker recycling is a safeguard for growth, not a replacement for cleanup.

## Test logging

The shared application logger retains console warnings/errors in tests but skips its production file sink whenever `NODE_ENV=test` or `JEST_WORKER_ID` is present. This also protects Jest runs invoked with `NODE_ENV=production`. Test subprocesses should retain these environment markers. File-sink tests must mock filesystem writes; do not clear both markers while using the real logger against `logs/`.

Production JSON log entries include a `runtime` object with PID, process start time, environment and the Git revision captured at the first log entry. Revision is null when Git metadata is unavailable; it is an attribution hint, not proof of a clean checkout or a deployment identifier. These fields help distinguish processes without logging their command line, environment contents or credentials.

## Before merging or deploying

- Run focused suites for the change, then `npm test` when practical and check coverage thresholds.
- Run the relevant optional integration/browser checks when their behavior changed and disposable prerequisites are available.
- Record failures, skipped checks and missing prerequisites alongside validation results.
- Review affected UI manually when automated checks do not cover its appearance or interaction.
