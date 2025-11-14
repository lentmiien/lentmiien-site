# Project Idea 015 – Public Portfolio & News Feed

## Goal
Publish a curated, public-facing feed that showcases selected projects, media outputs, lessons, and achievements without exposing sensitive data. The feed should pull from the Master Feed with curation controls and render as a shareable microsite or embedded widget.

## Scope Overview
- Define criteria and manual/automated curation workflows to mark internal events as public-ready.
- Build a static-site or server-rendered page (`/portfolio`) that lists highlights with media previews, tags, and call-to-action links.
- Implement export pipelines (RSS/JSON) for syndication.
- Ensure privacy filters redact sensitive information before publication.

## Key Code Touchpoints
- `services/feedService.js` (from Project Idea 012) – extend with public feed filtering and publishing APIs.
- New `models/PublicHighlight` or fields on `FeedEvent` for curation status.
- `controllers/portfolioController.js`, `routes/portfolio.js`, templates under `views/portfolio/*.pug`.
- Static asset handling for images/videos (reuse `public/img`, `public/video` with curated subsets).
- Deployment scripts if hosting the public feed separately (e.g., static export to GitHub Pages).

## Implementation Notes
1. **Curation flags** – Add fields to feed events or a separate collection marking items as public, with metadata (title, summary, hero asset, tags).
2. **Publishing workflow** – Provide an admin UI to approve items. Optionally let agents (Project Idea 010) suggest candidates, but require human approval.
3. **Rendering** – Design a modern landing page with sections (Featured Projects, Media, Lessons). Support pagination and filters.
4. **Syndication** – Generate RSS/Atom or JSON feeds for sharing updates externally. Consider scheduling static-site builds after each publish.
5. **Privacy review** – Add safeguards to strip personal data and check permissions before items go live.

## Dependencies / Follow-ups
- Builds on Project Idea 012’s Master Feed and Project Idea 014’s courseware outputs.
- Update documentation to describe the publication workflow and any external hosting steps.
