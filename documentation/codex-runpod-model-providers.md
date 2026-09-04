# Codex Runpod Model Providers

The `/codex` model-provider selector exposes these fixed mappings when their exact Runpod pod record is running:

| Provider choice | Required pod name | Codex profile | Usage group |
| --- | --- | --- | --- |
| Qwen (Runpod) | `ollama-qwen` | `lentmiien-qwen` | Ollama |
| GLM-5.3 Flash (Runpod) | `glm53-flash` | `lentmiien-glm` | Ollama |

A pod is available only when its durable `/admin/runpod` database record has `providerStatus: RUNNING`, `lifecycleGroup: running`, and no `archivedAt` value. The Runpod guard periodically refreshes those records. The service repeats this check when a request is submitted, retried, and claimed by a worker, so a stale browser cannot start a turn after the pod stops.

## Worker environment

Runpod routing credentials stay in the environment file on the machine that actually executes Codex. The default path is `~/.codex/lentmiien.env`; override it with:

```dotenv
CODEX_RUNPOD_PROFILE_ENV_FILE=/home/lennart/.codex/lentmiien.env
CODEX_RUNPOD_PROFILE_SHELL=/bin/bash
```

For a local Linux execution target, `~` resolves to the Codex worker account's home directory. For an SSH execution target, it resolves to the remote login account's home directory. The configured shell is also used on SSH targets that do not define their own shell. The worker uses an argument-safe shell wrapper equivalent to:

```bash
set -a
. ~/.codex/lentmiien.env
set +a
exec codex app-server
```

`set -a` makes ordinary `NAME=value` entries available to Codex even if the file does not use `export`. Current Codex versions reject `--profile` for `app-server`, so the worker reads `$CODEX_HOME/<profile>.config.toml` on the execution target, passes the startup-only `model_catalog_json` setting when starting App Server, and sends the remaining bounded config and explicit provider through `thread/start` or `thread/resume`. For SSH targets, the profile read uses the same remote environment wrapper and login account as the App Server process. Raw profile contents are not included in command summaries, events, or logs.

Restrict the environment file because it contains credentials:

```bash
chmod 600 ~/.codex/lentmiien.env
```

No permanent login-shell configuration is needed for this feature. If the whole worker service also needs the variables, use a systemd drop-in instead of `.bashrc`:

```ini
[Service]
EnvironmentFile=/home/lennart/.codex/lentmiien-systemd.env
```

Then run `sudo systemctl daemon-reload` and restart the worker unit. A systemd `EnvironmentFile` should contain plain `NAME=value` lines rather than shell commands or `export`, and its path must be absolute. Keep a separate systemd-formatted file if the existing shell-sourced file contains shell syntax.

## Security contract

- Feature and zone: logged-in `/codex` feature, with an additional semantic capability for cost-incurring Runpod execution.
- Principals: administrators receive `codex.run.runpod_model` through the Codex role bundle. Other complete user principals may receive that exact capability through the existing role store. Anonymous or incomplete principals cannot see or submit these providers.
- Objects: the new provider operation follows the existing Codex session/workspace ownership model. Broader legacy Codex object-authorization gaps remain tracked in `documentation/security-audit-2026-08-28.md` and are not expanded by these providers.
- Mutations: all `/codex` browser mutations require the shared session CSRF token and origin validation. Provider values and fixed profiles are validated server-side; a client cannot override the profile, model, or reasoning setting for these providers.
- Secrets and outbound trust: credentials remain outside MongoDB, rendered pages, command summaries, events, and logs. The environment file is sourced only for the two fixed provider identifiers, while the matching profile is read on the execution target and passed to the App Server thread without being persisted by the site. Profiles must reference environment keys rather than contain inline secret values. Outbound endpoints and credential variable names remain controlled by the administrator-owned Codex profiles.
- Availability and abuse controls: exact pod state is checked from the Runpod management mirror before enqueue and before execution. Existing prompt-size, queue-concurrency, workspace-lock, timeout, permission-mode, and yolo-confirmation controls still apply. Runpod-backed turns do not reserve the local AI Gateway Ollama container.
- Responses and caching: Pug/JSON output uses the existing escaping/serialization path, and `/codex` responses are marked `private, no-store`.
- Logging: failed capability lookups and turns blocked because a pod stopped are reported through the production logger without credentials or prompt content.
- Retention: provider choice, fixed profile name, token usage, and normal Codex turn history follow the existing Codex retention behavior. Authentication environment values are never persisted by this feature.
- Negative tests: focused tests cover unauthorized provider submission, stopped/absent pod rejection, hidden offline choices, fixed-profile enforcement, shell argument construction, and Ollama usage grouping.
