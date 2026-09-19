# Codex session and turn reading layout

## Security and compatibility contract

This is a presentation update to the existing logged-in, private Codex session and turn pages. It adds no routes, mutations, machine principals, capability assignments, object access, persistence, telemetry or outbound services. Existing authentication, capability/object policies and CSRF controls are retained; this is not a replacement of the legacy session authorization model. Turn reads continue to use their existing capability and owner/admin checks.

The four existing page/JSON read handlers add `promptHtml` and `responseHtml` after loading authorized data. Original prompt/response strings remain unchanged. The server uses the installed marked and sanitize-html dependencies, with a transcript-specific tag/attribute allowlist. Scripts, events, styles, embedded resources, forms, SVG, image requests and unsafe link schemes are inert. Explicit local links and HTTP(S) links remain usable; external links receive noopener/noreferrer. No client Markdown parser or dependency is added. Parsing is limited to 100,000 characters; longer legacy text is shown in full as escaped plain text. Rendering failures fall back to escaped text and emit a content-free warning through the shared logger. Cache, retention, private storage and analytics policies remain unchanged.

Session cards retain status, Open/Cancel/Retry, live progress and the entire response while collapsed. Native disclosures contain the prompt, metadata and token breakdown. Disclosure nodes/open state and unchanged response nodes survive polling. Follow-up is collapsed initially and retains form state while toggled. Process Details is removed only from the session view; its turn-page markup and event controls are unchanged.

## Validation and release

Use the focused transcript, detail-client, request-controls and event/remaining-usage Jest suites, then the full suite with coverage. The optional `tests/browser/codexDetails.smoke.js` uses synthetic local HTTP fixtures and an externally installed Playwright/Chromium, without importing app.js or contacting MongoDB. It exercises phone/desktop widths, keyboard disclosures, Markdown, controls, polling and the retained turn Process Details UI.

Normal application release/restart is sufficient; no migration, dependency installation or environment changes. No production deployment or production data access is part of this work. Browser fixtures and mocked database tests do not establish live MongoDB, physical-device, Safari or assistive-technology compatibility.

## Turn document scrolling

The turn page uses document scrolling for the transcript, Activity/Issues feeds, raw events and work summary. Previously the feed combined `overflow-y: auto` with `overscroll-behavior: contain`; the mobile breakpoint removed its height cap but left scroll containment active. Desktop feeds/raw events/sidebar and nested code/log output also had independent height caps. Synthetic Chromium checks reproduced zero document movement for wheel and touch gestures inside the original feed at 320, 390 and 1440px.

Overrides in `codex.css` are scoped to `[data-codex-page='turn']`. Content expands vertically, code/log lines wrap, and Markdown tables retain local horizontal scrolling. The work summary is no longer sticky or height-capped. Native disclosures, textarea/dialog scrolling, content limits, server rendering, queries and other Codex pages are unchanged. The client uses document-relative feed bounds to defer updates while reading history, and the order/new-updates controls scroll the document to the appropriate feed edge.

Run `tests/browser/codexTurnScroll.cjs` with `PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE` and `BOOTSTRAP_CSS` pointing to external Playwright/Chromium and Bootstrap 5.3.3 CSS. It serves synthetic content over loopback, blocks external requests and exercises the real template, inherited local styles, client polling, wheel and emulated touch. It checks long Markdown/code/logs, raw events, sidebars, overflow, disclosures, tabs, live-update deferral, retained drafts and CSRF-bearing actions. `CODEX_SCROLL_BASELINE=1` records feed gesture movement without enforcing fixed-layout assertions, for comparing the pre-fix revision. Screenshots go to `/tmp`, not the repository. This is not a live authenticated or physical-device/Safari test.

Deploy the CSS and client script together through the normal release process. Restart loads the new content-hashed `codex.js` form asset; reload open pages. `/css/codex.css` is not content-hashed, so verify browser/proxy CSS revalidation and purge that asset if a deployment cache retains the old bytes. No deployment or cache mutation is performed by these tests.
