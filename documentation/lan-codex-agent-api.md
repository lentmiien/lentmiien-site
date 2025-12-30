# LAN Codex Agent API — User Manual (Requester-side Integration)

This document describes the **LAN Codex Agent** API you’re running on the “agent machine” (the machine that has the repo clones + runs Codex + pushes branches). It’s written as a reference for implementing the “user-side app” (the requester UI/service that sends jobs and receives results).

The agent is intentionally **single-purpose**:
- create a branch from `origin/dev`
- run `codex` instructions on that branch
- **commit** any changes
- **push** to GitHub
- provide **repo tree/file previews** (from git-tracked content)

No arbitrary command execution.

---

## 0) Key Concepts / How It Works

### 0.1 Two processes in the system
1) **Requester app (your user-side app)**  
   - Sends commands to the agent over LAN (HTTP)
   - Hosts a small receiver endpoint that accepts callback results

2) **Agent app (this Node/Express service)**  
   - Runs git + codex locally in configured project folders
   - Sends results back to the requester via **HTTP POST callback**

### 0.2 Async job model (important)
When you call endpoints like:
- `POST /api/branch/create`
- `POST /api/codex/run`

…the agent responds **immediately** with `202 Accepted`, then runs the job in the background (sequential queue, one at a time), and finally POSTs a result to your requester receiver URL (`CALLBACK_URL`).

So your user-side app must:
- generate a `requestId` for each command
- send the command
- then wait for the callback containing that same `requestId`

### 0.3 Branch “session” workflow you described
Typical flow per change:
1. Create branch: `branch/create`
2. One or more Codex iterations on that branch: `codex/run` (repeat as needed)
3. You test and merge on your separate machine (outside this agent)

The agent ensures it checks out the branch before running Codex for every iteration.

---

## 1) Base URL & Transport

- Base URL: `http://<AGENT_IP>:31337` (unless you changed `PORT`)
- Content type: JSON (`application/json`)
- No streaming; jobs are queued sequentially.

**LAN only** is assumed; you’re also restricting:
- sender IP allowlist
- shared token header

---

## 2) Authentication / Authorization

Every endpoint requires the following (unless you disabled it in env):

### 2.1 Sender IP allowlist (recommended)
The agent checks the source IP of the TCP connection and only accepts if it matches:

- Env: `ALLOWED_SENDER_IPS="192.168.1.50"` (comma-separated supported)
- If the requester IP is not in the set: **403 Forbidden**

### 2.2 Shared token header (recommended)
All requests must include:

- Header: `x-agent-token: <AGENT_TOKEN>`

If missing/wrong: **401 Unauthorized**

### 2.3 Callback uses the same token
When the agent POSTs back to the requester receiver endpoint, it also includes:
- `x-agent-token: <AGENT_TOKEN>`

So your receiver should validate it too.

---

## 3) Identifiers: `projectId`, `requestId`, `branchName`

### 3.1 `projectId`
A string that selects one of the agent’s configured repos (from `projects.json`).

Your requester should first call `GET /api/projects` and present those options.

### 3.2 `requestId`
A unique ID per user action (UUID recommended). Used for correlation only.

**Requester responsibilities:**
- generate a unique `requestId` per operation
- store `requestId -> (projectId, branchName, action, timestamp, etc.)`
- treat callbacks as authoritative job completion

The agent does **not** do idempotency/deduplication. If you send the same `requestId` twice, both will run.

### 3.3 `branchName`
Git branch name that must pass `git check-ref-format --branch`.

Good conventions:
- `codex/<ticket>-<short-slug>`
- `codex/2025-12-29-fix-api-payload`

