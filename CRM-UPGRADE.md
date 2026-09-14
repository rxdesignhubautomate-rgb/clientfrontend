# RX CRM upgrade — development handoff

14 September 2026. Backend **2.18.0-dev.3**; frontend **1.17.0-dev.3**.

This is a tested development build, **not completion of the entire specification and not a production release**. The existing CRM is extended. No production database operations, deployment, customer messages, template submissions or credential changes were performed in this implementation pass. New marketing remains disabled by default.

## Implemented

- Existing/future/premium/inactive/needs-review directory over existing contact IDs, server pagination and overlapping count definitions. Relationship, tier and activity remain independent. Classification, country context, optimistic edits and audits are supported. Canonical permission visibility uses batched reads.
- Qualifying orders promote customers idempotently; cancelled/sample/test orders do not. Earliest/latest verified dates, reconciled order counts and conversation classification propagation are additive. Unknown dates stay unknown.
- Destination-scoped evidence, permission event versions, shared suppression, company restrictions, fresh-evidence restoration and broader stop-all restrictions. Ordinary replies and imports without explicit reviewed evidence never grant permission. Ambiguous stops hold marketing for staff review.
- Versioned dynamic AND/OR groups and static membership, bounded typed filters, previews, exclusions, destination/company deduplication and preferred-contact handling. Conflicting multi-company associations are held.
- Versioned content with sharing-rights/confidentiality checks, expiry and existing media storage. Approval verifies configured text against synced provider components and pins their fingerprint. Template changes invalidate dispatch. Unsupported dynamic headers/buttons are rejected.
- Manual batches of 1–500: group/content/purpose, personalised message/media preview, frozen recipient approval, manual start, pause/resume/cancel and server-side preparation. Progress separates accepted, delivered, read, failed and unknown; terminal progress states do not double-count accepted failures.
- Dispatch rechecks current sender/approver rights, snapshot, content, destination, permission, company restrictions, purpose, quiet hours and rollout controls. Transactions serialize attempts across campaigns. Accepted and uncertain attempts consume frequency protection. Content receipts prevent accidental repeat campaigns.
- Conservative timeout handling: uncertain submissions never blindly retry. Authorised provider-evidence reconciliation records confirmed acceptance/nonacceptance without automatically resending. Early/duplicate/out-of-order receipts are retained. A late failure cannot regress confirmed delivery/read.
- Internal allowlist → small pilot allowlist → reviewed full rollout. Stage changes pause marketing. Separate activation requires the deployment flag, suppression preparation and recent history reconciliation. Development transport blocks actual Meta requests. Internal tests cannot receive business order attribution.
- Follow-up tasks, completion/rescheduling/reassignment, explicit reply outcomes, basic opportunity stages and won-order validation. Optional sample/quotation/interested-reply/premium-review/reactivation rules create tasks only and start disabled. Stable keys and atomic accepted-message events prevent duplicate task creation.
- Client workspace links existing contacts/companies, opportunities, quotations, orders, payments, conversations, marketing history, notes/tasks and recorded client audit events. Account preferences, concerns and premium-review dates have revision checks.
- One-primary-campaign order attribution and source-based financial page reports. Booked value, payments and refunds remain separate by currency with decimal arithmetic. Costs/ROI are not invented.
- Reviewed CSV mapping and resumable 100-row pages: phone text/country checks, duplicate review, idempotent new-record creation, source preservation, no implicit consent, audited scoped page exports and formula protection.
- Existing quotation and incremental chat/cache flows retained. Unchanged polls do not rebuild chat rows/bubbles; typing, caret, private notes and audio survive updates. Unreachable frontend helpers were removed; full lint passes.

## Added in development build 3

