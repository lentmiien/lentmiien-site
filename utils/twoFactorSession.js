const crypto = require('crypto');

const TRUST_MS = 90 * 24 * 60 * 60 * 1000;
const PENDING_MS = 10 * 60 * 1000;
const SECURITY_CAPABILITY = 'account.security.manage';
const ROLE_BUNDLES = { admin: [SECURITY_CAPABILITY], family: [SECURITY_CAPABILITY], user: [SECURITY_CAPABILITY], other: [SECURITY_CAPABILITY] };

function passwordFingerprint(user) {
  return crypto.createHash('sha256').update(String(user.hash_password || '')).digest('hex');
}
function requiresTwoFactor(user) {
  return user?.type_user === 'admin' || user?.two_factor?.enabled === true;
}
function verificationReceipt(user, now = Date.now()) {
  return { userId: String(user._id), credential: passwordFingerprint(user), version: user.two_factor?.version || '', verifiedAt: now };
}
function receiptValid(user, receipt, now = Date.now()) {
  return Boolean(user?.two_factor?.enabled && receipt
    && receipt.userId === String(user._id) && receipt.credential === passwordFingerprint(user)
    && receipt.version === user.two_factor.version && typeof receipt.verifiedAt === 'number'
    && receipt.verifiedAt <= now && now - receipt.verifiedAt < TRUST_MS);
}
function sessionHasRequiredTwoFactor(user, session, now = Date.now()) {
  return !requiresTwoFactor(user) || receiptValid(user, session?.twoFactor, now);
}
function pendingValid(user, pending, now = Date.now()) {
  return Boolean(pending && pending.userId === String(user._id)
    && pending.credential === passwordFingerprint(user) && pending.version === (user.two_factor?.version || '')
    && typeof pending.createdAt === 'number' && pending.createdAt <= now && now - pending.createdAt < PENDING_MS);
}
async function beginPendingVerification(req, user) {
  const pending = { userId: String(user._id), credential: passwordFingerprint(user), version: user.two_factor?.version || '', createdAt: Date.now() };
  await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
  req.user = undefined;
  req.session.pendingTwoFactor = pending;
}

module.exports = { TRUST_MS, PENDING_MS, SECURITY_CAPABILITY, ROLE_BUNDLES, passwordFingerprint, requiresTwoFactor, verificationReceipt, receiptValid, sessionHasRequiredTwoFactor, pendingValid, beginPendingVerification };
