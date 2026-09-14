# Simple staff guide

This guide describes the new development workspace. It is not yet enabled on the live CRM.

1. **Clients:** open a client and review Existing/Future, tier, country and permission evidence. Inactive Existing clients remain Existing. An opt-out cannot be cleared by changing tier or importing a CSV.
2. **Marketing → Client groups:** save a group, check its matching contacts and exclusion reasons. Use checkboxes in group preview to save a smaller static group. Counts are contact records; shared numbers/companies can reduce actual recipients.
3. **Message & media:** select a synced approved template, enter its variables and choose a permitted marketing asset. Confirm sharing rights and expiry, then approve the content. If configured text differs from the provider template, approval is blocked until its mapping is corrected.
4. **Your batches → New batch:** select group, message and purpose. Keep the maximum at 500 or less. Internal tests use a separate batch type and an approved staff-number allowlist. No automatic daily sending is created.

   **Earlier batches** keeps access to the existing campaign list and its original preview/actions; those records are not silently converted into new approved snapshots.
5. **Preview & progress:** prepare the recipients, open several individual Message previews and inspect actual personalised text, media, footer/buttons and recipients. Review exclusions before approving the frozen list.
6. **Start this batch:** available only after authorised activation. Each day, manually start the batch you want. Your computer need not remain on when the configured server/worker is running. Closing a browser does not stop server jobs; use Pause or Cancel. Already-submitted requests cannot be recalled.
7. **Check results:** accepted is not delivered. Read may be unavailable. Failed and unknown are different. For an unknown result, check actual provider evidence and use Review unknown result; do not assume it failed or resend blindly. Neither reconciliation outcome automatically resends.
8. **Review replies / Follow-ups:** open the actual conversation, record the client's request, assign the next action and due date. Ordinary replies are not permission grants. Ambiguous stop requests remain held until evidence is reviewed.
9. **Client profile:** use existing quotation, order, payment and conversation links. Update opportunity stage; Won requires a qualifying order. Optional task rules start disabled and never send messages automatically.
10. **Link order / report:** link a confirmed order to one primary campaign. The financial page separates booked value, payments and refunds by currency and labels missing/partial data. It is not a whole-business finance report or profit calculation.

Admin rollout settings record internal-test evidence, a small pilot and its review before full rollout. Every settings change pauses marketing. Development sending is disabled regardless of a checked UI option.

Known development limits: transactional duplicate merge, the complete filter/bulk-action catalogue, legacy company reconciliation and all financial attribution dimensions remain incomplete. See the upgrade progress guide for exact scope and tests.


## Import and client changes

- **Import CSV / Excel:** select the file and (for Excel) worksheet, map name/phone/city columns, then preview. Phones must be stored as text. Review errors; do not infer missing digits from numeric or formula cells.
- For an existing contact, select the matching row and tick only the name/person/city fields to update. Re-preview its before/after values, then apply. If someone edited it meanwhile, prepare a fresh preview. Existing messages/orders remain linked.
- Permission-evidence mapping is optional and separate. Use it only for actual recorded evidence. An import is not proof of opt-in. The summary reports evidence failures separately from client records created/updated. Restore an opt-out only through the individual fresh-evidence review.
- **Clients → Filters and columns:** filter by city, owner, relationship, tier or activity; choose the columns you need.
- **Bulk changes / select all matching:** choose checked clients or every client matching current filters, then tier, owner or service tag. Prepare the preview, review the entire frozen selection, and click Apply. Concurrently edited rows are held as conflicts. Close/Pause stops future browser steps; use Recent bulk reviews to continue. Cancel keeps changes already applied.
- Duplicate merge is not available for upgraded contacts yet. Keep both records and review their company/phone relationship.

## Groups, pipeline and reports

- Open a group to copy/edit a new version, share read access with team members or archive it. Sharing a group does not grant access to restricted clients. New message versions need their own review/approval.
- Special resend/company-recipient exceptions are for an explicitly selected static group and require authorised staff and a recorded reason. Resend never bypasses opt-outs, cooldown or attempt caps.
- **Opportunities:** open the client, create/reuse its opportunity, choose owner/stage, record value/currency and next action. Select the existing quotation or confirmed order; Won requires a qualifying order.
- **Record complaint:** assign a due date and owner. Marketing stays held until all complaints for that client are resolved. Resolve with an outcome; this does not create marketing permission.
- **Business reports:** choose dates/city/service and build. Partial totals are labelled while scanning; you can close and resume from Recent reports. Booked value, received payments and refunds are separate, as are currencies. “Clients with 2+ orders” means qualifying orders within this report period. Unknown dates and amounts need review; current provider cost/ROI is unavailable.

All screenshots and automated verification examples in this handoff use synthetic data. This build is not yet deployed to the live CRM.
