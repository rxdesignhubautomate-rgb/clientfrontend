# Client CRM — WhatsApp reference style

This package applies the visual style from `rx-sales-crm-quick-circle-filters-v14.zip` to the existing `clientfrontend-main` application.

## What changed

- Compact icon navigation, matching the reference rail; all existing routes and owner-only visibility remain available.
- Full-height WhatsApp inbox with the header, search and filters inside the conversation pane.
- Reference colours, system typography, circular avatars, light chat headers, green outgoing bubbles, and rounded message controls.
- All, Unread, Open and Important filters with counts; label filtering uses existing client tags, and circular owner shortcuts use active users returned by the client CRM. Clicking a selected owner clears that owner filter.
- Search, status, label and owner filters work together. Counts describe loaded conversations; the summary distinguishes unread chats from unread messages.
- The client workspace opens from the information icon. It retains orders, assignment, tags, notes, follow-ups and profile access.
- On phones, the conversation list and chat have separate screens with a working back link. A hidden selected chat is not marked read while viewing the list.
- The overview, client directory, profiles, forms, marketing surfaces and sign-in screen share the reference palette and spacing.

## Existing connections and workflows

The original authentication, API requests, messaging, media uploads, recording, template rules, marketing workflows, imports, client operations and chat-cache code are retained. The mobile read guard is the only change to a read-status operation.

The original API default remains:

`https://rxclientsbases.onrender.com/api/v1`

The existing `CRM_API_BASE_URL` build setting, `vercel.json`, package manifest, lockfile and build/development scripts are unchanged. No new runtime dependency is required. This frontend ZIP does not modify the backend or migrate data.

## Files and deployment

- `src/whatsapp-style.css` contains the reference theme over the existing stylesheet.
- `src/inbox-style.js` contains icons, avatar colours and pure filter helpers.
- `src/app.js` and `src/index.html` integrate the theme with the existing UI.
- `dist/` contains the matching, rebuilt frontend, including the new stylesheet and module.
- `tests/style.test.mjs` contains the focused regression checks.

For your existing Vercel project, use the extracted `clientfrontend-main` folder as the project root and retain its current deployment configuration. The existing build command is `npm run build`, with `dist` as the output directory. Preserve your current `CRM_API_BASE_URL` environment setting if it differs from the default. Deploy all built files together; the app now imports `inbox-style.js` and loads `whatsapp-style.css`.

For local use, run `npm run dev` and open the address printed by the existing script. That script uses port 4173 and rebuilds at startup.

## Validation

- Production build passed.
- JavaScript syntax checks passed.
- All 8 focused tests passed: combined filtering, separate unread counts, active-owner shortcuts, safe avatar styles, escaped rendering and retained controls, reply drafts, mobile read behaviour, and empty inbox rendering.
- All 192 original application functions remain; 182 are unchanged. The changed functions cover presentation, filters, UI state and the mobile read guard.
- Source and built-file parity, referenced assets, unique static HTML IDs and stylesheet delimiter checks passed.

Run the tests with `node --test tests/style.test.mjs`.

Authenticated browser flows and real backend operations were not exercised. Verify sign-in, a client conversation, client-workspace actions and sending with your normal test account before replacing the live frontend. No live messages were sent during this update.
