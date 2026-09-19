# Codex session and turn reading layout

## Security and compatibility contract

This is a presentation update to the existing logged-in, private Codex session and turn pages. It adds no routes, mutations, machine principals, capability assignments, object access, persistence, telemetry or outbound services. Existing authentication, capability/object policies and CSRF controls are retained; this is not a replacement of the legacy session authorization model. Turn reads continue to use their existing capability and owner/admin checks.

The four existing page/JSON read handlers add `promptHtml` and `responseHtml` after loading authorized data. Original prompt/response strings remain unchanged. The server uses the installed marked and sanitize-html dependencies, with a transcript-specific tag/attribute allowlist. Scripts, events, styles, embedded resources, forms, SVG, image requests and unsafe link schemes are inert. Explicit local links and HTTP(S) links remain usable; external links receive noopener/noreferrer. No client Markdown parser or dependency is added. Parsing is limited to 100,000 characters; longer legacy text is shown in full as escaped plain text. Rendering failures fall back to escaped text and emit a content-free warning through the shared logger. Cache, retention, private storage and analytics policies remain unchanged.

Session cards retain status, Open/Cancel/Retry, live progress and the entire response while collapsed. Native disclosures contain the prompt, metadata and token breakdown. Disclosure nodes/open state and unchanged response nodes survive polling. Follow-up is collapsed initially and retains form state while toggled. Process Details is removed only from the session view; its turn-page markup and event controls are unchanged.

## Validation and release

Use the focused transcript, detail-client, request-controls and event/remaining-usage Jest suites, then the full suite with coverage. The optional `tests/browser/codexDetails.smoke.js` uses synthetic local HTTP fixtures and an externally installed Playwright/Chromium, without importing app.js or contacting MongoDB. It exercises phone/desktop widths, keyboard disclosures, Markdown, controls, polling and the retained turn Process Details UI.

Normal application release/restart is sufficient; no migration, dependency installation or environment changes. No production deployment or production data access is part of this work. Browser fixtures and mocked database tests do not establish live MongoDB, physical-device, Safari or assistive-technology compatibility.
