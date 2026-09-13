# RX CRM WhatsApp upgrade

Prepared 6 September 2026 from your two uploaded source ZIPs.

## What is ready

The frontend now opens a WhatsApp-style workspace with a conversation list, chat search, unread/hot filters, incoming and outgoing bubbles, dates, contact details, per-chat drafts, emoji selection, sample-link selection, message search, quoted replies, and older-message pagination. The existing dashboard, lead editor, login and sales arena remain accessible through the Dashboard and Account buttons.

The updated backend adds incoming attachment storage, outgoing files, voice audio, message IDs, status receipts, unread counters and chat ownership checks. Human replies pause AI and scheduled product messages. Repeated submissions with the same client message ID do not create a second send. A network failure with uncertain delivery is shown as uncertain, rather than claiming that the message was delivered.

The original Render service and Vercel deployment have not been updated. The private Sites page is a separate frontend deployment. Choose **Preview chat layout**, or append `?preview=1` to its URL, to inspect clearly labelled fictional conversations without sending any customer messages.

## Install the backend update

1. Extract `rx-whatsapp-backend-updated.zip` and use its contents in your existing backend repository. Keep the Render environment variables and service credentials in Render. No private `.env` file is included.
2. Create the two Firestore composite indexes in `firestore.indexes.json`: `messages` on `leadId` ascending + `timestamp` descending; `leads` on `assignedTo` ascending + `lastMessageAt` descending. Use the Firestore console, or your existing Firebase CLI configuration. An optional CLI configuration is included as `firebase.chat.json`; run `firebase deploy --only firestore:indexes --config firebase.chat.json --project YOUR_EXISTING_FIREBASE_PROJECT_ID` after selecting the correct existing project. Wait for the indexes to finish building.
3. Deploy the updated backend to your existing Render service using its normal build/start settings (`npm ci`, `npm start`). Keep the existing webhook URL and WhatsApp account configuration.
4. Check `/health`, then sign in with a genuinely approved CRM device. The new `/api/chats/config` endpoint returns `version: 1` when authenticated. The new chat routes reject the old header-only device bypass. Existing approved device records are supported.
5. Verify a conversation using a test customer before everyday use: incoming text, a sent text and its status, an uploaded image/document, a voice recording, a quoted reply, and an opt-out. These actions will send real messages when performed after login.

## Install the frontend update

1. Extract `rx-sales-crm-frontend-updated.zip` into your existing frontend repository.
2. Run `npm ci` and `npm run build`. Keep the included `build.cjs` and package lockfile. This copies the MP3 encoder and its license, then builds `dist`.
3. The existing Vercel configuration serves `public`, which is also prepared by the build. For another static host, publish `dist`.
4. The backend address in `public/assets/app.js` remains your existing Render URL. Keep account configuration consistent with your backend.

If the frontend is used before the backend update, it falls back to the existing text/history API only when the chat configuration endpoint returns 404. The interface explains that attachments, receipts, quoted replies and unread counts require the backend update. An authentication or server error is displayed, rather than silently bypassed.

## Sample links

All eight product names and their current URLs are listed in `current-sample-links.txt`. The picker has **View samples**, **Add to message**, and **Copy link** actions. Adding a sample only inserts it into the draft; the salesperson chooses when to send it.

No replacement URLs were supplied, so the existing links are preserved. To change them, edit the product `sampleLink` values in backend `services/knowledgeBase.js` and the fallback `SAMPLE_LINKS` in frontend `public/assets/chat-utils.mjs`. The updated backend supplies the live picker values; the frontend list supports preview and legacy mode. Link destinations were not verified.

## Scope and operational limits

- This is a WhatsApp-style CRM using your WhatsApp Cloud API integration. There are no WhatsApp voice/video calls, presence indicators, group chat features or phone-app history import. The call icon opens the device's telephone dialer.
- Chats refresh every eight seconds while the page is visible. Search applies to loaded conversations/messages; load more history when needed.
- The new send routes require an open 24-hour customer reply window and block opted-out contacts. The screen explains an expired window; a template composer is not included.
- File limits are 5 MB for JPEG/PNG photos and 16 MB for supported videos, audio and documents. Viewing an attachment also has a 16 MB limit. Voice recordings need microphone permission and HTTPS or localhost; they stop at two minutes and are previewed as MP3 before sending.
- Unread counts are per sales role and count messages received after the upgrade. Older messages without saved WhatsApp IDs do not gain historical delivery receipts. Previously discarded media cannot be recovered by this update. Expired WhatsApp media displays an unavailable message.
- Drafts and unsent attachments are held in the current page session, not persisted after a reload. Sending a human reply pauses AI until it is explicitly re-enabled in the CRM.
- The original application's broader security and reliability findings still need attention, including embedded frontend access configuration, existing device bootstrap behavior, webhook signature verification, and durable webhook processing. The new chat ownership checks do not replace the whole authentication system. Do not interpret this interface upgrade as a complete security remediation.
- The backend lockfile audit reported 12 dependency advisories (11 moderate, 1 high). Dependencies were not force-upgraded as part of this change. The frontend MP3 package is `lamejs` 1.2.1; its license is included.

## Validation completed

25 automated checks passed using the real chat modules and an isolated fake database/WhatsApp transport. These cover complete CRM/module startup, view switching, session gating, preview behavior, draft retention, stale response isolation, sample insertion, access removal, duplicate submissions, message reconciliation, MP3 encoding, inbound media parsing, foreign-number events, unread counters, cursor pagination, early/out-of-order receipts, role restrictions, reply ownership, upload handling, opt-outs, reply-window enforcement and AI pause behavior.

No real customer message was sent during development. Live Meta/Firebase integration, microphone hardware and visual browser QA have not been exercised. The backend's complete original review remains in the earlier review deliverable; some findings were addressed here, but the upgrade is not a full re-audit.
