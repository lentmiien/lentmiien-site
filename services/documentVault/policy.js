const READ = 'vault.documents.read';
const INTAKE = 'vault.documents.intake';
const REVIEW = 'vault.documents.review';
const RESUME = 'vault.queue.resume';
const common = [READ, INTAKE, REVIEW];
const BUNDLES = { admin: [...common, RESUME], family: common, user: common };

const MAX_PAGES = 12;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_BATCH = 32 * 1024 * 1024;
const MAX_PIXELS = 32_000_000;
const MAX_TEXT = 32000;
const PAGE_SIZE = 24;
const validId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const sameId = (a, b) => a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  READ, INTAKE, REVIEW, RESUME, BUNDLES, MAX_PAGES, MAX_FILE, MAX_BATCH, MAX_PIXELS,
  MAX_TEXT, PAGE_SIZE, validId, sameId, VaultError,
};