- CSV and XLSX worksheets are parsed locally. Mapping supports explicit new records, reviewed field updates and optional permission-evidence records. Duplicate matching never silently overwrites existing data. Selected field changes show before/after and a preview token; stale edits conflict. Import replay cannot restore a later opt-out. An evidence failure is reported separately even if the client row was created successfully.
- Directory city, owner-name picker, relationship, tier and active/inactive/unknown filters, three optional columns, individual selection and **all matching** bulk review. Bulk tier, owner and tag actions freeze the selection in bounded pages and require approval of its digest. Concurrent edits are held. Jobs resume manually, last one day and support cancellation of remaining work. Assignment requires current manager access.
- Version editing/copying and archival for groups/content; group presets and shared group read access. Sharing never grants access to otherwise restricted clients. Static batches support explicit audited resend and multiple-recipient-per-company exceptions for authorised staff; consent, destination deduplication, cooldown and frequency controls still apply. Company-association/preferred-contact changes are checked again at dispatch.
- Client/team/order/quotation pickers; an opportunities list and stage editor using existing leads, linked quotation/order selection, expected value/currency, owner, next action and date. Won requires a qualifying linked order. A paginated timeline combines permitted messages, audits, orders, payments, quotations, opportunities and tasks.
- Complaint tasks hold marketing while any complaint remains unresolved. Explicit resolution decrements the hold transactionally and never grants permission. Existing task completion/reassignment/rescheduling continues.
- Resumable reports scan all orders, payments and opportunities in bounded pages, count repeat-order clients within the selected period, and separate decimal booked/received/refunded amounts by currency. Date, city, service, owner and primary-campaign filters are supported by the API; date/city/service are exposed in the dialog. Staff results exclude inaccessible clients, including hidden/test-record counters. Missing business dates and invalid amounts remain visible quality gaps. Reports are operational scans, not accounting-close snapshots.
- Fixed overlapping bulk/report browser requests, stale result rendering and revoked-access checks. Existing chat DOM, drafts, caret and audio are preserved.
- The legacy contact merge rewrites only one relation page and predates destination evidence. It is blocked when the upgraded directory is enabled or either record is prepared, before any mutation. Duplicate records stay available for review.

## Still incomplete

1. Full directory filter catalogue (speciality/state, order/value/date combinations, tags/stages/permission/active-work combinations), full-text notes search, all optional columns and bulk actions beyond tier, owner and tags.
2. Audited transactional duplicate merge with large histories and concurrent inbound writes. The legacy merge is deliberately blocked for upgraded contacts; CSV/XLSX updates are not merges. Full company-account reconciliation across legacy lookup/import paths and explicit company selection for multiply-associated contacts remain pending.
3. Complex tag any/all and fully nested audience editing UI. Existing advanced filters remain usable but the simple editor refuses unsupported edits. Group sharing exists; selected existing member labels may still show internal IDs. Template dynamic-button/header combinations unsupported by the renderer remain blocked.
4. Complete opportunity-to-order/assisted attribution, full speciality/audience/content-version report dimensions and financial reconciliation against live source history. Report owner/campaign filters are API-only. Operational report scans are resumable but do not lock changing source records or replace accounting reports.
5. Production index review/deployment, real-data reconciliation, migration/cutover rehearsal, authenticated live UI acceptance, account-specific provider verification and an explicitly authorised internal test/pilot.
6. Retention/TTL setup, production latency/load measurements and complete acceptance across every original scenario combination.

Do not describe the entire specification as complete because automated checks pass. Keep the new flags off in production until the required release scope and gates are completed.

## Architecture and definitions

Existing Express/ESM JavaScript, Zod, Firebase Admin/Firestore, Node 24, vanilla JS SPA and Meta Cloud API adapter are reused. Source is an extracted folder, not a verified Git checkout. No applicable AGENTS.md was found in the inspected working source. Existing IDs, auth, orders, payments, quotations, inbox and provider account remain.

Reused collections include contacts, channelIdentities, contactPhoneKeys, leads, orders, payments, quotations, conversations, messages, attachments, templateRegistry, marketingAudiences, marketingCampaigns, campaignEnrollments, outbox, followUps, automationJobs, systemSettings, auditLogs and importKeys.

New evidence/reference collections: marketingPermissions, marketingPermissionEvents, marketingDestinationState, marketingContentVersions, marketingContentReceipts, marketingReplyReceipts, marketingReplyContacts and providerStatusReceipts. Resumable bulk/reports add crmBulkJobs, crmBulkMembers, crmReports and crmReportMembers; import evidence receipts reuse idempotencyKeys. They are not another client database.

Classification uses crmV1Relationship, crmV1Tier, verified activity/order projections and the existing relationshipType compatibility field. Permission keys combine business, WhatsApp, marketing purpose and parsed E.164 destination. Saved phones, prior orders, ordinary replies and spreadsheet rows are not permission evidence. Original phone text is retained on the new import path. WhatsApp reachability is unknown unless verified; no bulk probing occurs.

