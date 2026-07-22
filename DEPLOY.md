# RX Client CRM frontend deployment

1. Deploy the backend smart-policy release first.
2. In Vercel, import this frontend project or upload the project files.
3. Set `CRM_API_BASE_URL=https://rxclientsbases.onrender.com/api/v1` for Production.
4. Redeploy without using an old build cache.
5. Open **Marketing** and click **Sync from Meta** before starting a campaign.

The campaign workflow is: **Draft → Submit → Approve → Schedule/Start**.

Only Meta templates with an **Approved** status can be used for template sends. Transactional update forms require real Firestore order or quotation IDs linked to the selected customer.
