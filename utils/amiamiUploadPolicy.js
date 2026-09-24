const IMPORT = 'amiami.items.import';
// This capability manages the shared catalog and global import job, not personal jobs.
const ROLE_BUNDLES = Object.freeze({ admin: [IMPORT], family: [], user: [] });
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_CODES = 1000;
const DELAY_MS = 60000;
const JOB_LIFETIME_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;
const ACTIVE_STATES = ['queued', 'running'];

class AmiAmiUploadError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

module.exports = { IMPORT, ROLE_BUNDLES, MAX_HTML_BYTES, MAX_CODES, DELAY_MS,
  JOB_LIFETIME_MS, LEASE_MS, ACTIVE_STATES, AmiAmiUploadError };
