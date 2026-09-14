import { createQuotationPdf } from "./quotation-pdf.mjs";
import { PRODUCT_NAMES, PRODUCT_OPTIONS } from "./quotation-products.mjs";

const MAX_ITEMS = 8;

function uid() {
  return globalThis.crypto?.randomUUID?.() || `quote-${Date.now()}-${Math.random()}`;
}



function quotationId() {
  const now = new Date();
  const part = (value) => String(value).padStart(2, "0");
  return `RX${String(now.getFullYear()).slice(-2)}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function optionMatchesRequirement(option, requirement) {
  const haystack = String(requirement || "").toLowerCase();
  if (!haystack.includes(String(option.product || "").toLowerCase())) return false;
  const page = haystack.match(/(\d+)\s*(?:pages?|pg)\b/i)?.[1];
  return !page || String(option.variety || "").toLowerCase().includes(`${page} page`);
}

function initialItem(lead) {
  const requirement = lead?.requirement || lead?.productSummary || "";
  const matched = PRODUCT_OPTIONS.find((option) =>
    optionMatchesRequirement(option, requirement),
  );
  return {
    id: uid(),
    product: matched?.product || "",
    variety: matched?.variety || "",
    quantity: 10,
    rate: number(matched?.rate),
  };
}

export function createQuotationTools(c) {
  const { esc, notify } = c;
  let modal = null;
  let objectUrl = "";
  let sending = false;
  let quoteState = null;

  function revokePreview() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  }

  function close() {
    if (!modal || sending) return;
    revokePreview();
    modal.close?.();
    modal.remove();
    modal = null;
    quoteState = null;
    sending = false;
  }

  function showModal() {
    if (modal.showModal) modal.showModal();
    else modal.setAttribute("open", "");
  }

  function varieties(product) {
    return PRODUCT_OPTIONS.filter((option) => option.product === product);
  }

  function suggestionValues(field, product = "") {
    return field === "product"
      ? PRODUCT_NAMES
      : varieties(product).map((option) => option.variety || "");
  }

  function suggestionsHtml(values, selected = "", query = "") {
    const normalizedSelected = String(selected).trim().toLowerCase();
    const normalizedQuery = String(query).trim().toLowerCase();
    const matches = values.filter(
      (value) => !normalizedQuery || value.toLowerCase().includes(normalizedQuery),
    );
    if (!matches.length)
      return '<div class="wa-quote-suggestions__empty">No saved match — keep typing to use a custom value</div>';
    return matches
      .map((value) => {
        const active = value.toLowerCase() === normalizedSelected;
        return `<button type="button" class="wa-quote-suggestion${active ? " is-selected" : ""}" data-quote-suggestion="${esc(value)}" role="option" aria-selected="${active}"><span class="wa-quote-suggestion__mark" aria-hidden="true">${esc(value.charAt(0))}</span><span>${esc(value)}</span>${active ? '<i aria-hidden="true">✓</i>' : ""}</button>`;
      })
      .join("");
  }

  function comboField(item, field, label, placeholder, values) {
    const safeId = String(item.id).replace(/[^a-z0-9_-]/gi, "");
    const inputId = `waQuote-${field}-${safeId}`;
    const listId = `${inputId}-suggestions`;
    const value = item[field] || "";
    return `<div class="wa-quote-field wa-quote-${field}"><label for="${inputId}">${esc(label)}</label><div class="wa-quote-combobox" data-quote-combo="${field}"><input id="${inputId}" data-quote-field="${field}" autocomplete="off" spellcheck="false" maxlength="120" value="${esc(value)}" placeholder="${esc(placeholder)}" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${listId}"><button type="button" class="wa-quote-combo-toggle" data-quote-toggle="${field}" aria-label="Show ${esc(label.toLowerCase())} suggestions" title="Show suggestions" tabindex="-1">⌄</button><div id="${listId}" class="wa-quote-suggestions" data-quote-suggestions="${field}" role="listbox" hidden>${suggestionsHtml(values, value)}</div></div></div>`;
  }

  function itemRow(item, index) {
    const catalogProduct = PRODUCT_NAMES.find(
      (product) => product.toLowerCase() === String(item.product).toLowerCase(),
    );
    return `<article class="wa-quote-item" data-quote-item="${esc(item.id)}" data-quote-catalog-product="${esc(catalogProduct || "")}">
      <div class="wa-quote-item__number">${index + 1}</div>
      ${comboField(item, "product", "Product", "Choose or type product", PRODUCT_NAMES)}
      ${comboField(item, "variety", "Size / Variety", "Choose or type size / variety", suggestionValues("variety", catalogProduct || ""))}
      <label><span>Qty</span><input data-quote-field="quantity" type="number" inputmode="decimal" min="0.01" step="any" value="${item.quantity || 10}"></label>
      <label><span>Unit rate</span><input data-quote-field="rate" type="number" inputmode="decimal" min="0" step="any" value="${item.rate || ""}" placeholder="Auto"></label>
      <div class="wa-quote-amount"><span>Amount</span><strong>${money(item.quantity * item.rate)}</strong></div>
      <button type="button" class="wa-quote-remove" data-quote-remove="${esc(item.id)}" aria-label="Remove item ${index + 1}" title="Remove item">×</button>
    </article>`;
  }

  function totals(items = quoteState.items) {
    const subtotal = Math.round(items.reduce((sum, item) => sum + Math.round(number(item.quantity) * number(item.rate) * 100) / 100, 0) * 100) / 100;
    const gst = Math.round(subtotal * 18) / 100;
    return { subtotal, discount: 0, gst, total: Math.round((subtotal + gst) * 100) / 100 };
  }

  function totalsHtml() {
    const values = totals();
    return `<span>Subtotal <strong>${money(values.subtotal)}</strong></span><span>GST 18% <strong>${money(values.gst)}</strong></span><span class="wa-quote-grand">Grand total <strong>${money(values.total)}</strong></span>`;
  }

  function readItem(row) {
    const id = row.dataset.quoteItem;
    const item = quoteState.items.find((candidate) => candidate.id === id);
    if (!item) return null;
    item.product = row.querySelector('[data-quote-field="product"]').value;
    item.variety = row.querySelector('[data-quote-field="variety"]').value;
    item.quantity = Number(row.querySelector('[data-quote-field="quantity"]').value);
    item.rate = Number(row.querySelector('[data-quote-field="rate"]').value);
    return item;
  }

  function readEditor() {
    quoteState.companyName = modal.querySelector("#waQuoteParty").value.trim();
    quoteState.phone = modal.querySelector("#waQuoteContact").value.trim();
    quoteState.city = modal.querySelector("#waQuoteCity").value.trim();
    modal.querySelectorAll("[data-quote-item]").forEach(readItem);
  }

  function updateTotals() {
    const target = modal?.querySelector("#waQuoteTotals");
    if (target) target.innerHTML = totalsHtml();
  }

  function closeSuggestions(except = null) {
    modal?.querySelectorAll(".wa-quote-combobox.is-open").forEach((combo) => {
      if (combo === except) return;
      combo.classList.remove("is-open");
      combo.querySelector("[data-quote-suggestions]").hidden = true;
      combo
        .querySelector('[role="combobox"]')
        .setAttribute("aria-expanded", "false");
    });
  }

  function refreshSuggestions(row, input, query = "") {
    const field = input.dataset.quoteField;
    if (!["product", "variety"].includes(field)) return;
    const productInput = row.querySelector('[data-quote-field="product"]');
    const product = PRODUCT_NAMES.find(
      (name) => name.toLowerCase() === productInput.value.trim().toLowerCase(),
    );
    const list = input
      .closest(".wa-quote-combobox")
      ?.querySelector("[data-quote-suggestions]");
    if (!list) return;
    list.innerHTML = suggestionsHtml(
      suggestionValues(field, product || ""),
      input.value,
      query,
    );
  }

  function openSuggestions(row, input, query = "") {
    const combo = input.closest(".wa-quote-combobox");
    if (!combo) return;
    closeSuggestions(combo);
    refreshSuggestions(row, input, query);
    combo.classList.add("is-open");
    combo.querySelector("[data-quote-suggestions]").hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function bindCombobox(row, input) {
    const combo = input.closest(".wa-quote-combobox");
    const toggle = combo?.querySelector("[data-quote-toggle]");
    const list = combo?.querySelector("[data-quote-suggestions]");
    if (!combo || !toggle || !list) return;
    input.addEventListener("focus", () => openSuggestions(row, input));
    input.addEventListener("input", () => {
      syncItemRow(row, input);
      openSuggestions(row, input, input.value);
    });
    input.addEventListener("change", () => syncItemRow(row, input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openSuggestions(row, input);
        list.querySelector(".wa-quote-suggestion")?.focus();
      } else if (event.key === "Escape") {
        closeSuggestions();
      }
    });
    toggle.onclick = (event) => {
      event.preventDefault();
      if (combo.classList.contains("is-open")) closeSuggestions();
      else {
        input.focus();
        openSuggestions(row, input);
      }
    };
    list.onclick = (event) => {
      const option = event.target.closest("[data-quote-suggestion]");
      if (!option) return;
      input.value = option.dataset.quoteSuggestion;
      syncItemRow(row, input);
      input.focus({ preventScroll: true });
      closeSuggestions();
    };
    list.onkeydown = (event) => {
      const option = event.target.closest("[data-quote-suggestion]");
      if (!option) return;
      const options = [...list.querySelectorAll(".wa-quote-suggestion")];
      const index = options.indexOf(option);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        options[(index + 1) % options.length]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        options[(index - 1 + options.length) % options.length]?.focus();
      } else if (event.key === "Escape") {
        closeSuggestions();
        input.focus();
      }
    };
  }

  function syncItemRow(row, source) {
    const item = readItem(row);
    if (!item) return;
    if (source.dataset.quoteField === "product") {
      const matchedProduct = PRODUCT_NAMES.find(
        (product) => product.toLowerCase() === item.product.trim().toLowerCase(),
      );
      const variety = row.querySelector('[data-quote-field="variety"]');
      if (matchedProduct) {
        source.value = matchedProduct;
        item.product = matchedProduct;
        const productChanged = row.dataset.quoteCatalogProduct !== matchedProduct;
        const first = varieties(matchedProduct)[0];
        if (first && (productChanged || !item.variety)) {
          variety.value = first.variety || "";
          item.variety = first.variety || "";
          item.rate = number(first.rate);
          row.querySelector('[data-quote-field="rate"]').value = String(item.rate);
        }
        row.dataset.quoteCatalogProduct = matchedProduct;
      } else if (row.dataset.quoteCatalogProduct) {
        variety.value = "";
        item.variety = "";
        item.rate = 0;
        row.querySelector('[data-quote-field="rate"]').value = "";
        row.dataset.quoteCatalogProduct = "";
      }
      refreshSuggestions(row, variety);
    }
    if (source.dataset.quoteField === "variety") {
      const selected = varieties(item.product).find(
        (option) =>
          String(option.variety || "").toLowerCase() ===
          source.value.trim().toLowerCase(),
      );
      if (selected) {
        item.rate = number(selected.rate);
        row.querySelector('[data-quote-field="rate"]').value = String(item.rate);
      }
    }
    readItem(row);
    row.querySelector(".wa-quote-amount strong").textContent = money(
      item.quantity * item.rate,
    );
    updateTotals();
  }

  function bindEditor() {
    modal.querySelectorAll("[data-quote-item]").forEach((row) => {
      row.querySelectorAll("[data-quote-field]").forEach((input) => {
        if (["product", "variety"].includes(input.dataset.quoteField)) {
          bindCombobox(row, input);
          return;
        }
        input.addEventListener("input", () => syncItemRow(row, input));
        input.addEventListener("change", () => syncItemRow(row, input));
      });
    });
    modal.querySelectorAll("[data-quote-remove]").forEach((button) => {
      button.onclick = () => {
        if (quoteState.items.length === 1) {
          notify("A quotation needs at least one item");
          return;
        }
        readEditor();
        quoteState.items = quoteState.items.filter(
          (item) => item.id !== button.dataset.quoteRemove,
        );
        renderEditor();
      };
    });
    modal.querySelector("#waQuoteAdd").onclick = () => {
      readEditor();
      if (quoteState.items.length >= MAX_ITEMS) {
        notify(`This quotation supports up to ${MAX_ITEMS} items`);
        return;
      }
      quoteState.items.push({
        id: uid(),
        product: "",
        variety: "",
        quantity: 10,
        rate: 0,
      });
      renderEditor(true);
    };
    modal.querySelector("#waQuoteDone").onclick = preview;
    modal
      .querySelector(".wa-quote-editor")
      .addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".wa-quote-combobox")) closeSuggestions();
      });
  }

  function renderEditor(focusLast = false) {
    revokePreview();
    modal.classList.remove("wa-quote-dialog--preview");
    modal.querySelector(".wa-quote-dialog__body").innerHTML = `
      <section class="wa-quote-editor">
        <div class="wa-quote-customer">
          <label><span>Party name</span><input id="waQuoteParty" maxlength="120" value="${esc(quoteState.companyName)}" placeholder="Customer or company name"></label>
          <label><span>Contact</span><input id="waQuoteContact" inputmode="tel" maxlength="20" value="${esc(quoteState.phone)}" placeholder="WhatsApp number"></label>
          <label><span>City <em>optional</em></span><input id="waQuoteCity" maxlength="80" value="${esc(quoteState.city)}" placeholder="City"></label>
        </div>
        <div class="wa-quote-items-heading"><div><span>Quotation items</span><small>Choose a suggestion for an automatic rate, or type any custom product, size and rate.</small></div><b>${quoteState.items.length}/${MAX_ITEMS}</b></div>
        <div class="wa-quote-items">${quoteState.items.map(itemRow).join("")}</div>
        <button type="button" id="waQuoteAdd" class="wa-quote-add"${quoteState.items.length >= MAX_ITEMS ? " disabled" : ""}>＋ Add item</button>
        <div class="wa-quote-editor__footer"><div id="waQuoteTotals" class="wa-quote-totals">${totalsHtml()}</div><button type="button" id="waQuoteDone" class="wa-quote-primary">Done · Preview</button></div>
      </section>`;
    bindEditor();
    if (focusLast) {
      const last = modal.querySelector('[data-quote-item]:last-child [data-quote-field="product"]');
      last?.focus();
      last?.scrollIntoView({ block: "nearest" });
    }
  }

  function buildQuotation() {
    readEditor();
    if (!quoteState.companyName)
      throw new Error("Enter the party name before previewing the quotation");
    if (!quoteState.phone)
      throw new Error("Enter the customer contact number");
    const items = quoteState.items;
    if (items.some(item => !item.product.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.rate) || item.rate < 0)) throw new Error("Enter a product, positive quantity and valid rate in every row");
    if (!items.length)
      throw new Error("Choose at least one product and enter its quantity and rate");
    if (items.some((item) => !item.variety))
      throw new Error("Choose the size or variety for every product");
    const values = totals(items);
    return {
      quotationId: quoteState.quotationId,
      createdAt: quoteState.createdAt,
      companyName: quoteState.companyName,
      city: quoteState.city,
      phone: quoteState.phone,
      preparedBy: quoteState.preparedBy,
      quotationStatus: "Quotation",
      items,
      ...values,
    };
  }

  async function preview() {
    const done = modal.querySelector("#waQuoteDone");
    try {
      sending = true;
      done.disabled = true;
      done.textContent = "Preparing PDF…";
      const quotation = buildQuotation();
      if (!window.jspdf?.jsPDF)
        throw new Error("Quotation PDF library could not be loaded. Refresh and try again.");
      const doc = await createQuotationPdf(quotation);
      const blob = doc.output("blob");
      revokePreview();
      objectUrl = URL.createObjectURL(blob);
      quoteState.generated = { quotation, blob };
      modal.classList.add("wa-quote-dialog--preview");
      modal.querySelector(".wa-quote-dialog__body").innerHTML = `
        <section class="wa-quote-preview">
          <iframe title="Final quotation preview" src="${objectUrl}#toolbar=1&navpanes=0&view=FitV"></iframe>
          <button type="button" class="wa-quote-preview__close" aria-label="Close preview">×</button>
          <div class="wa-quote-preview__actions"><button type="button" id="waQuoteBack" class="wa-quote-secondary">← Edit quotation</button><button type="button" id="waQuoteDownload" class="wa-quote-secondary">Download PDF</button><button type="button" id="waQuoteSave" class="wa-quote-secondary">Save draft</button><button type="button" id="waQuoteSend" class="wa-quote-primary">Send on WhatsApp</button><p id="waQuoteSaveStatus" class="wa-quote-save-status" role="status"></p><p class="wa-quote-notice">Send goes to the selected CRM client's WhatsApp number. A customer reply within 24 hours is required.</p></div>
        </section>`;
      modal.querySelector(".wa-quote-preview__close").onclick = close;
      modal.querySelector("#waQuoteBack").onclick = () => renderEditor();
      modal.querySelector("#waQuoteSend").onclick = () => save(true);
      modal.querySelector("#waQuoteSave").onclick = () => save(false);
      modal.querySelector("#waQuoteDownload").onclick = () => {
        const a = document.createElement('a'); a.href = objectUrl; a.download = `${quotation.quotationId}.pdf`; a.click();
      };
    } catch (error) {
      notify(error.message);
      if (done?.isConnected) {
        done.disabled = false;
        done.textContent = "Done · Preview";
      }
    } finally { sending = false; }
  }

  async function save(sendNow) {
    if (sending || !quoteState?.generated) return;
    sending = true;
    const buttons = [...modal.querySelectorAll('button')];
    buttons.forEach(button => button.disabled = true);
    const status = modal.querySelector('#waQuoteSaveStatus');
    status.textContent = sendNow ? 'Saving and queuing…' : 'Saving draft…';
    try {
      const saved = await c.save(quoteState.generated.quotation, quoteState.generated.blob);
      if (sendNow) {
        await c.send(saved);
        sending = false;
        close();
        notify('Quotation queued. Check delivery in the WhatsApp chat.');
      } else {
        status.textContent = 'Draft saved · available in Quotations';
        notify('Quotation draft and PDF saved');
      }
    } catch (error) { status.textContent = error.message; notify(error.message, true); }
    finally { sending = false; buttons.forEach(button => button.disabled = false); }
  }

  function open(lead, saved = null) {
    if (!lead) {
      notify("Open a customer chat before preparing a quotation");
      return;
    }
    close();
    const companyName =
      lead.companyName || lead.company || lead.name || lead.phone || "Customer";
    quoteState = {
      leadId: lead.id,
      quotationId: saved?.quotationNumber || quotationId(),
      createdAt: saved?.createdAt || new Date().toISOString(),
      companyName: saved?.companyName || companyName,
      phone: saved?.phone || lead.phone || "",
      city: saved?.city || lead.city || "",
      preparedBy: saved?.preparedBy || c.preparedBy || "RX Team",
      items: saved ? saved.items.map(item => ({id:uid(),product:item.product || item.description,variety:item.variety || "Custom",quantity:item.quantity,rate:item.unitPrice})) : [initialItem(lead)],
      generated: null,
    };
    modal = document.createElement("dialog");
    modal.className = "wa-quote-dialog";
    modal.setAttribute("aria-label", "Prepare quotation");
    modal.innerHTML = `<header class="wa-quote-dialog__header"><div><span>WhatsApp quotation</span><h2>Prepare quote</h2></div><button type="button" class="wa-quote-dialog__close" aria-label="Close quotation">×</button></header><div class="wa-quote-dialog__body"></div>`;
    document.body.append(modal);
    modal.querySelector(".wa-quote-dialog__close").onclick = close;
    modal.addEventListener("cancel", (event) => {
      event.preventDefault();
      if (!sending) close();
    });
    renderEditor();
    showModal();
  }

  return { open, close };
}
