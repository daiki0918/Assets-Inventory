# Production Readiness Review

Review date: 2026-11-07

## Status

**Not cleared for production.** The workspace staging JWT secret has been rotated and startup now rejects known placeholders and short secrets. The user confirmed the configured database is disposable staging and that Admin/Operator test accounts are available. Automated tests pass, but the shared browser still showed the sign-in page during verification; live login and UI workflows therefore remain unverified. A separate production deployment secret store is not accessible from this workspace and must also be updated before deployment.

## Changes in this review

- Restricted API CORS to configured exact origins. When `CORS_ORIGINS` is unset, the configured `APP_URL` origin and local development origins are allowed; an explicit `CORS_ORIGINS` list overrides those defaults. CORS is not a substitute for API authentication.
- Kept spreadsheet and QR-label libraries lazy-loaded. The initial JavaScript chunk is 359.39 kB (108.92 kB gzip); the optional spreadsheet chunk remains 627.17 kB (322.92 kB gzip).
- Replaced browser use of the spreadsheet package’s Node-oriented `writeFile` path with XLSX byte-array generation and a Blob download, avoiding the failing `fs.writeFileSync` browser path without adding a polyfill.
- Rotated the local staging JWT secret to 48 random bytes without printing it, excluded `.env` files in the new root `.gitignore`, and added server-start validation rejecting known placeholder values and secrets shorter than 32 characters.
- Confirmed the seed script has no embedded shared password, preserves existing accounts, and requires separate environment passwords for accounts it creates.
- Removed password arguments from `create-user.js`: passwords are entered through a hidden interactive prompt, and new accounts require at least 12 characters. Seed and utility-created password hashes now use bcrypt cost 12.
- Added integration coverage that accepts the configured application origin and withholds CORS access for an untrusted origin.

## Verification performed

| Area | Result |
|---|---|
| `server`: `npm test` | Pass: 6 tests, 0 failures. Covers authentication/role scope, asset registration/edit/delete, API spreadsheet import validation and invalid-import atomicity, unique generated asset codes, QR resolution, inventory scans, batch transfer and destination receipt, export scoping, and branch/location guards. |
| Backend syntax | Pass: `node --check` for `server.js`, `models.js`, `seed.js`, `create-user.js`, and `test/system.integration.test.js`. |
| JWT startup guard | Pass: server startup rejected the known placeholder without exposing a secret. |
| Client production build | Pass. The lazy spreadsheet chunk remains over Vite’s 500 kB warning threshold. |
| Browser Excel check | Pass: the browser-native Blob download helper produced an `.xlsx` payload and filename; fetching the Blob and reading it back preserved the cell values. The test intercepted the anchor click for in-page verification, so the browser-managed download UI was not confirmed. Authenticated import/export screens still need staging-account testing. |
| Browser QR check | Pass: generated a PNG QR data URL. API QR lookup and inventory scan workflows also pass in the isolated integration suite. A physical camera scan was not tested. |
| Role permissions | Pass in the isolated suite: operators are branch-scoped, cannot access audit or register assets, cannot use another branch’s QR asset, and cannot receive another branch’s transfer. Superadmin operations are exercised. |
| JWT rotation | Pass for workspace staging: generated a 48-byte secret, confirmed only its length/placeholder status, restarted the API, and verified unauthenticated API requests receive 401. Secret value was not printed. |
| Legacy account inventory | Both potentially affected legacy seed accounts exist in staging (`admin@cosmopolitan.local`, `carcar@cosmopolitan.local`). Password hashes were not read or displayed; no password reset was performed. |
| Production bundle stream check | Pass: production spreadsheet chunk contains no Vite browser-external stream shim or Node stream require. Development mode can still log the package’s optional `stream.Readable` branch when XLSX is imported. |
| Configured database inspection | Read-only. Three transfer records were found, all `approved`; none were `pending` or `approving`. No pending transfer referenced an asset outside its source branch. |
| Inventory consistency inspection | Read-only counts: 0 assets with a location in another branch; 0 assets with a missing branch; 0 operators missing a branch; 0 verified scans inconsistent with their inventory session’s branch. |
| Staging Admin login | Not verified by the browser tools. The user reported success, but the shared browser still showed the sign-in form and no token, so the result is not claimed as passed. |
| Staging Operator login and live UI workflows | Not performed. No password was collected or entered by the agent. No real inventory records were changed. |

The database checks above report aggregate counts only. The integration suite uses a uniquely named temporary database and removes that database during cleanup.

## Remaining issues and required actions

