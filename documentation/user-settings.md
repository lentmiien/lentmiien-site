# User settings

`/settings` displays the current account's username, email and account type. Separate forms update the email or password after verifying the current password. Username and account type are not accepted as editable fields; administrators continue to manage account types through `/admin`.

## Security contract

### Password reminders and requirements

`password_changed_at` records the last successful password replacement in UTC. `password_change_requested` marks an outstanding administrator request independently of that date. Successful login redirects to `/settings` when this flag is set, the date is unknown, or more than six calendar months have passed (UTC, clamped to the last day of the destination month). The reminder is optional: users can continue to My Account. Visiting or leaving settings, logging in, and changing email do not dismiss it; a successful personal password change records the new date and clears the flag atomically with the hash.

Existing accounts have an unknown date and will receive the reminder on their next login, without a bulk migration. Admin-created or admin-reset temporary passwords record their creation date and set the request flag so the user is prompted to replace them. New personal passwords must differ from the existing password, have at least 12 characters, include an ASCII uppercase letter, ASCII lowercase letter, a digit and a non-whitespace symbol, and fit within 72 UTF-8 bytes.

The new POST `/admin/password-reminders` operation is logged-in and admin-managed, with no machine access. It requires an admin principal plus `admin.password_reminders.request` (bundled only for admin; family, user and other receive no grant). It applies to all accounts, including the initiating admin, and changes only the request flag. Shared CSRF, a 1 KiB/two-field body limit, strict input validation, and a three-attempts-per-admin-per-hour limit protect the mutation. No client-selected owner or scope is accepted. The page provides an explicit confirmation checkbox. Responses are private/no-store, analytics are disabled, and failures are logged without account data. There are no external services, files or additional personal-data retention. Tests cover denied roles, CSRF, input bounds, bulk scope, failure handling, repeat logins, calendar boundaries and reminder dismissal only after a valid password change.

The legacy `other` account type receives the same owner-only settings capabilities as user, so those accounts can act on the login reminder. Unrecognized custom roles still require explicit settings grants.

### Self-service controls

- Feature: account details and self-service credential changes.
- Security zone: logged-in; interactive principals: admin, family, user, other (custom roles need explicit grants); machine principals: none.
- Data classification: sensitive account email; secret passwords and hashes.
- Capabilities: `account.profile.read`, `account.email.write`, `account.password.write`, bundled explicitly for admin, family, user and other.
- Object scope: owner, using only the validated session principal's immutable ID. No admin override.
- Browser mutations: POST `/settings/email` and `/settings/password`, protected by shared session CSRF and current-password verification.
- Abuse controls: at most 10 mutation attempts per account per 15 minutes per application process, before password comparison/hashing. Reads limited to 60 requests per minute per account.
- Request limits: 8 KiB JSON/form body, at most four form fields, strict field allowlists, no object-selection query parameters; email at most 200 characters; current password at most 1,024 UTF-8 bytes; new password follows the requirements above, with confirmation. New passwords use bcrypt cost 12.
- Output: escaped Pug text/attributes; password values/hashes never rendered, persisted in the session, or logged. No analytics.
- Private files/media and outbound services: none.
- Cache: private, no-store; no-referrer; noindex/nofollow.
- Logs: generic operational failures with category `account_settings` and operation only; no request bodies or personal account fields.
- Retention: replace the existing email/hash in the account record; retain no password history or extra personal data.
- Negative tests: anonymous/missing capability, forged identity or role, wrong/missing current password, invalid CSRF/origin, malformed/oversized inputs, bcrypt byte limit, concurrent credential changes, database failure, escaped output, and rate limits.
- Legacy dependency: Passport reloads the account on each request; atomic updates match both owner ID and the verified hash to reject concurrent credential changes. Existing sessions are not revoked by this feature; the application has no shared session-revocation mechanism. Username login and existing admin account management remain in place. Email is a contact field, not a unique login identifier or a verified address.

## Deployment and verification

No environment variables, dependencies, schema migrations or Cloudflare rules are required. The application's limits and authorization apply independently of edge controls. Rollback removes the route/navigation/view additions; updated emails and bcrypt hashes remain compatible with existing login and administration.

Run `npm test -- tests/unit/userSettings.test.js tests/unit/passwordPolicy.test.js tests/unit/passwordReminders.test.js tests/unit/passwordTrackingAdmin.test.js tests/unit/accountSurfacePolicy.test.js --coverage=false`, then the full test suite. In the configured application, open User settings from My Account or Tools, submit both forms, verify validation messages, and confirm login with the new password. In a sandbox database, request updates from `/admin` and verify repeated login reminders, optional navigation away, and dismissal after changing the password. The admin button affects every account; do not exercise it against production as a smoke test.
