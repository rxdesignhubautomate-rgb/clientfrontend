# RX CRM development build 3

Backend 2.18.0-dev.3; frontend 1.17.0-dev.3. This is a verified development handoff, not a live deployment or completion of the full requested specification.

Read the upgrade progress guide and staff guide before enabling new features. They include implemented/pending scope, exact checks, environment/migration steps, activation boundaries and rollback notes.

- Backend: docs/crm-marketing-upgrade.md and docs/staff-marketing-guide.md.
- Frontend: CRM-UPGRADE.md and STAFF-GUIDE.md.
- Existing backend entry: npm start -> src/server.js. Node 24, npm ci. Existing Firebase/auth/provider configuration is reused.
- Development frontend: npm run dev. The included dist targets http://127.0.0.1:3000/api/v1.
- Production frontend configuration is a separate reviewed build step using CRM_API_BASE_URL. The build script's existing default still points at Render; do not confuse that with the supplied localhost dist.
- New feature flags default off. A verified isolated demo may enable CRM_DIRECTORY_ENABLED and CRM_MARKETING_UPGRADE_ENABLED; keep CRM_MARKETING_DISPATCH_ENABLED=false and workers/provider requests disabled for development.
- No production data, credentials, deployment or real messages were used in these checks. Production deployment, data operations and sending require separate authorisation under the requested specification.

Verified: 231 backend tests (42 files), 44 frontend tests, lint, syntax, startup smoke and local build; actual browser directory/bulk/import/marketing/report/chat checks; official Firestore emulator with 50,000 synthetic contacts. The emulator is not proof of deployed indexes or production speed. Live provider/account capabilities remain unverified.

Pending: safe duplicate merge, all advanced filters/actions, full legacy company reconciliation and attribution/report dimensions, production indexes/migration/role verification, retention review and an authorised pilot. Legacy merge is blocked for upgraded client records to prevent partial history moves.
