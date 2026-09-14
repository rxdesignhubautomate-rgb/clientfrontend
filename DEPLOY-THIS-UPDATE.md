# RX Client CRM — deploy these updated files

Prepared 14 September 2026. These archives contain the current full source folders, including the latest queue-status and worker-health corrections. They are not just patch files. Existing backend and frontend application versions remain 2.18.0-dev.3 and 1.17.0-dev.3; this package does not claim that every feature in the broader upgrade specification is finished.

## 1. Backend — existing Render service

1. Extract `RX-CRM-Backend-2026-09-14.zip` into its own folder. `package.json` and `src` are at the ZIP root.
2. Copy its contents into your existing backend GitHub repository (`rxdesignhubautomate-rgb/rxclientsbases`) at the same location as the current backend `package.json`. Keep the existing Git history; review and commit the changes. Do not put the ZIP itself in the repository and do not create an extra nested backend folder.
3. In Render, open the existing `rxclientsbases` service. Keep its existing Firebase, Meta, authentication and storage secrets. This package contains no credentials.
4. Check these service settings: Node **24**, build command **npm ci**, start command **npm start**, health check **/health**. Use the existing service, not a new Blueprint/service.
5. For this deployment, verify these environment values:

| Key | Value |
| --- | --- |
| NODE_ENV | production |
| CRM_DIRECTORY_ENABLED | true |
| CRM_MARKETING_UPGRADE_ENABLED | true |
| CRM_MARKETING_DISPATCH_ENABLED | false |
| WORKERS_ENABLED | true |
| CAMPAIGN_WORKER_MODE | internal |
| LEGACY_JOBS_ENABLED | false |
| AI_AUTO_SEND_ENABLED | false |

Preserve other working values. `ALLOWED_ORIGINS` must include `https://rxclientsbases.vercel.app` (keep any other approved origins already present).

6. Choose **Manual Deploy → Deploy latest commit**. Wait for the deployment to finish before deploying the frontend.

## 2. Frontend — existing Vercel project

1. Extract `RX-CRM-Frontend-2026-09-14.zip` into a separate folder. Copy its contents into your existing frontend repository at its current `package.json` location and commit. Do not upload backend files into this repository.
2. In the Vercel project that serves `https://rxclientsbases.vercel.app`, keep the Root Directory pointing to that `package.json`. If the frontend repository contains only these files, the root is the repository root (`.`); use `frontend` only if you intentionally use the backend repository's embedded frontend.
3. Use framework **Other**, build command **npm run build**, output directory **dist**.
4. Set production environment variable `CRM_API_BASE_URL=https://rxclientsbases.onrender.com/api/v1`.
5. Deploy the new commit. If Vercel already deployed it automatically, verify that deployment instead of redeploying the same commit. The included `dist/config.js` also targets this production API.
6. Open the app and use **Ctrl+Shift+R** once to load the new files.

## 3. Verify after deployment

- `https://rxclientsbases.onrender.com/health` should return `status: ok` and worker states. With the settings above, inbound, outbound, media and campaign should show `started: true`. A nonzero failure count and future `retryAfter` mean the worker is backing off: inspect Render logs for its actual error.
- `https://rxclientsbases.onrender.com/ready` should return `status: ready`; HTTP 503 means the database read failed. These endpoints are diagnostics, not proof of message delivery.
- In a queued WhatsApp message, see **Queued** beside the clock. Hover for the known hold reason. Confirm that typing and switching chats still work.
- Marketing should describe the disabled live-sending setting instead of incorrectly calling production data a development database.
- Check Clients and Quotations. The last verified Clients total was **11,545**; subsequent real data changes may change it.

## What changed

- WhatsApp queued/sending text labels and backend-provided hold reasons in the status tooltip.
- A clearer Marketing pause banner.
- Non-secret worker lifecycle/backoff status in `/health` and `/ready`. Worker wrappers now read the actual underlying poll loop.
- Matching frontend source and built assets across the supplied frontend copies.
- Two endpoint regression checks covering actual worker wrappers, quota backoff, recovery, and failed database readiness.

This is an application deployment; **do not import the CSV again**. The approved contact preparation and indexes are already complete. Do not deploy the 611-index planning file or run a broad Firebase rules/index migration for this update.

## Marketing sending remains a separate activation

This update explains queued messages; it does not send them. Keep dispatch disabled until legacy suppression/permission/history reconciliation and the reviewed rollout are complete. Do not toggle it just to remove clocks or repeatedly retry old batches. Those actions can transmit real messages.

Other specification items remain outside these fixes, including complete duplicate merging, the full filter/action catalogue, legacy company reconciliation, broader attribution/report dimensions, retention configuration and full production/provider acceptance. See `docs/crm-marketing-upgrade.md` in Backend for the historical implementation scope; the completed live directory/index work supersedes its older pending notes for those specific checks. The backend dependency audit could not reach the npm registry during the preceding check; no clean security-audit claim is made here.

If a deployment fails, restore the preceding application deployment while preserving production data and settings. Do not remove suppression/history records or disable the marketing-upgrade guard to bypass a sending hold.
