# Repository Guidelines

## Project Structure & Module Organization
- Entry point: `app.js` (Express + Socket.IO).
- Server code: `routes/`, `controllers/`, `services/`, `models/`, `middleware/`, `schedulers/`, and `utils/`.
- Views: `views/` (Pug). Static assets and generated media: `public/`. Standalone games: `games/`. Maintenance scripts: `scripts/`.
- Realtime: `socket_io/`.
- Tests: `tests/` (Jest). Project documentation: `documentation/`.
- Generated and ignored runtime data includes `cache/`, `tmp_data/`, `logs/`, `github-repos/`, coverage, and generated media; do not edit or commit it unless the task specifically requires it.
- Environment: copy `env_sample` to `.env` and set values.

## Build, Test, and Development Commands
- Clean install: `npm ci`. Use `npm install` only when intentionally changing dependencies, and commit the resulting lockfile changes.
- Test: `npm test` — runs the Jest suite with coverage. Run a focused suite with `npm test -- tests/unit/<name>.test.js`.
- Validate curated OpenAPI YAML after changing it: `npm run lint:openapi`.
- `npm start` is not a routine smoke test: its `prestart` pipeline mutates generated files and database data and may run Dropbox synchronization before launching `node app`.
- `PORT=8080 node app` bypasses `prestart`, but still connects to MongoDB and starts background schedulers and workers. Use it only when exercising the configured application environment.

## Coding Style & Naming Conventions
- JavaScript using the Node version pinned by Volta in `package.json` (currently 24.12.0). Predominantly CommonJS (`require`, `module.exports`). Keep new code consistent with neighboring files; avoid mixing ESM unless needed.
- Indentation: 2 spaces; include semicolons; single quotes preferred.
- Files: follow existing patterns in each folder (e.g., `routes/*.js`, `models/*`). Use PascalCase for new model constructor identifiers and `lowerCamelCase` for functions; preserve existing filenames, registered Mongoose model names, and collection names unless a migration is explicitly requested.
- Views: Pug templates under `views/`; keep route names aligned with template names where practical.

## UI Color Theme
- New or materially modified first-party UI pages must use the Graphite/Ember/Golden Amber color system defined in `documentation/README-Colors.md`; do not perform unrelated restyling.
- Import `/css/color-theme.css` as the base theme for any Pug page that does not extend `views/layout.pug`; the shared layout already imports it.
- Page-specific CSS may extend the theme, but should use the global tokens (`--bg`, `--surface-1`, `--surface-2`, `--surface-3`, `--border`, `--divider`, `--text`, `--text-secondary`, `--text-muted`, `--text-inverse`, `--brand`, `--accent`, semantic tokens, and tints) instead of hard-coded light palettes.
- New pages should default to the dark Graphite base, Ember for primary actions, Golden Amber for links/focus/highlights, and the documented semantic colors for status states.

## Testing Guidelines
- Jest is configured in `jest.config.js` for `tests/**/*.test.js` and enforces coverage thresholds for selected critical files.
- Add focused tests alongside changed behavior, normally under `tests/unit/` with the `*.test.js` suffix. Run the focused suite first, then `npm test` when practical.
- See `documentation/testing-guide.md` for test commands and manual verification guidance.

## Commit & Pull Request Guidelines
- Commits: imperative mood, concise, present tense (e.g., "Add X", "Fix Y"). Group related changes.
- PRs: include summary, motivation, linked issues when applicable, and screenshots/GIFs for UI changes. Note any env vars, DB migrations, or breaking changes.

## Security & Configuration Tips
- Never commit secrets. Configure `.env` from `env_sample` (e.g., `MONGOOSE_URL`, `SESSION_SECRET`, `API_KEY`, `OPENAI_API_KEY`, Dropbox/Google keys).
- Do not read, print, or commit `.env`, token files, credentials, or generated personal data unless the task requires it.
- `setup.js` resets temporary data, converts images, prunes files, performs database maintenance, and conditionally runs Dropbox backup and restore. Its preflight normally requires `MONGOOSE_URL`, `SESSION_SECRET`, and `OPENAI_API_KEY`.
- `database.js` opens the application's MongoDB connection on import; verify connectivity and use sandbox credentials for external integrations when possible.
