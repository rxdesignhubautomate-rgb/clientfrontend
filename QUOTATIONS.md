# RX CRM quotation update

Backend 2.17.0 / Frontend 1.16.0

## Use
1. Open a WhatsApp chat or a client profile and click Quotation.
2. Choose a product and variety from the sample catalogue, then enter quantity and rate. Custom products and rates are supported, up to 8 items. GST is 18%, matching the supplied sample.
3. Click Done - Preview to review the branded PDF with the sample's logo, bank/UPI details, QR code and terms.
4. Choose Download PDF, Save draft, or Send on WhatsApp. Only the explicit Send button queues a message. The saved PDF is bound to that quotation revision.
5. Use the Quotations sidebar page to find saved PDFs or edit a draft. Search covers the loaded records; Load more fetches older quotations.
6. Sending requires an open WhatsApp 24-hour customer reply window. If it is closed, the saved draft remains available to download/edit and send after the customer replies. Recipient is the linked CRM client/conversation, even if the printed contact field is edited.
7. After sending, use View chat & delivery to see the actual message status. Quotation status Queued is not a delivery receipt. A queued quotation is locked; prepare a new quotation for changed terms. Repeating Send returns the same queued message instead of creating another.

## Deployment
Deploy Backend to the existing Render service first, preserving its current environment variables, Firebase/Storage access and worker configuration. Start command remains npm start. Confirm /health shows version 2.17.0.
Deploy Frontend to the existing Vercel project: build npm run build, output dist. Preserve CRM_API_BASE_URL=https://rxclientsbases.onrender.com/api/v1. Reload the app after deployment.
Both packages are required. Quotations use the quotations orgId/createdAt and orgId/assignedTo/createdAt indexes already included in firestore.indexes.json. If Firestore reports a missing index, enable that included index in the same Firebase project.
No new npm dependency or database migration is required. PDF rendering and the provided fonts/assets are loaded locally when the quotation tool is opened. Attachments use the existing protected Storage upload/download routes. Existing quotes with legacy item subcollections remain readable.

## Included earlier fixes
Simple Marketing, manual batches, batch progress bars, cached chats, typing focus preservation, message status updates and backend worker responsiveness are retained.

## Validation
161 backend tests, 38 frontend tests, changed-backend-file ESLint, frontend production build and production startup smoke check passed. Local browser checks covered catalogue/editor, draft save without sending, invalid row rejection, manual send callback, mobile layout, the actual saved-quotation page, PDF close controls and draft reopening with Firestore dates. The generated PDF was rendered and visually checked. Browser tests used mock data; no live Firebase writes or real WhatsApp messages were made.

These packages are prepared locally and have not been deployed to Render/Vercel by this task. Quotation-Sample.pdf and screenshots are sample previews, not live client records.
