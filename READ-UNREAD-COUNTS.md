# Read and unread counts

The inbox now shows All, Unread and Read chat counts. Click Unread or Read to filter conversations. Below the filters, separate counters show unread and read incoming messages recorded by the CRM.

Counts cover matching loaded chats, including the current name/phone search and favourite/label filters. They are not account-wide totals. Use Load more chats to include further conversations. Selecting Read or Unread does not change the summary totals.

Opening a conversation marks its recorded incoming messages read for the current CRM device/viewer. The backend preserves newer arrivals and previously recorded read counts. Customer read receipts for outgoing messages are separate from these inbox counts.

Contact details -> Mark unread adds a manual unread marker. It increases the unread chat count, without inventing an unread incoming message. A green dot identifies this reminder when there are no unread incoming messages.

Older chats without tracking data show missing counts rather than invented message totals. A legacy backend without chat support shows an update notice and unavailable counters.

## Backend update

Deploy the accompanying rx-whatsapp-backend-read-counts.zip to the existing Render service using the existing environment configuration. The backend is prepared locally; it has not been deployed to Render by this task.

GET /api/chats/ and GET /api/chats/:leadId/messages now return matching viewer-scoped read state: manualUnread, unreadCount, readTrackingAvailable, readMessageCount and unreadMessageCount. POST /api/chats/:leadId/read preserves existing read counts and any incoming messages beyond the supplied visible inboundCount.

The backend ZIP also includes the previously prepared attachment/chat features and invalid sequence-media-ID fix. It does not supply new valid WhatsApp media IDs or deployment credentials. See SEQUENCE-MEDIA-FIX.md for that separate issue.

Frontend source is in rx-sales-crm-read-counts.zip. Run npm ci and npm run build to produce dist for another host. Existing backend connection and device approval settings are retained.

Validation uses mocked backend/WhatsApp transports and functional DOM tests. No customer messages are sent by these tests. Browser layout rendering and real WhatsApp delivery are not verified in this update.
