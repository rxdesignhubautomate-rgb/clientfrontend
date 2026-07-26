# RX Client CRM frontend v1.2 deployment

1. Deploy backend v2.1 first.
2. In Vercel, import this frontend project or upload the project files.
3. Set `CRM_API_BASE_URL=https://rxclientsbases.onrender.com/api/v1` for Production.
4. Redeploy without using an old build cache.
5. Sign out and sign in again so the refreshed session contains the current permissions.
6. Open **WhatsApp Inbox**, click **Enable alerts**, and allow browser notifications.
7. Open **Marketing** and click **Sync from Meta** before starting a campaign.

The campaign workflow is: **Draft → Submit → Approve → Schedule/Start**.

Only Meta templates with an **Approved** status can be used for template sends. Transactional update forms require real Firestore order or quotation IDs linked to the selected customer.

If an older backend is temporarily deployed, the frontend automatically uses legacy campaign routes and keeps the Marketing page available. Advanced policy controls activate after backend v7 is live.

Sales-user assignment is also non-blocking: a temporary `/users` failure will not blank the Marketing page.

## WhatsApp workspace

The matching backend enables media/voice notes, quoted replies, reactions, location and contact sharing, interactive quick-reply buttons, reusable quick replies, internal notes, assignment, tags, Important status, follow-ups, desktop alerts, and linked order updates.

Browser microphone, location, and notification permissions are granted per device. WhatsApp Business App coexistence, calling, Flows, catalog/commerce, and payments still require separate Meta account setup and eligibility; deploying this frontend does not enable them.
