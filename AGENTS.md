# Repository Guidelines

## Project Structure & Module Organization
- Entry point: `app.js` (Express + Socket.IO).
- Server code: `routes/`, `controllers/`, `services/`, `models/`, `utils/`.
- Views: `views/` (Pug). Static assets: `public/` (css, js, html, img, mp3).
- Realtime: `socket_io/`.
- Data & backups: `cache/`, `tmp_data/`, `github-repos/` (created by `setup.js`).
- Environment: copy `env_sample` to `.env` and set values.

## Build, Test, and Development Commands
- Install: `npm install` — install dependencies.
- Start: `npm start` — runs `prestart` (sets up caches/dirs, DB cleanup, Dropbox backup) then `node app`.
- Test: `npm test` — runs `node test` (currently a custom script, not a test runner).
- Example local run: `PORT=8080 node app` (Windows PowerShell: `$env:PORT=8080; node app`).

## Coding Style & Naming Conventions
- JavaScript (Node 18+). Predominantly CommonJS (`require`, `module.exports`). Keep new code consistent with neighboring files; avoid mixing ESM unless needed.
- Indentation: 2 spaces; include semicolons; single quotes preferred.
- Files: follow existing patterns in each folder (e.g., `routes/*.js`, `models/*`); export Models in PascalCase; functions in `lowerCamelCase`.
- Views: Pug templates under `views/`; keep route names aligned with template names where practical.

## UI Color Theme
- All pages must use the Graphite/Ember/Golden Amber color system defined in `documentation/README-Colors.md`.
- Import `/css/color-theme.css` as the base theme for any Pug page that does not extend `views/layout.pug`; the shared layout already imports it.
- Page-specific CSS may extend the theme, but should use the global tokens (`--bg`, `--surface-1`, `--surface-2`, `--surface-3`, `--border`, `--divider`, `--text`, `--text-secondary`, `--text-muted`, `--text-inverse`, `--brand`, `--accent`, semantic tokens, and tints) instead of hard-coded light palettes.
- New pages should default to the dark Graphite base, Ember for primary actions, Golden Amber for links/focus/highlights, and the documented semantic colors for status states.

## Testing Guidelines
- Current: no standardized test framework; `test.js` exercises image editing APIs.
- For new tests: add focused Node scripts or introduce Jest as documented in `testing-guide.md`.
- Suggested naming if adding Jest: place under `tests/` and name `*.test.js`; run via `npm test` after updating the script.

## Commit & Pull Request Guidelines
- Commits: imperative mood, concise, present tense (e.g., "Add X", "Fix Y"). Group related changes.
- PRs: include summary, motivation, linked issues, and screenshots/GIFs for UI changes. Note any env vars, DB migrations, or breaking changes.

## Security & Configuration Tips
- Never commit secrets. Configure `.env` from `env_sample` (e.g., `MONGOOSE_URL`, `SESSION_SECRET`, `API_KEY`, `OPENAI_API_KEY`, Dropbox/Google keys).
- `setup.js` touches caches, converts images, performs DB maintenance, and triggers backups; ensure env is correct before `npm start`.
- MongoDB: models are wired in `database.js`; verify connectivity before running locally.
