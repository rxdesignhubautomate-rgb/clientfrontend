# WhatsApp CRM feature update — 7 September 2026

The frontend and accompanying backend implement the selected chat-management and messaging tools. The hosted preview uses sample conversations. Production activation requires deploying the new backend, adding its Firestore indexes, and configuring the relevant Meta account assets. The Render backend has not been deployed from this workspace.

## Where to find the new controls

- **Inbox:** New conversation, Favourites, custom label filter and Settings (gear).
- **Contact details:** Mark unread, favourite, labels, gallery, internal notes, assignment, sequence, export, AI/manual mode and WhatsApp block/unblock.
- **Message → More:** Reply, information, reaction and selection for forwarding. Order messages also expose order-status controls.
- **Below the composer:** Saved quick replies, approved templates and an AI reply suggestion that must be reviewed and explicitly sent.
- **Attach:** Multiple files, camera, contact, fixed location, product catalogue and sample links. Each file has its own preview and caption. Photos have an editor.
- **Conversation search:** Whole stored history, media type and date filters. “Search more history” continues through old records; results explicitly show whether the search is complete.

## Selected features and delivery status

| User item | Implementation |
|---|---|
| 1 — Manually unread | Stored separately per approved device/role. Stays unread until reopening. Does not reverse a WhatsApp read receipt. |
| 2 — Favourites, labels, filters | Backend-persisted contact views; sample-mode choices are local to the preview. Filters operate on the loaded inbox pages; Load more exposes further contacts. |
| 3 — Notifications and sound | Opt-in browser notifications and a message tone while the CRM is open. Browser permission is required. No push delivery while the CRM is closed. |
| 4 — Instant updates | Authenticated SSE backed by Firestore listeners, heartbeat, disconnect cleanup, reconnect backoff and polling fallback. Needs backend v2 and a host/proxy that allows streaming. |
| 5 — Persistent drafts | Device-local draft cache for immediate recovery, plus ordered/debounced backend saves. Unsynced drafts stay on the original device. |
| 6–7 — Whole history search and filters | Scoped, paginated search over existing stored history, including older messages without a new search index. Text, dates, photos, videos, audio, documents and links. |
| 8–9 — Gallery and photo viewer | Media/Links/Documents tabs, historical pagination, photo zoom, next/previous and download. |
| 10 — Multiple attachments | Up to 10 files, 50 MB combined; per-file captions and removal. Each file is a separate WhatsApp message. Partial/uncertain sends stop the batch and require review. |
| 11 — Camera and photo editing | Browser camera capture; crop, rotate, draw, text, undo and reset. Edited output is JPEG. Browser camera permission is required. |
| 12 — Searchable emojis | 3,944 fully qualified emojis from Unicode's official dataset, descriptive search and recent emojis. Glyph appearance depends on device support. |
| 13 — Voice controls | Pause/resume recording, microphone waveform, stop/preview, MP3 encoding and 1×/1.5×/2× audio playback. Recording remains limited to two minutes. |
| 14 — Message info | Recorded accepted/sent/delivered/read/received timestamps. Missing historical times are shown as “Not recorded”; no receipt times are invented. |
| 15 — Appearance | Light/dark/device theme, four wallpaper choices and message size 14–22 px. |
| 16 — Shortcuts and touch | Conversation/search/new-chat shortcuts, adjacent-chat navigation, touch hold for actions and swipe right to reply. |
| 17 — Export and attachment management | Full stored conversation JSON export, attachment metadata, individual download, hide/restore within CRM. Hiding does not delete a customer's WhatsApp media or reclaim storage. |
| 23 — New phone-number conversation | Validated international number and ownership checks; no fake 24-hour reply window. Adding a contact does not send a message. |
| 24 — Templates and quick replies | Approved template loading, language, body/header parameters, photo/video/document headers and dynamic URL buttons; saved quick replies. OTP, Flow and copy-code templates need specialised integrations. |
| 25 — Reactions | Outgoing reactions and incoming reaction updates on their source message. Stored reactions do not increment customer unread count. |
| 26 — Contact/location sending | Structured contact cards and fixed coordinates. This is not continuous live location tracking. |
| 27 — Catalogue/orders | Connected Meta catalogue listing and real product cards; incoming order payloads, CRM order status. No payment processing or inventory synchronisation is implied. |
| 28 — Business typing | Real Meta typing/read endpoint, rate-limited, with a user preference. Does not expose the customer's typing/presence. |
| 29 — Forward/share | Explicit recipient and content-permission review, ownership checks on source/destination, 10-message maximum and per-message deduplication. Text/templates-as-text, image, video, audio, documents, contacts and locations. |
| 31 — WhatsApp calling | Official voice Calling API exists; this account's eligibility and calling infrastructure are unverified. Voice/video calls and call history remain unimplemented. Existing phone button opens the device dialer. |
| 32 — Groups/Communities/Channels | Not implemented. Account access is unverified; official Groups docs could not be retrieved in this check. Communities/Channels require separate assessment. |
| 33 — Status/polls/events | No verified implementation; not exposed as working actions. |
| 34 — Customer profile/presence | No customer-photo/About/last-seen/online/incoming-typing integration. Initials remain the avatar fallback. |
| 35 — Edit/Delete for everyone | No verified integration; not simulated by changing a CRM record. |
| 36 — Block, linked devices, history sync | Actual Meta Block/Unblock endpoint implemented, with confirmation of the API result. Linked-device onboarding and old phone-history sync remain unimplemented. Unblocking does not clear customer opt-out. |
| 38 — Sequences | Per-contact plan, default-plan settings for admins, next-step time/countdown, start/pause/resume/stop. Starting/resuming explicitly enables automation. Preview does not run scheduled sends. |
| 39 — Team collaboration | Admin assignment, internal notes and expiring “agent is replying” presence. Notes are never sent to customers. |
| 40 — AI/manual and suggestions | Explicit handling control and a reviewable suggested reply added to the draft. Suggesting a reply does not send it or alter the lead. |

