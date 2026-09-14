# Simple Marketing — Preview → Approve → Start

Upload the extracted contents of RX-CRM-Simple-Marketing-Frontend.zip to the existing frontend repository and deploy on Vercel using its existing settings. The ZIP contains the complete frontend with package.json at its root. Build: npm run build; output: dist.

Changes:
- Marketing opens the original batch screen directly, even when the backend upgrade feature is enabled.
- Total contacts, Replied, Opted out, batch previews and progress remain visible.
- Owner/Admin can approve a draft from its preview. Submission and approval still use the existing server endpoints and audit trail.
- The preview stays open after approval and shows Start as a separate action.
- Start/Resume checks the current sending status. A paused server is shown clearly; approval never sends messages.
- Sales users retain Request approval; no admin permission is added.

No backend replacement, database migration, environment-variable changes or automatic sending is included in this frontend update. This restores the simple interface; it does not activate the currently paused live sender. The previously blocked production migration/deployment has not been applied.

Validation: 49 frontend tests passed, JavaScript syntax check passed, and all three frontend copies built successfully. No live customer messages were used for validation.
