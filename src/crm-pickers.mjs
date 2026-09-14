export function attachLookupFields(dialog, api, contactId = null) {
  for (const input of dialog.querySelectorAll('input[name="contactId"],input[name="companyId"],input[name="assignedTo"],input[name="orderId"],input[name="quotationId"]')) {
    const kind = ['contactId', 'companyId'].includes(input.name) ? 'contacts' : input.name === 'assignedTo' ? 'team' : input.name === 'orderId' ? 'orders' : 'quotations';
    const chosen = input.value, select = document.createElement('select'); select.name = input.name; select.required = input.required;
    const empty = new Option(select.required ? 'Choose…' : 'Not selected', ''); select.append(empty);
    if (chosen) select.append(new Option('Current selection', chosen, true, true));
    input.replaceWith(select);
    const status = document.createElement('small'); select.after(status);
    let search, timer, generation = 0;
    if (['contacts', 'team'].includes(kind)) { search = document.createElement('input'); search.type = 'search'; search.placeholder = kind === 'team' ? 'Name starts with (match capitals)' : 'Type company name to search'; search.setAttribute('aria-label', kind === 'team' ? 'Search team member' : 'Search client'); select.before(search); search.oninput = () => { generation++; clearTimeout(timer); timer = setTimeout(load, 300); }; }
    async function load() {
      const mine = ++generation;
      const selectedContact = contactId || dialog.querySelector('select[name="contactId"]')?.value;
      if (['orders', 'quotations'].includes(kind) && !selectedContact) { status.textContent = 'Choose a client first'; return; }
      try {
        const params = new URLSearchParams({ kind, search: search?.value.trim() || '', ...(selectedContact ? { contactId: selectedContact } : {}) });
        const result = (await api(`/marketing-workspace/lookup?${params}`)).data;
        if (!dialog.isConnected || mine !== generation) return;
        const current = select.value; select.replaceChildren(empty);
        for (const item of result.items) select.append(new Option(item.label, item.value, false, item.value === current));
        if (current && !result.items.some(i => i.value === current)) select.append(new Option('Current selection (outside this search)', current, true, true));
        status.textContent = result.hasMore ? 'Showing first matches. Narrow the search.' : '';
      } catch (error) { if (dialog.isConnected) status.textContent = `Choices unavailable: ${error.message}`; }
    }
    if (['orders', 'quotations'].includes(kind)) dialog.querySelector('select[name="contactId"]')?.addEventListener('change', load);
    load();
    dialog.addEventListener('close', () => { generation++; clearTimeout(timer); }, { once: true });
  }
}
