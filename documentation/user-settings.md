# User settings

`/settings` displays the current account's username, email and account type. Separate forms update the email or password after verifying the current password. Username and account type are not accepted as editable fields; administrators continue to manage account types through `/admin`.

## Security contract

- Feature: account details and self-service credential changes.
- Security zone: logged-in; interactive principals: admin, family, user (custom roles need explicit grants); machine principals: none.
- Data classification: sensitive account email; secret passwords and hashes.
- Capabilities: `account.profile.read`, `account.email.write`, `account.password.write`, bundled explicitly for admin, family and user.
- Object scope: owner, using only the validated session principal's immutable ID. No admin override.
- Browser mutations: POST `/settings/email` and `/settings/password`, protected by shared session CSRF and current-password verification.
- Abuse controls: at most 10 mutation attempts per account per 15 minutes per application process, before password comparison/hashing. Reads limited to 60 requests per minute per account.
- Request limits: 8 KiB JSON/form body, at most four form fields, strict field allowlists, no object-selection query parameters; email at most 200 characters; current password at most 1,024 UTF-8 bytes; new password at least 12 characters and at most 72 UTF-8 bytes (bcrypt's limit), with confirmation. New passwords use bcrypt cost 12.
- Output: escaped Pug text/attributes; password values/hashes never rendered, persisted in the session, or logged. No analytics.
- Private files/media and outbound services: none.
- Cache: private, no-store; no-referrer; noindex/nofollow.
- Logs: generic operational failures with category `account_settings` and operation only; no request bodies or personal account fields.
- Retention: replace the existing email/hash in the account record; retain no password history or extra personal data.
- Negative tests: anonymous/missing capability, forged identity or role, wrong/missing current password, invalid CSRF/origin, malformed/oversized inputs, bcrypt byte limit, concurrent credential changes, database failure, escaped output, and rate limits.
- Legacy dependency: Passport reloads the account on each request; atomic updates match both owner ID and the verified hash to reject concurrent credential changes. Existing sessions are not revoked by this feature; the application has no shared session-revocation mechanism. Username login and existing admin account management remain in place. Email is a contact field, not a unique login identifier or a verified address.

## Deployment and verification

No environment variables, dependencies, schema migrations or Cloudflare rules are required. The application's limits and authorization apply independently of edge controls. Rollback removes the route/navigation/view additions; updated emails and bcrypt hashes remain compatible with existing login and administration.

Run `npm test -- tests/unit/userSettings.test.js tests/unit/accountSurfacePolicy.test.js --coverage=false`, then the full test suite. In the configured application, open User settings from My Account or Tools, submit both forms, verify validation messages, and confirm login with the new password. Use a sandbox account.