Overview totals are scoped contact documents. Classification cards count prepared records and overlap. Reply counts cover upgrade-recorded reply history; opt-out totals cover prepared canonical destinations. These are not interchangeable with company counts or legacy totals. Reconciled qualifying-order counts are not complete until the historical scan is reconciled.

Last marketing means provider acceptance, not queue creation or guaranteed delivery. History backfill conservatively uses the latest recorded source timestamp and holds uncertain records. Current recipient states are mutually exclusive; delivery milestones can overlap. Costs remain unavailable. Internal tests use a separate mode and cannot receive business order attribution.

## Files, routes and permissions

Main services: client-classification.js, client-directory.service.js, marketing-safety.service.js, audience-filter.js, crm-marketing-workspace.service.js and crm-contact-transfer.service.js, crm-bulk-clients.service.js, crm-reports.service.js and crm-client-workspace.service.js under src/services. Existing contact/message/marketing/domain/import services, outbound worker, Meta adapter and container/config wiring were extended.

Frontend: src/client-directory.mjs, marketing-workspace.mjs, crm-bulk-ui.mjs, crm-report-ui.mjs, crm-pickers.mjs, contact-import-ui.mjs, contact-file.mjs, contact-file-worker.js, app.js, styles.css and existing DOM/cache helpers. The backend frontend mirror and separate frontend deliverable contain the same current source.

API families: /api/v1/client-directory and /api/v1/marketing-workspace. They cover capabilities/counts, classification, permission evidence, audiences/previews/exports, content versions/approval, campaigns/recipients/actions/reports/finance, tasks/rules/events, reply review, unknown-result reconciliation, company links, account reviews, profile history, opportunity stages and import preview/commit. Added routes include /client-directory/owners, /client-directory/bulk, /bulk/:id/action and /bulk/:id/members; /marketing-workspace/reports and /:id/advance; /lookup, /pipeline, /opportunities, /contacts/:id/timeline, /contacts/:id/complaints; /audiences/:id/sharing; /audiences/:id/archive and /content/:id/archive. Rollout: PUT /marketing-workspace/rollout. Kill switch: PATCH /marketing-workspace/settings.

New server checks include contacts.classify, contacts.tier, contacts.import/export, marketing.read/audiences/content/content.approve/create/approve/send/consent/settings/reconcile , marketing.exceptions and followups.read/write. Existing-contact field updates require contacts.write in addition to contacts.import. Bulk owner changes additionally require OWNER, ADMIN or SALES_MANAGER. Existing orders/payments/leads/quotations permissions and client scopes still apply. Staff permissions require deliberate provisioning. Workers re-read active users and permissions.

Migration scripts: backfill-client-classification.mjs, backfill-client-activity.mjs, backfill-marketing-suppression.mjs and backfill-marketing-history.mjs. Pure modules live in src/migrations.

scripts/plan-marketing-indexes.mjs generates firestore.marketing-upgrade.indexes.json only: **611 candidate indexes, 539 additive**. This is a review plan, not deployed indexes or proof of production query performance. Review quota and actual query plans before authorised deployment.

## Actual verification

| Check | Result |
|---|---|
| Backend npm test | 231 tests in 42 files passed |
| Frontend npm test | 44 tests passed |
| Backend npm run lint | Passed, including frontend source |
| Backend npm run check | Passed; JavaScript syntax, no TypeScript toolchain |
| Backend npm run test:smoke | Local startup/health passed with workers disabled and synthetic configuration |
| Frontend npm run build | Passed with CRM_API_BASE_URL=http://127.0.0.1:3000/api/v1 |
| Directory browser QA | Real local routes/SPA paging/search/review and frozen bulk approval/apply; no external requests/outbound jobs |
| Incremental chat browser QA | Zero child mutations for unchanged poll; row/bubble identities, draft/caret/notes/audio retained |
| Marketing browser QA | Group/content/approval/batch/recipient preview, dedupe, follow-up picker, actual XLSX worker import, report scan and mobile checks; no customer sends |
| Firestore SDK + official emulator | 50,000 synthetic contacts; bounded pages/counts/audience query, frozen approval, concurrent reservation, reviewed worker transaction, atomic task event, combined directory filters, frozen bulk edit conflicts, permission replay after stop, full report scan and shared-group client scope passed |
| Latest emulator query batch | 2,506 ms locally; not a production latency promise |

