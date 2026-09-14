// Keep the customer/conversation pinned for the lifetime of this editor.
export function quotationPayload(quote, contactId, conversationId) {
  return {
    contactId, ...(conversationId ? { conversationId } : {}),
    quotationNumber: quote.quotationId, companyName: quote.companyName,
    phone: quote.phone, city: quote.city, preparedBy: quote.preparedBy,
    currency: 'INR', gstPercent: 18, taxAmount: 0, discountAmount: 0,
    items: quote.items.map(item => ({ description: `${item.product} · ${item.variety}`, product: item.product.trim(), variety: item.variety.trim(), quantity: item.quantity, unitPrice: item.rate }))
  };
}

function sameContent(saved, payload) {
  const keys = ['contactId','conversationId','quotationNumber','companyName','phone','city','preparedBy','currency','gstPercent','discountAmount'];
  return keys.every(key => (saved[key] ?? '') === (payload[key] ?? '')) &&
    JSON.stringify((saved.items || saved.itemsSnapshot || []).map(({description, product, variety, quantity, unitPrice}) => ({description,product,variety,quantity,unitPrice}))) === JSON.stringify(payload.items);
}

export function createQuotationSession({ api, upload, contactId, conversationId, saved: initial, checkSession }) {
  let saved = initial;
  let uploaded = null;
  const clientRequestId = globalThis.crypto.randomUUID();
  return {
    async save(quote, blob) {
      checkSession();
      const body = quotationPayload(quote, contactId, conversationId);
      if (!saved) saved = (await api('/quotations', {method:'POST',body:{...body,clientRequestId}})).data;
      checkSession();
      // Fetch again after an uncertain response; identical saved content needs no new revision.
      const latest = (await api(`/quotations/${encodeURIComponent(saved.quotationId)}`)).data;
      if (!sameContent(latest,body)) {
        if (latest.revision !== saved.revision) throw new Error('Quotation was changed elsewhere. Close and reopen it.');
        saved = (await api(`/quotations/${encodeURIComponent(saved.quotationId)}`,{method:'PATCH',body:{...body,expectedRevision:saved.revision || 1}})).data;
      } else saved = latest;
      checkSession();
      if (saved.pdfAttachmentId && saved.pdfRevision === saved.revision) return saved;
      if (saved.status !== 'DRAFT') throw new Error('Quotation is locked. Open its saved PDF from Quotations.');
      if (!uploaded || uploaded.revision !== saved.revision) {
        const file = new File([blob],`${quote.quotationId}.pdf`,{type:'application/pdf'});
        const attachment = await upload(file,contactId,conversationId);
        uploaded = { revision:saved.revision, attachmentId:attachment.attachmentId };
      }
      checkSession();
      saved = (await api(`/quotations/${encodeURIComponent(saved.quotationId)}/pdf`,{method:'POST',body:{attachmentId:uploaded.attachmentId,expectedRevision:saved.revision}})).data;
      return saved;
    },
    async send(quote) {
      checkSession();
      return api(`/quotations/${encodeURIComponent(quote.quotationId)}/send`,{method:'POST',body:{}});
    }
  };
}
