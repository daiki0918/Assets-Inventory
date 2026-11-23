# Gemini Asset Analysis Design

## Intent

Use the user's Gemini API key for the mobile asset-photo analysis flow, replacing the OpenAI request that currently causes a 401 when given a Gemini key.

## Goals

- Preserve the existing scan, QR lookup, editable review form, explicit save, and manual fallback behavior.
- Send the captured JPEG to Gemini from the server using the Gemini API key, never from the browser.
- Return the same whitelisted asset fields: `name`, `category`, `brand`, `modelNo`, `serialNo`, `description`, `assetType`, and `condition`.
- Keep unknown or uncertain fields empty and keep server-side response validation.
- Provide helpful Gemini-specific authentication, model, quota, and request error messages.

## Approaches

- **Native Gemini REST API (selected):** call `generateContent` with Gemini's `x-goog-api-key` header, inline image data, and JSON response schema. This matches Gemini's native API and needs no client or server SDK dependency.
- **Gemini OpenAI-compatible API:** retain more of the existing request shape, but rely on compatibility behavior that may differ from native Gemini structured output.

## Design

1. Replace the OpenAI Responses call and response parsing in `analyzeAssetImage` with Gemini `generateContent` request/response handling.
2. Use `GEMINI_API_KEY` and `GEMINI_VISION_MODEL` in the server environment; update `.env.example` and README setup instructions. Do not read, copy, log, or echo the current key.
3. Convert the validated JPEG data URL to Gemini `inlineData` and request JSON output matching the existing field schema. Validate the returned JSON before passing it to the existing review form.
4. Preserve the `/api/assets/analyze` route and its authentication, rate limit, photo validation, manual fallback, and no-write-before-confirmation behavior.
5. Map Gemini error responses to actionable, safe messages without exposing credentials or logging image data.

## Constraints and rollback

- The Gemini key previously pasted into chat is considered compromised; the user must revoke it and create a replacement before enabling the provider.
- The key remains server-side. Captured photos continue to be sent to the configured provider only when the user requests analysis.
- Rollback is a code revert to the prior provider implementation and restoring provider settings; do not delete or alter user secrets automatically.
- The project `.env` file must not be read into tool output or committed.