The emulator does not enforce deployed indexes or reproduce production capacity. Concurrent transaction checks produced retried lock-timeout warnings; the final SDK test process exited successfully. Its SDK emitted a metadata autodiscovery warning; database connection was configured to loopback and checks succeeded. Worker sends were mocked. Browser harnesses blocked nonlocal requests. Real Meta delivery and live-user authentication were not tested.

Host commands: node work/client-directory-ui-qa.mjs; node work/incremental-chat-qa.mjs; node work/crm-marketing-ui-qa.mjs; node work/check-directory-dev-server.mjs; node work/crm-emulator-qa.mjs. Host harnesses use bundled Playwright/Edge. Portable unit suites are included in the delivered folders. Evidence JSON/screenshots contain synthetic data.

## Acceptance mapping — not a blanket pass

| Original case | Evidence / limit |
|---|---|
| 1 Existing flows | Existing auth/orders/payments/quotation/inbox/import regressions pass; live acceptance pending |
| 2 Multiple contacts | Company/destination snapshot dedupe tested; legacy company reconciliation pending |
| 3 Shared phone | Duplicate review without auto-merge tested; merge workflow absent |
| 4 Conversion | Qualifying, idempotent source-order and historical order tests pass |
| 5 Dimensions | Premium customer can remain inactive; covered |
| 6 Unknown consent | Classification and evidence-free imports cannot grant eligibility; explicit evidence/replay guards covered |
| 7 Opt-out | Shared stops, queued cancellation and dispatch checks; no recall of in-flight requests |
| 8 Restoration | Fresh evidence/version checks covered |
| 9 Filters/counts | Supported bounded filters/counts/scopes covered; full catalogue pending |
| 10 Overlap | Contact/OR dedupe covered and overlapping views labelled |
| 11 Frozen audience | Snapshot and forged/extra-message rejection covered |
| 12 Dispatch | Permission, sender, approver, content, purpose, hours and frequency checks |
| 13 Concurrency | Memory and real Firestore emulator reservation tests |
| 14 Idempotency | Repeated jobs/clicks/events/receipts covered; not every legacy integration |
| 15 Timeout | Actual Meta timeout code held; evidence review without automatic retry tested |
| 16 Milestones | Accepted/delivered/read/unknown separated |
| 17 Webhooks | Early/duplicate/out-of-order receipts and late failure covered |
| 18 Templates/media | Registry/header/variable checks and changed body invalidation; live test pending |
| 19 Pause/revocation | Guards and targeted tests pass; full schedule/UI combinations pending |
| 20 Replies | Task stops, explicit outcomes and ambiguous holds covered; all assignments pending |
| 21 Attribution | Primary campaign, paginated full report and decimal/refund tests pass; full live reconciliation/assisted attribution pending |
| 22 Imports | CSV/XLSX strings, numeric/formula rejection, reviewed updates, stale edits and evidence replay covered; duplicate merge pending |
| 23 Dates | Relative/unknown dates and hours covered; exhaustive timezone/DST tests pending |
| 24 Isolation | API/contact/job scopes and revoked users covered; full live role acceptance pending |
| 25 Scale | 50k synthetic store/emulator pass; production indexes/latency pending |
| 26 Test transport | Meta adapter guard and mocked/blocked tests; smoke workers disabled |

## Local setup and safe migration

Use Node 24; npm ci in backend. Do not copy production credentials into a demo. Flags default false: CRM_DIRECTORY_ENABLED, CRM_MARKETING_UPGRADE_ENABLED and CRM_MARKETING_DISPATCH_ENABLED. For a verified demo, enable directory/upgrade UI but keep dispatch false and NODE_ENV=development. Configure only local Firebase/Auth emulators or a synthetic harness; keep production workers/AI disabled. Frontend npm run dev defaults to the localhost API. Supplied dist also uses localhost and is not a production configuration.

Guarded scripts reject production mode, non-demo projects, nonloopback addresses and credential variables. Example for a dedicated local demo only:

```powershell
$env:GCLOUD_PROJECT='demo-rx-crm'
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:NODE_ENV='development'
node scripts/backfill-client-classification.mjs --org-id=DEMO --limit=100 --dry-run
node scripts/backfill-client-activity.mjs --org-id=DEMO --kind=orders --limit=100 --dry-run
node scripts/backfill-client-activity.mjs --org-id=DEMO --kind=messages --limit=100 --dry-run
node scripts/backfill-marketing-suppression.mjs --org-id=DEMO --limit=100 --dry-run
node scripts/backfill-marketing-history.mjs --org-id=DEMO --limit=100 --dry-run
```

