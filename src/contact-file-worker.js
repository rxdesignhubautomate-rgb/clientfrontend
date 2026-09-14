/* global self, importScripts, ExcelJS */
importScripts('./vendor/exceljs.min.js');
self.onmessage = async ({ data }) => {
  try {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(data);
    if (book.worksheets.length > 20) throw new Error('Use a workbook with at most 20 sheets');
    let cells = 0;
    const sheets = book.worksheets.map(sheet => {
      if (sheet.rowCount > 50001 || sheet.columnCount > 100) throw new Error('Each sheet supports up to 50,000 contacts and 100 columns');
      const rows = [];
      sheet.eachRow(row => {
        const values = [];
        row.eachCell({ includeEmpty: true }, cell => {
          if (++cells > 2000000) throw new Error('Workbook is too large; split it into smaller files');
          const value = cell.value;
          if (value?.formula || value?.sharedFormula) values.push({ invalid: 'Formula cell: replace with reviewed text' });
          else if (value instanceof Date) values.push(value.toISOString());
          else if (value?.richText) values.push(value.richText.map(part => part.text).join(''));
          else if (value && typeof value === 'object') values.push({ invalid: 'Unsupported cell: replace with text' });
          else values.push(value ?? '');
        });
        rows.push(values);
      });
      return { name: sheet.name, rows };
    });
    self.postMessage({ sheets });
  } catch (error) { self.postMessage({ error: error.message || 'Could not read workbook' }); }
};
