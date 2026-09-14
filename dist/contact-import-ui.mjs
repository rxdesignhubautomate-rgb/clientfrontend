import { readContactWorkbook } from './contact-file.mjs';

export function openContactImport({ modal, fieldSelect, action, esc, parseCsv, request }) {
  const { dialog } = modal('Import contacts', `<p>Choose a sheet, map columns, then review each page. Numeric or formula phone cells need correction to text in Excel. Only checked updates are applied.</p><label class="field">CSV or Excel file<input type="file" accept=".csv,.xlsx" data-file /></label><div data-sheet></div><div data-map></div><div data-result></div><div class="form-actions">${action('preview', 'Preview', true)}${action('commit', 'Apply reviewed page', true)}${action('next', 'Next 100 rows', true)}</div><p class="form-error" role="alert"></p>`);
  let sheets = [], rows = [], headers = [], offset = 0, filename = '', payload, preview, generation = 0;
  const selected = new Map(), button = name => dialog.querySelector(`[data-action="${name}"]`);
  const error = e => { dialog.querySelector('.form-error').textContent = e.message; };
  const invalidate = () => { generation++; payload = null; preview = null; button('commit').disabled = true; };
  const editable = ['companyName', 'contactPerson', 'city'];
  function useSheet(index) {
    invalidate(); selected.clear(); offset = 0; rows = [...sheets[index].rows]; headers = rows.shift() || [];
    filename = `${dialog.querySelector('[data-file]').files[0].name}:${sheets[index].name}`;
    const options = [['', 'Not mapped'], ...headers.map((h, i) => [String(i), typeof h === 'object' ? `Column ${i + 1}` : String(h)])];
    dialog.querySelector('[data-map]').innerHTML = ['companyName', 'contactPerson', 'phone', 'city', 'contactId'].map(key => fieldSelect(key, key, options)).join('') + '<label class="field">Country for national numbers (e.g. IN)<input name="countryCode" maxlength="2" /></label>' + fieldSelect('Relationship for new records', 'relationship', [['unclassified', 'Needs review'], ['prospect', 'Future client'], ['customer', 'Existing client']]) + `<fieldset><legend>Fields to update for individually checked existing clients</legend>${editable.map(key => `<label><input type="checkbox" data-field="${key}" /> ${key}</label>`).join('')}</fieldset><details><summary>Optional permission evidence mapping</summary><p>Map only real evidence. State: granted/revoked. Source: SIGNED_FORM, CUSTOMER_MESSAGE, RECORDED_CALL, IN_PERSON or CUSTOMER_REQUEST. Date must include time and timezone. Ordinary opt-in flags are not evidence. Restore prior opt-outs from the client permission screen.</p>${['evidenceState', 'evidenceSource', 'evidenceReference', 'evidenceObtainedAt'].map(key => fieldSelect(key, key, options)).join('')}<label class="field">Evidence review reason<input name="evidenceReason" /></label></details>`;
    const aliases = { companyName: ['companyname', 'company', 'businessname', 'name'], contactPerson: ['contactperson', 'person'], phone: ['phone', 'mobile', 'number', 'primaryphone', 'whatsapp'], city: ['city'], contactId: ['contactid'] };
    for (const [key, names] of Object.entries(aliases)) { const found = headers.findIndex(h => names.includes(String(h).toLowerCase().replace(/[^a-z]/g, ''))); if (found >= 0) dialog.querySelector(`[name="${key}"]`).value = String(found); }
    dialog.querySelector('[data-result]').textContent = `${rows.length} rows in this sheet. Review 100 at a time. Reopening the same file safely skips rows already imported.`;
    button('preview').disabled = !rows.length; button('next').disabled = true;
  }
  dialog.querySelector('[data-file]').onchange = async event => {
    invalidate(); const mine = generation; button('preview').disabled = true; button('next').disabled = true;
    dialog.querySelector('[data-result]').textContent = 'Reading file…';
    try {
      const file = event.target.files[0]; if (!file || file.size > 15 * 1024 * 1024) throw new Error('Choose a CSV or XLSX file under 15 MB');
      const result = /\.xlsx$/i.test(file.name) ? await readContactWorkbook(file) : /\.csv$/i.test(file.name) ? [{ name: 'CSV', rows: parseCsv(await file.text()) }] : null;
      if (!result) throw new Error('Choose a .csv or .xlsx file');
      if (!dialog.isConnected || mine !== generation) return;
      sheets = result; if (!sheets.length) throw new Error('No worksheets found');
      dialog.querySelector('[data-sheet]').innerHTML = fieldSelect('Worksheet', 'sheet', sheets.map((s, i) => [String(i), s.name]));
      dialog.querySelector('[name="sheet"]').onchange = e => useSheet(Number(e.target.value)); useSheet(0);
    } catch (e) { if (mine === generation) error(e); }
  };
  dialog.querySelector('[data-map]').onchange = () => { invalidate(); selected.clear(); dialog.querySelector('[data-result]').textContent = 'Mapping changed. Preview this page again.'; };
  button('preview').onclick = async () => {
    invalidate(); const mine = generation; button('preview').disabled = true; dialog.querySelector('.form-error').textContent = '';
    try {
      const mappings = Object.fromEntries([...dialog.querySelectorAll('[data-map] select')].map(s => [s.name, s.value]));
      if (mappings.phone === '') throw new Error('Map the phone column');
      const countryCode = dialog.querySelector('[name="countryCode"]').value.trim().toUpperCase();
      const fields = [...dialog.querySelectorAll('[data-field]:checked')].map(c => c.dataset.field);
      for (const f of fields) if (mappings[f] === '') throw new Error(`Map ${f} before selecting it for updates`);
      const cell = (row, key) => mappings[key] === '' ? '' : row[Number(mappings[key])] ?? '';
      payload = { sourceName: `${filename}:rows-${offset + 1}-${offset + 100}`.slice(0, 150), rows: rows.slice(offset, offset + 100).map((row, index) => {
        const chosen = selected.get(index), mappedId = cell(row, 'contactId');
        let evidence;
        if (mappings.evidenceState !== '' && cell(row, 'evidenceState')) {
          const obtainedAt = String(cell(row, 'evidenceObtainedAt'));
          if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(obtainedAt)) throw new Error(`Row ${offset + index + 1}: evidence date must include time and timezone`);
          evidence = { state: cell(row, 'evidenceState'), source: cell(row, 'evidenceSource'), evidenceReference: cell(row, 'evidenceReference'), obtainedAt: new Date(obtainedAt).toISOString(), reason: dialog.querySelector('[name="evidenceReason"]').value.trim(), restoresOptOut: false, stopAll: false };
        }
        return { ...(evidence ? { evidence } : {}), companyName: cell(row, 'companyName'), contactPerson: cell(row, 'contactPerson'), phone: cell(row, 'phone'), city: cell(row, 'city'), relationship: mappings.relationship, ...(countryCode ? { countryCode } : {}), ...(chosen ? { contactId: String(mappedId || chosen), updateFields: fields } : {}) };
      }) };
      const result = await request('/imports/preview', payload);
      if (!dialog.isConnected || mine !== generation) return;
      preview = result;
      dialog.querySelector('[data-result]').innerHTML = `<p>${result.newRecords} new · ${result.updates || 0} updates · ${result.review} review · ${result.errors} errors</p>${result.evidenceRecords ? `<p>${result.evidenceRecords} permission evidence records will also be applied.</p>` : ''}${result.rows.map(r => `<article class="panel"><strong>${offset + r.index + 1}. ${esc(r.companyName)} · ${esc(r.originalPhone)}</strong><p>${esc(r.status)} · ${esc(r.reason || '')}</p>${r.permissionEvidence ? `<p>Permission: ${esc(r.permissionEvidence.state)} · ${esc(r.permissionEvidence.source)} · ${esc(r.permissionEvidence.evidenceReference)} · ${esc(r.permissionEvidence.obtainedAt)}</p>` : ''}${r.changes ? Object.entries(r.changes).map(([f, v]) => `<p>${esc(f)}: ${esc(v.before)} → <strong>${esc(v.after || '(clear)')}</strong></p>`).join('') : ''}${r.matchedContactId && !['IMPORTED', 'ERROR'].includes(r.status) ? `<label><input type="checkbox" data-update="${r.index}" value="${esc(r.matchedContactId)}" ${selected.has(r.index) ? 'checked' : ''} /> Apply selected fields / evidence for ${esc(r.matchedCompanyName || r.matchedContactId)}</label>` : ''}</article>`).join('')}`;
      dialog.querySelectorAll('[data-update]').forEach(input => { input.onchange = () => { invalidate(); if (input.checked) selected.set(Number(input.dataset.update), input.value); else selected.delete(Number(input.dataset.update)); dialog.querySelector('.form-error').textContent = 'Selection changed. Click Preview to review the exact changes.'; }; });
      button('commit').disabled = !(result.newRecords || result.updates || result.evidenceRecords); button('next').disabled = offset + 100 >= rows.length;
    } catch (e) { error(e); } finally { button('preview').disabled = false; }
  };
  button('commit').onclick = async () => {
    button('commit').disabled = true;
    try { const result = await request('/imports/commit', { payload, expectedBatchId: preview.batchId, reviewToken: preview.reviewToken }); dialog.querySelector('[data-result]').textContent = `${result.created} created · ${result.updated || 0} updated · ${result.skipped} skipped.${result.permissionRecorded ? ` ${result.permissionRecorded} permission evidence records applied.` : ' Marketing permissions unchanged.'}${result.permissionErrors?.length ? ` Evidence not applied: ${result.permissionErrors.map(e => `row ${offset + e.index + 1}: ${e.reason}`).join('; ')}. Preview again after resolving these.` : ''}`; invalidate(); }
    catch (e) { error(e); invalidate(); }
  };
  button('next').onclick = () => { invalidate(); selected.clear(); offset += 100; button('next').disabled = true; dialog.querySelector('[data-result]').textContent = `Rows ${offset + 1} onward. Click Preview.`; };
}
