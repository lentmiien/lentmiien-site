const crypto = require('crypto');
const OTPAuth = require('otpauth');
const QRCode = require('qrcode');
const User = require('../models/useraccount');
const logger = require('../utils/logger');
const { receiptValid, TRUST_MS } = require('../utils/twoFactorSession');

const TRUST_COOKIE = 'lentmiien.2fa';
function encryptionKey(value = process.env.TWO_FACTOR_ENCRYPTION_KEY) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value) || Buffer.from(value, 'base64').length !== 32) {
    throw new Error('Two-factor encryption is not configured');
  }
  return Buffer.from(value, 'base64');
}
function checkConfiguration() {
  try { encryptionKey(); return true; }
  catch (_) {
    logger.error('Two-factor authentication unavailable: configure TWO_FACTOR_ENCRYPTION_KEY with 32 random bytes encoded as base64', { category: 'two_factor', metadata: { operation: 'configuration' } });
    return false;
  }
}
function createTwoFactorService({ userModel = User, key = encryptionKey, now = Date.now } = {}) {
  const getKey = () => typeof key === 'function' ? key() : encryptionKey(key);
  function seal(value, context) {
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), nonce);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function unseal(value, context) {
    if (typeof value !== 'string' || value.length > 4096 || !/^[\w-]+$/.test(value)) throw new Error('Invalid encrypted data');
    const data = Buffer.from(value, 'base64url');
    const cipher = crypto.createDecipheriv('aes-256-gcm', getKey(), data.subarray(0, 12));
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8'));
  }
  function authenticator(secret, name = 'Account') {
    return new OTPAuth.TOTP({ issuer: 'Lentmiien', label: name, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
  }
  function matchStep(secret, code) {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
    const timestamp = now();
    const delta = authenticator(secret).validate({ token: code, window: 1, timestamp });
    return delta === null ? null : Math.floor(timestamp / 30000) + delta;
  }
  function recoveryHash(userId, code) {
    const normalized = typeof code === 'string' ? code.replace(/-/g, '').toUpperCase() : '';
    if (!/^[A-F0-9]{32}$/.test(normalized)) return null;
    return crypto.createHash('sha256').update(`${userId}:${normalized}`).digest('hex');
  }
  function recoveryCodes(userId) {
    const codes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
    return { codes, hashes: codes.map(code => recoveryHash(userId, code)) };
  }
  const load = id => userModel.findOne({ _id: id }).select('+two_factor.secret +two_factor.last_step +two_factor.recovery_hashes');
  const filterFor = user => ({ _id: user._id, hash_password: user.hash_password, 'two_factor.version': user.two_factor?.version || '', 'two_factor.enabled': true });
  async function consume(user, code) {
    if (!user.two_factor?.enabled) return false;
    const filter = filterFor(user);
    const hash = recoveryHash(String(user._id), code);
    if (hash) {
      const result = await userModel.updateOne({ ...filter, 'two_factor.recovery_hashes': hash }, { $pull: { 'two_factor.recovery_hashes': hash } });
      return result.modifiedCount === 1;
    }
    const secret = unseal(user.two_factor.secret, `totp:${user._id}`);
    const step = matchStep(secret, code);
    if (step === null) return false;
    const result = await userModel.updateOne({ ...filter, $or: [{ 'two_factor.last_step': { $lt: step } }, { 'two_factor.last_step': { $exists: false } }] }, { $set: { 'two_factor.last_step': step } });
    return result.modifiedCount === 1;
  }
  async function setup(user) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    return { encrypted: seal(secret, `totp:${user._id}`), createdAt: now() };
  }
  async function setupDisplay(user, candidate) {
    const secret = unseal(candidate.encrypted, `totp:${user._id}`);
    return { secret, qr: await QRCode.toDataURL(authenticator(secret, user.name).toString(), { width: 256, margin: 2 }) };
  }
  async function confirm(user, candidate, code) {
    const secret = unseal(candidate.encrypted, `totp:${user._id}`);
    const step = matchStep(secret, code);
    if (step === null) return null;
    const recovery = recoveryCodes(String(user._id));
    const state = { enabled: true, secret: candidate.encrypted, version: crypto.randomUUID(), last_step: step, recovery_hashes: recovery.hashes };
    const version = user.two_factor?.version;
    const result = await userModel.updateOne({ _id: user._id, hash_password: user.hash_password,
      ...(version ? { 'two_factor.version': version } : { $or: [{ 'two_factor.version': '' }, { 'two_factor.version': { $exists: false } }] }) },
    { $set: { two_factor: state } }, { runValidators: true });
    if (result.modifiedCount !== 1) return null;
    user.two_factor = state;
    return recovery.codes;
  }
  async function replaceRecovery(user) {
    const recovery = recoveryCodes(String(user._id));
    const version = crypto.randomUUID();
    const result = await userModel.updateOne(filterFor(user), { $set: { 'two_factor.recovery_hashes': recovery.hashes, 'two_factor.version': version } });
    if (result.modifiedCount !== 1) return null;
    user.two_factor.version = version;
    return recovery.codes;
  }
  async function disable(user) {
    const result = await userModel.updateOne({ ...filterFor(user), type_user: { $ne: 'admin' } }, { $set: {
      two_factor: { enabled: false, version: crypto.randomUUID(), recovery_hashes: [], last_step: -1 },
    } });
    return result.modifiedCount === 1;
  }
  const cookieOptions = req => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' || req.secure, path: '/', maxAge: TRUST_MS });
  function remember(req, res, receipt) { res.cookie(TRUST_COOKIE, seal(receipt, 'trusted-browser'), cookieOptions(req)); }
  function forget(req, res) { const { maxAge, ...options } = cookieOptions(req); res.clearCookie(TRUST_COOKIE, options); }
  function remembered(req, user) {
    const cookie = String(req.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${TRUST_COOKIE}=`));
    if (!cookie) return null;
    try {
      const receipt = unseal(decodeURIComponent(cookie.slice(TRUST_COOKIE.length + 1)), 'trusted-browser');
      return receiptValid(user, receipt, now()) ? receipt : null;
    } catch (_) { return null; }
  }
  return { load, consume, setup, setupDisplay, confirm, replaceRecovery, disable, remember, remembered, forget, configured: () => { getKey(); }, seal, unseal, matchStep, recoveryHash };
}
module.exports = { createTwoFactorService, checkConfiguration, encryptionKey, TRUST_COOKIE };
