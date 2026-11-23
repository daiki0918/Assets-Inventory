# Gemini Asset Analysis Implementation Plan

> **For agentic workers:** Implement task-by-task in this plan. The existing Gemini design is the requirement source.

**Goal:** Replace the asset scanner's OpenAI image-analysis call with Gemini while preserving the existing scan, review, and registration flow.

**Architecture:** Keep the provider call on the server and use the native Gemini `generateContent` REST endpoint with `x-goog-api-key`, JPEG inline data, and JSON-schema output. Keep the existing `/api/assets/analyze` request and response fields so the client does not need provider-specific changes.

**Tech Stack:** Express, Node built-in `fetch`, Gemini Developer API `generateContent`.

**Spec:** `docs/superpowers/specs/2026-11-23-gemini-asset-analysis-design.md`

## Global Constraints

- Keep the Gemini API key server-side; never print, log, or commit it.
- Do not modify or read the value in `server/.env`.
- Continue to leave unsupported fields blank, validate model output, and save assets only after user confirmation.
- Keep manual registration available when provider analysis fails.

## Review Focus

- Missing key/model setting returns a configuration error without making a provider request.
- Invalid key, unavailable model, quota/rate limit, or malformed request yields an actionable Gemini-specific error.
- Gemini block/no-candidate or malformed JSON returns a safe analysis error and does not save an asset.
- Valid structured JSON returns only the existing whitelisted fields.

---

### Task 1: Switch the server provider

**Files:**
- Modify: `server/server.js`
- Modify: `server/.env.example`

**Interface:**
- Preserve authenticated `POST /api/assets/analyze` with `{ image: dataUrl }` and its existing response shape.
- Require `GEMINI_API_KEY` and `GEMINI_VISION_MODEL` on the server.

- [x] Replace the OpenAI Responses request with `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, authenticate with `x-goog-api-key`, and pass JPEG bytes as `inlineData`.
- [x] Request `application/json` with the existing field schema; parse the candidate text, whitelist/trim fields, and keep uncertain values empty.
- [x] Map Gemini auth, model, quota, and request errors to safe, actionable messages; preserve timeout, rate limiting, photo validation, and no-write behavior.
- [x] Replace OpenAI variables with `GEMINI_API_KEY` and `GEMINI_VISION_MODEL` in the example environment file.
- [x] Run `node --check server.js` and inspect `git diff --check`.

### Task 2: Update setup documentation

**Files:**
- Modify: `README.md`

- [x] Document the Gemini environment variables, server restart requirement, and that the Gemini key must not be put in the client or shared in chat.
- [x] Confirm the README describes the native Gemini provider and continues to describe the existing review-before-save flow.

Final review: author self-review; independent reviewer was unavailable due to the current usage limit. The user's existing `server/.env` was left untouched; set a newly issued Gemini key there after revoking the exposed credential.
