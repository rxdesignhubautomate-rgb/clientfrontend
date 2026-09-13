# Frontend 1.15.1 — Batch progress

Each Marketing batch card shows a compact green progress bar, processed/total contacts, percentage, queued and failed counters. Delivered, read and replied counts appear below. Progress refreshes every five seconds while Marketing is visible; it updates the card only, preserving the Preview modal. Failed refreshes retain previous values and retry after 15 seconds.

Processing counts come from enrolled total minus active/waiting recipients, so overlapping provider failures are not double-counted. A full bar means batch processing is complete, not that every message was delivered. Drafts stay at zero and the last partial batch uses its own total. Existing backend stats.sent represents queued messages, so the UI labels it queued.

Includes all previous frontend stability, speed, caching, typing and simple Marketing changes. Uses the existing backend APIs; no new backend deployment is needed for the bar. Keep backend 2.16.0 from the stability update for its worker improvements.

Deploy this folder to Vercel: npm run build; output dist. Preserve CRM_API_BASE_URL=https://rxclientsbases.onrender.com/api/v1. Reload after deployment. This package has not been deployed by this task; no messages were sent or batches restarted.

34 frontend tests and production build passed, including draft/paused/partial-batch counts, overlapping failures and stale polling responses. Batch-Progress-Preview.html is a static demo with sample counts.
