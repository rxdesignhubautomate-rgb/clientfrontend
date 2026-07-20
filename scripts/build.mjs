import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src");
const output = path.join(root, "dist");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
fs.cpSync(source, output, { recursive: true });

const config = {
  apiBaseUrl: String(process.env.CRM_API_BASE_URL || "https://rxclientsbases.onrender.com/api/v1").replace(/\/$/, ""),
  firebaseApiKey: process.env.FIREBASE_WEB_API_KEY || ""
};
fs.writeFileSync(path.join(output, "config.js"), `window.__CRM_CONFIG__ = ${JSON.stringify(config)};\n`);
console.log(`Built CRM frontend at ${output}`);
