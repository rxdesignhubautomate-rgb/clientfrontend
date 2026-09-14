import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
process.env.CRM_API_BASE_URL ||= "http://127.0.0.1:3000/api/v1";
await import("./build.mjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.join(root, requested);
  const safe = file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, "index.html");
  res.setHeader("Content-Type", types[path.extname(safe)] || "application/octet-stream");
  fs.createReadStream(safe).pipe(res);
}).listen(4173, "127.0.0.1", () => console.log("CRM frontend: http://127.0.0.1:4173"));