Review dry runs, then use --commit for that demo only, following returned --cursor values. Reconcile record counts, references, dates, associations and suppression/acceptance evidence. No migration grants permission or deletes clients. After resolving held history, --commit --restart (without a cursor) resets only the history scan checkpoint and audits the rescan; histories remain intact. New imports also require suppression preparation before activation. Ingestion dates are not original contact-save dates.

## Production and rollback boundary

Production work requires separate authorisation. Complete the required remaining scope; review indexes/quota, rehearse migrations on representative copied data, verify roles/provider capabilities, stop competing legacy marketing during an approved cutover, and reconcile accepted/uncertain history. No automatic deployment, destructive migration or full-database launch is included.

Configure INTERNAL_TEST with explicitly reviewed staff IDs and account-verification evidence. Permission/template/content restrictions still apply. A separately authorised real internal send must validate delivery, webhook, queue and reporting evidence before PILOT; review pilot evidence before FULL. Each stage change turns sending off until separately activated. Current account limits/pricing/region restrictions must be verified, not assumed from code defaults.

Cooldown defaults are 24 hours with caps of 1/3/8 attempts in rolling 1/7/30 days: business controls, not Meta account limits. Quiet hours use campaign timezone. Unknown attempts remain reserved. An in-flight provider request cannot be atomically recalled. Global pause may await a worker's next check; reviewed batch resume releases paused pending jobs. No unsupported provider polling API is invented.

Rollback: first kill new marketing, pause/cancel campaigns, inspect held/in-flight work and stop dispatch workers; then roll back code/flags. Preserve evidence, reservations, content receipts, IDs and audit records. **Do not turn the upgrade flag off while legacy sending is running**, because that removes the new central guard. Forward repair should reconcile records, not erase history or suppression.

The integration uses the existing Meta Cloud API adapter and registry. Policy/category sources reviewed include https://business.whatsapp.com/policy and official WhatsApp marketing/utility category pages. Some current Meta documentation was rate-limited. Exact live account limits, error catalogue, pricing and regional eligibility remain unverified; no provider idempotency, cost, ROI or delivery guarantee is claimed.

## Import, job and vendor operating details

XLSX parsing uses the locally bundled ExcelJS 4.4.0 browser build (MIT), from the official npm package https://registry.npmjs.org/exceljs/-/exceljs-4.4.0.tgz; source project https://github.com/exceljs/exceljs. Its license is included. No paid service, browser CDN fetch or spreadsheet upload is required to preview. Numeric/formula phone cells are rejected rather than guessed. Limits: 15 MB file, 20 sheets, 50,001 rows/100 columns per sheet, two million cells, 30-second worker timeout. CSV/worksheet commit pages contain at most 100 rows.

Vendor SHA-256: `7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9`.

Only explicit reviewed company-name/person/city edits are applied. Historical links, phones and opt-out flags are not overwritten by those field edits. Permission evidence is a separate optional map and requires recorded source/reference/time; bulk imports cannot declare restoration of an opt-out. If evidence fails, the response shows which evidence records failed and may still contain successfully created client rows. Keep the same source/page to resume idempotently; do not change the file midway through an import review.

Bulk jobs prepare 100 members and apply 50 per request; selection caps at 50,000. Creating the job does not change clients. Closing the dialog pauses additional browser-driven steps; resume from Recent bulk reviews. Already committed chunks remain applied. Report scans use 100 source rows per request; closing pauses future browser steps. These two browser-driven workflows differ from server campaign sending, which continues while its configured worker runs.

Reports expire after seven days; bulk previews after one day. Expiry guards do not delete stored records. Review and configure cleanup for crmReports/crmReportMembers/crmBulkJobs/crmBulkMembers separately before release. Do not apply a blanket TTL to permission-import idempotency keys or suppression/receipt history: losing replay protection could reapply stale evidence. Existing contact/order/payment documents are not deleted by these jobs.

Final self-review found and fixed staff report counter leakage, stale bulk/report UI races, company preference changes after batch preparation, and the legacy partial-merge bypass for upgraded records. The last emulator run preceded only these small UI/scoped-counter/legacy-merge/owner-picker guards; their focused unit/browser checks passed afterward. This is not live database or provider verification.