Avoid spaces, `~ ^ : ? * [ \` and similar.

---

## 4) Queue / Busy Behavior

### 4.1 Job endpoints queue (sequential)
- `POST /api/branch/create` → queued
- `POST /api/codex/run` → queued

They always return `202`, even if something is already running, and will execute sequentially.

### 4.2 Preview endpoints reject while busy
- `GET /api/repo/tree`
- `GET /api/repo/file`

These return **409 Conflict** with `{ error: "busy" }` if any job is running/queued.  
(So your UI can gray-out browsing while Codex is actively modifying files.)

---

## 5) Endpoints

## 5.1 `GET /health`

**Purpose:** quick liveness check.

**Request:**
- Method: `GET`
- Path: `/health`
- Auth: none (in current code), but you can treat it as internal

**Response 200:**
```json
{
  "ok": true,
  "platform": "win32",
  "node": "v20.11.0",
  "running": false,
  "queued": 0,
  "projects": 1
}
```

---

## 5.2 `GET /api/projects`

**Purpose:** list allowed projects configured on the agent.

**Request:**
- Method: `GET`
- Path: `/api/projects`
- Headers:
  - `x-agent-token: ...`

**Response 200:**
```json
{
  "ok": true,
  "projects": [
    {
      "id": "myproj",
      "name": "My Project",
      "workDir": "C:\\repos\\myproj",
      "remote": "origin",
      "devBranch": "dev"
    }
  ]
}
```

**Typical requester usage:**
- call on startup
- cache result
- show list to user

---

## 5.3 `POST /api/branch/create`

**Purpose:** create a new branch from the latest `origin/dev` and push it to GitHub.

### Request
- Method: `POST`
- Path: `/api/branch/create`
- Headers:
  - `content-type: application/json`
  - `x-agent-token: ...`

**Body:**
```json
{
  "projectId": "myproj",
  "requestId": "req-001",
  "branchName": "codex/req-001-some-change",

  "forceClean": false,
  "timeoutMs": 1800000,
  "maxOutputKb": 2048
}
```

**Fields:**
- `projectId` (string, required)
- `requestId` (string, required)
- `branchName` (string, required)
- `forceClean` (boolean, optional, default false)
  - false: fail if working tree has uncommitted/untracked changes
  - true: `git reset --hard` and `git clean -fd` before proceeding (destructive)
- `timeoutMs` (optional): timeout per step
- `maxOutputKb` (optional): max captured output per stream per step (stdout/stderr)

### Immediate response
**202 Accepted:**
```json
{ "ok": true, "accepted": true, "queued": 0 }
```

### Callback result
The agent later POSTs to your receiver (CALLBACK_URL):

```json
{
  "action": "branch.create",
  "projectId": "myproj",
  "requestId": "req-001",
  "branchName": "codex/req-001-some-change",
  "ok": true,
  "headSha": "a1b2c3d4...",
  "durationMs": 12345,
  "output": "=== git fetch origin === ...",
  "steps": [
    {
      "name": "git fetch origin",
      "cmd": "git",
      "args": ["fetch","origin","--prune"],
      "cwd": "C:\\repos\\myproj",
      "exitCode": 0,
      "timedOut": false,
      "durationMs": 456,
      "stdout": "...",
      "stderr": "",
      "stdoutTruncated": false,
      "stderrTruncated": false
    }
  ]
}
```

**Failure callback (`ok:false`)** includes:
- `error` object with `message` (and possibly stack)
- partial `steps` up to the failure

### Common failure reasons
- remote branch already exists
- local repo not clean (forceClean=false)
- auth issues pushing to GitHub
- repo not cloned / wrong `workDir`

---

## 5.4 `POST /api/codex/run`

**Purpose:** run one Codex iteration on an existing remote branch:
- ensures correct branch is checked out
- runs `codex`
- commits any changes
- pushes to GitHub

### Request
- Method: `POST`
- Path: `/api/codex/run`
- Headers:
  - `content-type: application/json`
  - `x-agent-token: ...`

**Body:**
```json
{
  "projectId": "myproj",
  "requestId": "req-002",
  "branchName": "codex/req-001-some-change",

  "codexArgs": ["--model", "gpt-4.1"],
  "instruction": "Update the API payload to include branchName. Add tests.",

  "commitMessage": "codex: include branchName (req-002)",
  "push": true,

  "forceClean": false,
  "timeoutMs": 1800000,
  "maxOutputKb": 2048
}
```

**Fields:**
- `projectId`, `requestId`, `branchName` required
- `codexArgs`: string[] passed to codex
- `instruction`: string passed to codex via stdin
- `commitMessage` optional; default: `codex: update (<requestId>)`
- `push` optional; default true
- `forceClean` optional; same meaning as branch/create

### Immediate response
**202 Accepted**

### Callback result
Success:

```json
{
  "action": "codex.run",
  "projectId": "myproj",
  "requestId": "req-002",
  "branchName": "codex/req-001-some-change",
  "ok": true,
  "committed": true,
  "pushed": true,
  "headSha": "deadbeef...",
  "durationMs": 654321,
  "output": "…",
  "steps": [ ... ]
}
```

Notes:
- `committed` is false if Codex produced no changes (`git status --porcelain` empty).
- The agent commits only if dirty after codex. It commits *everything* (via `git add -A`).

### Important behavior note (robustness warning)
Current workflow sync behavior uses a “reset-to-remote” style checkout (`checkout -B branch origin/branch`).

This is great for “always run on the correct known remote state”, but it has one edge case:

- If a codex run **creates a commit locally but push fails**, the next codex run may reset the local branch back to the remote branch head and your local-only commit becomes dangling (recoverable via reflog, but annoying).

**Requester-side recommendation:**
- If you receive a callback with `ok:false` due to push/auth, treat it as “stop and fix agent GitHub auth before sending more jobs”.

(If you want, later we can tweak the agent to refuse to reset when local is ahead, which closes this gap cleanly.)

---

## 5.5 `GET /api/repo/tree` (folder / structure preview)

**Purpose:** view repo structure from a given git ref (branch/commit), for convenience when writing instructions.

**Important:** This previews **git-tracked content** at that ref, not raw filesystem state.

### Request
- Method: `GET`
- Path: `/api/repo/tree`
- Headers:
  - `x-agent-token: ...`
- Query parameters:
  - `projectId` (required)
  - `ref` (optional, default `HEAD`)
  - `path` (optional, default `""` = repo root)
  - `recursive` (optional `0|1`, default `0`)
  - `maxEntries` (optional, only used when recursive=1, default 2000)

Examples:
- Root listing:
  - `/api/repo/tree?projectId=myproj&ref=dev`
- Recursive tree under `src`:
  - `/api/repo/tree?projectId=myproj&ref=codex/xyz&path=src&recursive=1&maxEntries=3000`

### Response (non-recursive)
```json
{
  "ok": true,
  "projectId": "myproj",
  "ref": "codex/req-001-some-change",
  "path": "",
  "recursive": false,
  "entries": [
    { "type": "tree", "name": "src", "path": "src", "size": null },
    { "type": "blob", "name": "package.json", "path": "package.json", "size": 1234 }
  ]
}
```

### Response (recursive)
```json
{
  "ok": true,
  "projectId": "myproj",
  "ref": "codex/req-001-some-change",
  "path": "src",
  "recursive": true,
  "truncated": false,
  "maxEntries": 2000,
  "tree": {
    "type": "dir",
    "name": "src",
    "path": "src",
    "children": [
      { "type": "file", "name": "index.ts", "path": "src/index.ts" },
      {
        "type": "dir",
        "name": "utils",
        "path": "src/utils",
        "children": [
          { "type": "file", "name": "foo.ts", "path": "src/utils/foo.ts" }
        ]
      }
    ]
  }
}
```

### Errors
- `409 { error: "busy" }` if a job is running/queued
- `400` if invalid `ref`/`path`
- `400` if git errors occur (invalid ref, etc.)

---

## 5.6 `GET /api/repo/file` (file preview)

**Purpose:** fetch a text file’s contents from git at a given ref.

### Request
- Method: `GET`
- Path: `/api/repo/file`
- Headers:
  - `x-agent-token: ...`
- Query parameters:
  - `projectId` (required)
  - `ref` (optional, default `HEAD`)
  - `path` (required, repo-relative file path)
  - `maxBytes` (optional, default 200000)

Example:
- `/api/repo/file?projectId=myproj&ref=codex/req-001-some-change&path=src/index.ts&maxBytes=120000`

### Response
```json
{
  "ok": true,
  "projectId": "myproj",
  "ref": "codex/req-001-some-change",
  "path": "src/index.ts",
  "truncated": false,
  "maxBytes": 200000,
  "content": "export function …"
}
```

### Binary handling
If the file appears binary, the agent returns:
- **415 Unsupported Media Type**
```json
{ "ok": false, "error": "binary_file", "message": "File looks binary; refusing to preview as text." }
```

### Errors
- `409 { error: "busy" }`
- `404 { error: "not_found" }` if the file doesn’t exist at that ref/path
- `400` for invalid parameters

---

# 6) Callback Protocol (Agent → Requester)

## 6.1 Receiver requirements
Your requester app must host an HTTP endpoint (e.g. `POST /api/result`) at the URL configured on the agent as `CALLBACK_URL`.

The receiver should:
- validate `x-agent-token`
- parse JSON
- store payload keyed by `requestId`
- return `200 OK` quickly

## 6.2 Headers sent by agent on callback
- `content-type: application/json`
- `x-agent-token: <AGENT_TOKEN>` (if agent has one configured)

## 6.3 Payload shape
All callbacks include at least:

```ts
type AgentCallbackBase = {
  action: "branch.create" | "codex.run";
  projectId: string;
  requestId: string;
  branchName: string;
  ok: boolean;
  durationMs: number;
  output: string;     // human-readable combined log
  steps: StepResult[]; // structured step list
  error?: { name?: string; message: string; stack?: string };
};

