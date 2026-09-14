# RX existing-client CRM — smart inbox upgrade

Frontend **1.11.0** · Backend **2.12.0**

The smart inbox workflow from the first Sales CRM has been adapted to the existing-client CRM. The existing client IDs, order workflow, Firebase sign-in, approved Utility templates and Marketing campaign engine remain the basis of this release.

## What is included

| Area | Updated behavior |
| --- | --- |
| Fast inbox | IndexedDB cache, complete initial pagination, paginated incremental sync, server sync cutoff, 15-minute full reconciliation and manual Refresh. Updates beyond the first 100 conversations are no longer dropped. |
| Quick filters | All, Unread, Read, Reply open, Favourites, Due, Closing, Hot, Quotation, Follow-up, Archived; actual owner circles and client labels combine with search. |
| Connect next | Optional priority sorting puts pinned chats first, followed by overdue work, closing windows, unread clients and high-interest clients. Rows show products, stage, draft and reminder hints. |
| Private chat organization | Pin, archive, mute, mark unread and star messages. Preferences belong to the signed-in user. |
| Drafts | Per-client drafts, local recovery and authenticated server persistence. Switching clients does not carry the previous client's draft into the new composer. |
| Chat tools | Search loaded messages, load earlier history, star/copy/use text as a draft, emoji insertion and save a typed reply as a reusable quick reply. Existing quoted replies, reactions, voice, media, location, contact cards and internal notes remain available. |
| Attachments | Select up to 10 files. Each file is queued separately. Changing chats stops the remaining batch; an upload already underway keeps its original recipient. |
| Follow-ups | One-hour, tomorrow and three-day shortcuts; scheduled reminders and Done controls; editable stage, interest and product requirements in the client workspace. |
| AI | Review dialog → Use as draft → agent sends. The AI service produces drafts even if an old deployment has AUTO enabled. It does not automatically send AI replies. An OpenAI key is still required for real suggestions. |
| Manual sequences | Prepare up to three text/media steps directly from a chat. This creates a **DRAFT** campaign for that client. Review, approval and manual start use the existing Marketing screen. These sequences use the open-window delivery mode and existing consent checks. |
| Human takeover | Holds future campaign steps while takeover is enabled. Releasing takeover lets an already-started campaign continue. Client replies/STOP use the existing campaign pause/stop flow. |
| Reliability | Sender scope checks, queued-message suppression/window checks, non-regressing inbound window timestamps, race-safe unread counts, and preserved send keys on retry. A stale outbound claim becomes **Delivery unknown** instead of silently resending. |

The old Sales CRM's hardcoded device/PIN authentication, phone-keyed data model and automatic video enrolment were not copied into this client CRM. AI stays in suggestion mode; sequence preparation does not start delivery.

## Install together

1. Keep a backup of the currently deployed source and database. Extract the new backend and frontend into their respective deployment projects.
2. Deploy the backend's updated `firestore.indexes.json` before sending traffic to the new inbox. It includes the new `outbox(status, lockedAt)` and `followUps(orgId, contactId, status, dueAt)` composite indexes. The existing `npm run firestore:indexes:check` and `npm run firestore:indexes:sync` scripts are available; wait for indexes to become ready.
3. Backend: Node 24, `npm ci`, then `npm start`. The entry point is **src/server.js**. Keep existing Firebase/Meta/OpenAI secrets in the host's environment. Use `AI_DEFAULT_MODE=ASSIST`, `AI_AUTO_SEND_ENABLED=false`, `AI_AUTO_REPLY_ENABLED=false`, `LEGACY_JOBS_ENABLED=false`.
4. Frontend: set `CRM_API_BASE_URL` to the deployed backend's `/api/v1` URL, then `npm run build`. Publish **dist**. The default remains `https://rxclientsbases.onrender.com/api/v1`; change it if using another backend. The supplied dist was built with this existing default, not the local test server.
5. The backend ZIP also includes the same upgraded frontend in its `frontend` folder, replacing its older bundled UI. Use the separate frontend ZIP for the existing frontend deployment.
6. Sign in again and click Refresh once. Verify your own test client's window, owner, reminders and an approved template before using normal campaigns.

The authenticated v1 API is the supported path. Legacy header-authenticated `/api/leads` and `/api/devices` routes are disabled by default. No automatic database migration or merge with the Sales CRM is included.

For **Delivery unknown**, check Meta/provider delivery before deciding to send again. An interrupted provider request cannot always establish whether the client received the message.

## Verification

- Backend: **139 tests passed** across 29 files, including 9 new smart-inbox regressions.
- Frontend: **14 tests passed**, including multi-page sync, failed cursor handling, private drafts, reply-window correctness and retry keys.
- Frontend build and isolated production-startup health smoke check passed.
- Local browser checks used synthetic clients and an in-memory backend: 135 chats loaded, 135-message history paginated, draft restored after switching clients, pin/search, AI review, manual sequence draft, and quick follow-up scheduling.
- Desktop and 390-pixel mobile layouts were inspected. Browser error/warning log was empty during the checked flows.

No live messages were sent and nothing was deployed. Real Firebase indexes, Meta template approvals, provider media delivery and the configured OpenAI account still need deployment verification. No credentials or node_modules are included in the release ZIPs.