## Backend deployment

1. Deploy the full `rx-whatsapp-backend-features.zip` contents to the existing backend project. Preserve its existing secret environment variables.
2. Apply `firestore.indexes.json` using the included `firebase.chat.json`. It contains the existing inbox/history indexes and a new sequence-status/next-time index. Wait until all indexes are ready.
3. Keep the existing WhatsApp token, phone number, Firebase and AI settings. Add `WHATSAPP_BUSINESS_ACCOUNT_ID` for approved templates and `WHATSAPP_CATALOG_ID` for the connected catalogue. These values do not belong in the frontend.
4. `WHATSAPP_GRAPH_VERSION` is configurable and defaults to `v23.0`. Verify token permissions and account access for messaging, template management, the catalogue and blocking.
5. Keep webhook message and delivery-status subscriptions active. Incoming reactions and order objects are saved by the updated parser.
6. Ensure Render/proxy streaming is not buffered for `/api/chats/events`. Sleeping services and network outages still interrupt live updates; the client reconnects and falls back to refreshes.
7. Keep `SEQUENCE_SCHEDULER_ENABLED` consistent with your intended automation. New sequence settings are persisted in Firestore; current enrolled plans are snapshotted so editing the default does not silently replace them.

Frontend: run the existing `npm ci` / `npm run build` workflow and publish `public` for the included Vercel configuration, or `dist` for static hosting. All new modules, emoji data and the Unicode license are included. No new npm dependency is required.

## Sequence fixes

The scheduler now orders due leads, keeps sparse media slots aligned, avoids forcing a Visual Aid campaign on every first inquiry, refuses automatic re-enrolment, and uses a Firestore claim shared across worker instances. Uncertain delivery or history-write failure pauses for review instead of blindly retrying. It rechecks handling/sequence state immediately before dispatch and preserves a subsequent pause. Already-submitted messages cannot be recalled. Overdue steps are spaced after downtime instead of replayed in a burst. The AI-error fallback rechecks human handling before responding.

The prior broader authentication/webhook audit is separate: this change does not claim to resolve every finding in the original backend review. The new routes use approved-device and lead-ownership checks.

## Validation and limits

51 automated checks cover frontend workflows, preview isolation, history access, receipt timestamps, structured sends, template-media ownership, forwarding, unread state, notes, drafts, stream cleanup and concurrent/uncertain sequence delivery. Camera/microphone hardware, real Meta account eligibility, real message delivery and browser visual QA have not been tested. No customer messages were sent during development.

Preview files/messages are temporary and reset on reload. Preview settings, favourites/labels, quick replies and text drafts are device-local. Real CRM records use the updated backend. While signed out, `?preview=1` opens sample conversations; it does not override an already signed-in session.

## Official references checked

- [Meta: Business Calling API launch and voice capabilities](https://business.whatsapp.com/blog/whatsapp-business-calling-api)
- [Meta: typing indicator and read receipt](https://www.postman.com/meta/whatsapp-business-platform/request/lhf0duq/send-typing-indicator-and-read-receipt)
- [Meta: reactions](https://www.postman.com/meta/whatsapp-business-platform/request/st3lkd6/send-reply-with-reaction-message)
- [Meta: Block Users](https://www.postman.com/meta/whatsapp-business-platform/request/ywjuxcf/block-user-s)
- [Meta: Unblock Users](https://www.postman.com/meta/whatsapp-business-platform/request/uv3p1z9/unblock-user-s)
- [Unicode emoji data](https://unicode.org/Public/emoji/latest/emoji-test.txt)