type StepResult = {
  name: string;
  cmd: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal?: string | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error?: any;
};

type BranchCreateCallback = AgentCallbackBase & {
  action: "branch.create";
  headSha?: string;
};

type CodexRunCallback = AgentCallbackBase & {
  action: "codex.run";
  committed?: boolean;
  pushed?: boolean;
  headSha?: string;
};
```

---

# 7) HTTP Status Codes Summary (Requester should handle these)

- `200 OK`: synchronous info endpoint success (projects/tree/file)
- `202 Accepted`: job accepted and queued
- `400 Bad Request`: invalid JSON or parameters (unknown projectId, invalid ref/path)
- `401 Unauthorized`: wrong/missing token
- `403 Forbidden`: sender IP not allowed
- `404 Not Found`: file not found in git ref/path
- `409 Conflict`: agent busy (preview endpoints), or potentially queue logic
- `415 Unsupported Media Type`: attempted to preview a binary file
- `500`: agent misconfiguration (e.g. missing project folder)

---

# 8) Requester-side Implementation Tips

## 8.1 State model you’ll want in the requester app
At minimum:

- `projects: Project[]` (from `/api/projects`)
- `jobs: Map<requestId, JobStatus>`
- `branches: Map<branchName, BranchSession>`

Where `BranchSession` might store:
- `projectId`
- `branchName`
- last known `headSha`
- list of codex iterations (each keyed by requestId)

## 8.2 Suggested UX flow
1) Fetch projects
2) User selects project
3) User enters “new branch name” (or app auto-generates)
4) Send `branch/create`
5) Wait for callback
6) For each iteration:
   - optionally use preview endpoints to inspect tree/file at the branch
   - send `codex/run` with instruction
   - wait for callback
7) User goes to test machine and merges manually

## 8.3 Generating branch names
To reduce conflicts:
- include date or requestId
- normalize to lowercase + hyphens

Example:
- `codex/req-001-add-branchname`
- `codex/2025-12-29-req-001-add-branchname`

## 8.4 Handling “no changes”
If `committed: false`, you might show:
- “Codex produced no changes (nothing to commit).”
This can be normal if instructions were already satisfied.

## 8.5 Handling failures
If callback `ok:false`:
- show `error.message`
- show step logs from `output` and/or `steps`
- for GitHub auth failures, instruct yourself to fix agent credentials before sending more jobs

---

# 9) Security & Preview Endpoint Notes

### 9.1 Preview endpoints are git-based (safe-ish)
They do **not** read arbitrary filesystem paths.
- Tree = `git ls-tree`
- File = `git show ref:path`

That’s good: it avoids exposing random machine files.

### 9.2 Preview only shows committed/tracked content
If something exists only as uncommitted working tree changes, it won’t show in previews.
In practice your codex runs commit changes, so previews are useful for “what’s now on the branch”.

---

# 10) Minimal cURL Examples (for quick testing)

## Projects
```bash
curl http://AGENT_IP:31337/api/projects -H "x-agent-token: change-me"
```

## Create branch
```bash
curl -X POST http://AGENT_IP:31337/api/branch/create ^
  -H "content-type: application/json" ^
  -H "x-agent-token: change-me" ^
  -d "{\"projectId\":\"myproj\",\"requestId\":\"req-001\",\"branchName\":\"codex/req-001-some-change\"}"
```

## Run codex
```bash
curl -X POST http://AGENT_IP:31337/api/codex/run ^
  -H "content-type: application/json" ^
  -H "x-agent-token: change-me" ^
  -d "{\"projectId\":\"myproj\",\"requestId\":\"req-002\",\"branchName\":\"codex/req-001-some-change\",\"codexArgs\":[\"--model\",\"gpt-4.1\"],\"instruction\":\"Do the thing.\",\"commitMessage\":\"codex: do the thing\"}"
```

## Recursive tree
```bash
curl "http://AGENT_IP:31337/api/repo/tree?projectId=myproj&ref=codex/req-001-some-change&path=src&recursive=1" ^
  -H "x-agent-token: change-me"
```

## File preview
```bash
curl "http://AGENT_IP:31337/api/repo/file?projectId=myproj&ref=codex/req-001-some-change&path=src/index.ts" ^
  -H "x-agent-token: change-me"
```