1. **Production JWT secret still must be set outside this workspace.** The local staging `.env` now has a generated secret and startup rejects placeholders/short values. Set a separate unique secret in the production platform’s protected environment/secret manager, apply the same value to all API instances, and restart them together. Rotation invalidates all existing login and password-reset tokens.
2. **Reset legacy accounts before launch.** The affected accounts are `admin@cosmopolitan.local` and `carcar@cosmopolitan.local`; both exist in staging. Reset each through **Administration → Users → Edit** as an authorized superadmin using unique strong passwords, or use verified email recovery. Do not rerun an old seed script or pass passwords in command arguments. The updated seed script preserves existing accounts; `create-user.js` now reads passwords through a hidden terminal prompt.
3. **Spreadsheet warning remains.** The optional XLSX chunk is 627.17 kB (322.92 kB gzip), exceeding Vite’s 500 kB advisory threshold. It is lazy-loaded; the initial chunk is 359.39 kB (108.92 kB gzip). The package’s Node `Readable` branch is optional and unused by the app; the built production XLSX chunk contains no externalized stream shim or Node stream require. No polyfill or package was added. Excel byte-array read/write and the Blob download helper were browser-tested, and the isolated API import workflow passed; authenticated spreadsheet import/export screens still need staging verification.
4. **Historical transfers:** the configured staging database contained three transfer requests, all approved, and none pending/approving. No action was needed. Isolated tests cover automatic batch approval and destination receipt; live UI transfer/receipt remains unverified.
5. **Live staging workflow sign-off is still required.** Admin login was self-reported as successful, but not confirmed by the shared browser state. Operator login, camera scanning, asset import/export, reports/filters, and UI transfers/receipt/relocation remain unverified.

Environment inspection was value-redacted: `MONGODB_URI`, `APP_URL`, and SMTP settings are present. The staging `JWT_SECRET` was rotated and checked without displaying it; seed password variables and explicit `CORS_ORIGINS` are absent. No secret values were copied into this report.

## Staging deployment checklist

- [ ] Configure a unique, high-entropy production `JWT_SECRET` in the deployment secret manager; confirm no placeholder/default remains. Apply it consistently to all API instances and plan for all users to sign in again.
- [ ] Configure `MONGODB_URI` to the intended staging database and confirm replica-set/transaction support.
- [ ] Set `APP_URL`, exact `CORS_ORIGINS` as needed, and production SMTP values; verify recovery email delivery without exposing secrets in logs.
- [ ] Reset any accounts that may have used credentials from the legacy seed script. Create staging Admin and Operator users with distinct credentials.
- [ ] Sign in as Admin and Operator; verify branch scoping, denied cross-branch access, audit permissions, session expiry, and sign-out.
- [ ] In staging only, register a disposable asset, edit it, generate/print a QR label, scan it with a device camera, and verify the resolved asset and branch.
- [ ] Run a staging inventory session, scan assets, check duplicate/wrong-branch outcomes, and compare report totals with the seeded records.
- [ ] Submit a multi-asset transfer with a reason; verify automatic approval, source/destination locations and codes, destination receipt, and updated reports.
- [ ] Exercise spreadsheet import, asset export, and audit/report exports using test files; confirm workbook contents and totals.
- [ ] Verify asset deletion/relocation and transaction rollback only with disposable staging records; confirm cleanup leaves no test records.
- [ ] Repeat `npm test`, backend syntax checks, and the client production build against the final deployment candidate.
- [ ] Obtain an authorized operator/admin sign-off for the staging workflows before promoting the release.

## Deployment and rollback

1. Store the production `JWT_SECRET` in the hosting platform’s protected environment-variable or secret manager, not in source control or build arguments. Use a unique random value of at least 32 characters; never reuse the staging secret.
2. Set `MONGODB_URI`, `APP_URL`, exact `CORS_ORIGINS`, SMTP configuration, and any initial seed credentials using the platform’s protected configuration. Do not run `npm run seed` against production unless intentionally provisioning missing branches/accounts; it preserves existing users.
3. Deploy the validated client and server build. Restart all API instances together after setting the secret. Confirm health, trusted-origin behavior, and fresh login before opening traffic.
4. Notify users that existing access tokens are invalid after JWT rotation. Do not restore legacy/shared passwords; use account-specific resets through the admin UI or email recovery.
5. If the deployment fails, roll back the application build while retaining the secure environment variables and compatible database. If the new JWT secret itself must be rolled back, restore only a known-good secret from the protected secret manager, apply it consistently, and restart every API instance; sessions signed after the rotation will become invalid. Never roll back to the known placeholder or a legacy shared secret.

Production promotion remains blocked until the production secret is configured, legacy account passwords are reset, and authorized staging Admin/Operator workflows are evidenced as passing.
