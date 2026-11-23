# Mobile AI Scan Lens Design

## Intent

Let staff scan an asset from a phone, use Gemini vision to extract only visible or confidently identifiable information, review and edit the result, then register it through the existing asset API.

## Goals

- Provide a mobile-only Scan Asset entry point and full-screen camera/capture/review flow.
- Reuse the existing QR scanner and resolve known asset codes before offering registration.
- Extract OCR and visual candidates for asset name, category, brand, model, serial number, description, type, and condition. Keep uncertain or unreadable values blank.
- Reuse the registration form and existing photo storage, tag generation, and QR generation.
- Let the user review, edit, and explicitly save; scanning alone must never create an asset.
- Keep desktop asset registration behavior unchanged.

## Non-goals

- Automatic registration without confirmation.
- External product catalog lookups or unsupported claims about an asset.
- Replacing the existing asset registration workflow.

## Approaches

- **Native Gemini REST (selected):** Gemini image input and structured JSON output from a server-side request; keeps the API key off the phone and avoids adding an SDK.
- **Gemini OpenAI-compatible API:** retains more of the existing request shape, but relies on compatibility behavior that may differ from Gemini's native API.

## Design

1. Add a mobile-only Scan Asset action near the asset register entry point. Keep desktop unchanged.
2. Extend the existing camera overlay with capture, retake, cancel, flashlight where supported, and manual registration fallback. Reuse its camera permission and QR resolution behavior.
3. If a scanned QR/barcode resolves to an existing asset, navigate to its details. Otherwise capture a compressed JPEG and submit it to an authenticated server analysis endpoint.
4. The server calls Gemini using `GEMINI_API_KEY` and `GEMINI_VISION_MODEL`. Constrain the response to known fields and empty strings for unknowns; validate response shape and input size before returning it. Do not persist during analysis.
5. Prefill the existing registration form, show the captured photo, and allow editing. Add persisted `brand`, `modelNo`, and `assetType` fields only if they cannot fit the existing schema without losing their separate values; keep inferred condition optional and clearly reviewable.
6. On confirmed save, use the existing asset creation endpoint for unique inventory tag/QR generation. Add server-side duplicate serial checks because the current creation flow does not enforce them. Store the compressed source photo in the asset record.
7. Keep barcode/QR support with a browser-native detector when available and a compatible fallback, preserving the current QR scanner path.

## Constraints and safety

- The Gemini key remains server-side and is never returned to the browser.
- Captured photos are sent to Gemini only for analysis and saved only when the user confirms registration.
- AI output is untrusted input: whitelist fields, validate lengths and enumerations, and never let the model create tags, identifiers, or database relationships.
- Duplicate serial detection must be checked on the server as part of the save path; the current asset schema has no unique serial constraint, so this must be added safely.
- Camera and flashlight availability vary by device; capture and manual registration remain available when unsupported.

## Build sequence

1. Confirm asset schema and registration API invariants, including serial duplication and image limits.
2. Add and validate the server-side vision analysis endpoint and environment configuration.
3. Add mobile capture/review states and route unresolved scans into the analysis endpoint.
4. Prefill the registration form and persist distinct extracted fields with confirmed saves.
5. Add existing-code lookup and supported barcode handling; ensure newly registered records continue receiving QR codes.
6. Verify focused API and UI paths, including unknown fields, duplicate serials, unavailable camera/flash, invalid AI output, and desktop unchanged.

## Open implementation choices

- Use the configured Gemini model from an environment variable so deployments can select a supported vision model without exposing it to the client.
- If the form has no separate field for asset type, add the smallest schema and form extension needed; avoid unrelated asset model changes.
