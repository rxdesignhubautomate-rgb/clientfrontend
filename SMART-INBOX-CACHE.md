# Smart inbox cache

This build keeps the WhatsApp inbox fast without hiding new messages.

- On the first successful sign-in, the browser loads the complete accessible inbox in pages and stores it for that approved role and device.
- On later page loads, cached chats appear immediately while the app asks the backend only for chats changed since the last successful sync.
- Live events refresh the active conversation only when its thread changed, avoiding repeated message-history downloads for unrelated inbox activity.
- The refresh button performs a complete inbox reconciliation. The app also reconciles automatically once every 24 hours so assignments and other non-message changes cannot remain stale indefinitely.
- Up to 6,000 chats are kept in the device cache. If browser storage is nearly full, the app safely keeps a smaller cache and rebuilds it when needed.
- Signing out hides all cached customer data. Cache entries are isolated by approved role and device code.

Deploy the matching backend build first. Older backends remain compatible, but incremental sync activates only when `/api/chats/config` reports `features.inboxDelta: true`.
