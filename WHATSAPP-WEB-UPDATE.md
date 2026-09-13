# WhatsApp interface update — 7 September 2026

The WhatsApp workspace now uses the full window, with a slim navigation rail, familiar chat controls, contact initials, unread badges, incoming/outgoing message bubbles and a compact composer. The sales dashboard remains available through its navigation button. On mobile, use Back to return to chats, then CRM in the footer for the dashboard. Account opens the existing CRM login controls.

Drafts appear in the chat list and remain available when switching conversations within the current page session. The composer shows Send when text or an attachment is ready, and the voice button when it is empty. The attachment panel separates photos/videos, documents, audio and product sample links. Live message status continues to use the backend's recorded WhatsApp receipts.

The preview has six clearly labelled sample conversations. You can type messages, insert sample links, and quote/reply to messages. Messages sent in the preview are held only in that page's memory, show a Preview label, and make no request to the live send API. They remain when switching sample chats and reset when the page reloads. File sending and microphone recording require signing in to the real CRM.

This update implements the selected design/chat-feature scope. It does not add QR pairing, WhatsApp voice/video calls, groups or presence. The telephone icon opens the device's dialer for real contacts.

Live media, replies and delivery receipts require the previously supplied updated backend and its Firestore indexes. The code review's outstanding sequence/authentication findings are not resolved by this interface change. The Render backend has not been edited or deployed in this UI update.

## Installation

Upload the full frontend project, including `build.cjs`, `package.json`, `package-lock.json`, `vercel.json` and `public`. Run `npm ci` then `npm run build`. The included Vercel configuration publishes `public`; other static hosts can publish `dist`. The MP3 encoder and license are copied during the build.

Use `?preview=1` on the frontend URL while signed out to open the sample conversations. The normal URL retains the real CRM sign-in flow.

Validation: 15 frontend behavior checks cover startup, navigation, preview isolation, preview reply persistence, draft display, attachment choices, account controls, stale responses, duplicate submission handling, safe rendering, and audio encoding. The production build is also checked. Live WhatsApp delivery and visual browser QA are outside these isolated checks.
