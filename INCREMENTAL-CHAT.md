# RX CRM incremental chat rendering - Frontend 1.16.1

Background updates now patch changed chat rows, message content, receipts and client controls in place. Unchanged rows and message bubbles retain the same DOM nodes. An update to another client does not recreate the active chat. The old deferred full-page repaint after leaving the editor is removed.

Typed drafts, selection/caret, unsaved private notes, file inputs and playing audio/video are preserved during background updates. Signed media URL rotation does not reload a media element for the same attachment. Removed media object URLs are cleaned up. Rebinding updated controls does not multiply click/input handlers.

The API already requests conversation deltas and the active chat's recent message overlap. Polling remains every five seconds, with periodic complete inbox reconciliation for recovery and access changes. Reads can include unchanged overlapping records; these no longer replace unchanged screen elements. This update does not introduce streaming or change backend delivery speed.

Includes the quotation editor/history, previous batch progress, simple Marketing and stability fixes. Deploy this Frontend to the existing Vercel project: npm run build; output dist. Keep CRM_API_BASE_URL=https://rxclientsbases.onrender.com/api/v1. Use the previous quotation backend 2.17.0; no backend change is required for this rendering fix.

Validation: 41 frontend tests and production build passed. A local browser test using the actual app and mocked APIs verified zero child-node changes on an unchanged poll; row identities survive a changed/reordered conversation; existing messages survive a new message/status change; draft selection, unsaved notes and playing audio survive; no full repaint occurs after blur. No live client data or messages were modified. This package is prepared locally, not deployed.
