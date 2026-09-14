// XLSX parsing is isolated from chat rendering and never uploads the workbook.
export async function readContactWorkbook(file) {
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a file under 15 MB');
  const buffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./contact-file-worker.js', import.meta.url));
    const timer = setTimeout(() => finish(new Error('Workbook took too long; split it into smaller files')), 30000);
    function finish(error, result) { clearTimeout(timer); worker.terminate(); if (error) reject(error); else resolve(result); }
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.sheets);
    worker.onerror = () => finish(new Error('Excel reader unavailable. Reload the app and try again.'));
    worker.postMessage(buffer, [buffer]);
  });
}
