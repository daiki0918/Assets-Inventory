# Mobile AI Scan Lens Implementation Plan

> **For agentic workers:** Implement task-by-task in this plan; keep the change focused on the approved design.

**Goal:** Let mobile users capture an asset, receive conservative AI suggestions, review/edit them, and save through the existing asset register.

**Architecture:** Keep camera capture and review in a mobile-only client flow, reuse the existing photo compression and asset registration API, and use an authenticated server endpoint that calls Gemini using server-only configuration. Existing QR resolution should short-circuit registration when the code belongs to an asset.

**Tech Stack:** React, Vite, Express, Mongoose, existing `qr-scanner`, existing data-URL JPEG photo flow, Gemini API via server-side HTTP.

**Spec:** `docs/superpowers/specs/2026-11-23-mobile-ai-scan-lens-design.md`

## Global Constraints

- Never save from a scan without explicit user confirmation.
- Leave unreadable or uncertain fields blank; the model must not invent serials, brands, or IDs.
- Keep the Gemini key on the server and send only the captured photo for analysis.
- Preserve desktop Asset Register behavior.
- Use the existing server photo limit and generated inventory tag/QR flow.
- Validate AI output and duplicate serials on the server.

## Review Focus

- Camera unavailable, denied, or insecure origin: manual registration remains available.
- Unsupported flashlight: scanner controls remain usable without it.
- AI timeout, malformed output, or missing configuration: no asset is saved; user can edit manually or cancel.
- Existing QR or barcode: navigate to the matched record, without a duplicate registration.
- Existing duplicate serials and concurrent registration: uniqueness enforcement must not corrupt or block existing records silently.

---

### Task 1: Vision analysis endpoint

**Files:**
- Modify: `server/server.js`
- Modify: server environment example/documentation if one exists

**Interfaces:**
- Produces: authenticated `POST /api/assets/analyze` accepting `{ image: dataUrl }`, returning only whitelisted string fields: `name`, `category`, `brand`, `modelNo`, `serialNo`, `description`, `assetType`, and `condition`.
- Configuration: server-only `GEMINI_API_KEY` and `GEMINI_VISION_MODEL`; fail with a useful server error when missing.

- [x] Validate JPEG data URL, size, authentication, and request rate before the provider call.
- [x] Call the native Gemini API with instructions to return empty strings for unknowns and JSON only; validate/trim the response before returning it.
- [x] Confirm this endpoint never writes to MongoDB or returns provider credentials.

### Task 2: Persist distinct extracted fields and block duplicate serials

**Files:**
- Modify: `server/models.js`
- Modify: `server/server.js`
- Modify: `client/src/components/AssetModal.jsx`
- Modify: `client/src/pages/Profile.jsx`
- Modify: `client/src/pages/Assets.jsx`
- Modify: `client/src/components/ImportModal.jsx`

**Interfaces:**
- Asset fields: `brand`, `modelNo`, and `assetType` are optional strings; existing `category`, `description`, `serialNo`, and `condition` remain as-is.
- Asset registration request: accepts those fields and the compressed `photoUrl` through the existing POST route.

- [x] Trace current schema, updates, import paths, and indexes before adding fields.
- [x] Add/validate the optional string fields in create/update routes and asset form.
- [x] Add duplicate serial protection that is safe with pre-existing data and concurrent writes; surface duplicates for user correction without saving.
- [x] Preserve existing unique tag and QR creation behavior.
- [x] Expose saved fields on the asset profile and preserve them through list search and CSV/spreadsheet import/export.

### Task 3: Mobile scan, lookup, analysis, and review flow

**Files:**
- Create: `client/src/components/MobileAssetScanner.jsx`
- Modify: `client/src/pages/Assets.jsx`
- Modify: `client/src/components/Layout.jsx` if the mobile entry point belongs in global navigation
- Modify: `client/src/components/AssetModal.jsx`
- Modify: `client/src/styles.css`

**Interfaces:**
- Scanner completion: return a captured compressed `photoUrl` plus the analysis suggestions to the existing registration form.
- Existing codes: use `/assets/resolve-qr`; navigate to `/a/:token` when matched.

- [x] Add the mobile-only Scan Asset entry point and full-screen capture/review states.
- [x] Support capture, retake, cancel, manual fallback, and flashlight where the active camera track supports torch control.
- [x] Detect QR and supported barcodes, resolve existing assets first, then analyze an unrecognized captured image.
- [x] Prefill the registration form, show the photo, and leave all values editable; saving continues through the existing confirmation form.
- [x] Add clear processing, unsupported-device, analysis-error, and duplicate-serial states; keep desktop layout/entry points unchanged.

### Task 4: Focused completion checks

**Files:**
- Review: `server/server.js`, `server/models.js`, `client/src/components/MobileAssetScanner.jsx`, `client/src/components/AssetModal.jsx`, `client/src/pages/Assets.jsx`, `client/src/styles.css`

- [x] Review the final diff against the approved design and confirm no secrets or image data are logged.
- [x] Confirm desktop registration remains unchanged and camera/AI failure paths leave manual registration usable.
- [x] Record any deployment setup required for `GEMINI_API_KEY` and `GEMINI_VISION_MODEL`.

Final review: author self-review; independent reviewer was unavailable. Browser camera behavior still needs a real phone/browser check.

## Execution notes

- Ruling: carry brand/model/type through asset details, search, and import/export so extracted values remain reviewable and reusable; cost: the change touches more existing UI paths.
- Ruling: use `@zxing/browser` for broad 1D/2D decoding because the current dependency only scans QR; cost: adds a runtime dependency whose upstream project describes itself as maintenance-mode.
- Ruling: preserve an empty AI condition as “not recorded” rather than defaulting it to “Good”; cost: scanned registrations can now intentionally store a blank condition.
