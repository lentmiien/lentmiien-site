const PASSWORD_REQUIREMENTS = 'Use at least 12 characters, including an uppercase letter (A–Z), a lowercase letter (a–z), a number and a symbol. Use a different password from your current one. Maximum 72 UTF-8 bytes; some characters use more than one byte.';

function meetsPasswordRequirements(value) {
  return typeof value === 'string'
    && Array.from(value).length >= 12
    && Buffer.byteLength(value, 'utf8') <= 72
    && /[A-Z]/.test(value)
    && /[a-z]/.test(value)
    && /[0-9]/.test(value)
    && /[\p{P}\p{S}]/u.test(value);
}

function passwordReminder(user, now = new Date()) {
  if (user?.password_change_requested) {
    return 'An administrator has asked everyone to update their password. Please choose a new password.';
  }
  const changedAt = user?.password_changed_at ? new Date(user.password_changed_at) : null;
  if (!changedAt || !Number.isFinite(changedAt.getTime())) {
    return 'We do not have a record of when your password was last changed. Please update your password.';
  }
  const dueAt = new Date(changedAt);
  const day = dueAt.getUTCDate();
  dueAt.setUTCDate(1);
  dueAt.setUTCMonth(dueAt.getUTCMonth() + 6);
  const lastDay = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth() + 1, 0)).getUTCDate();
  dueAt.setUTCDate(Math.min(day, lastDay));
  return now > dueAt ? 'It has been more than six months since you last changed your password. Please update your password.' : '';
}

function redirectAfterLogin(req, res) {
  return res.redirect(passwordReminder(req.user) ? '/settings' : '/mypage');
}

module.exports = { PASSWORD_REQUIREMENTS, meetsPasswordRequirements, passwordReminder, redirectAfterLogin };
