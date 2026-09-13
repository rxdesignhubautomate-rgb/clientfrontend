const fs = require("node:fs"),
  path = require("node:path");
const root = __dirname;
fs.cpSync(path.join(root, "public"), path.join(root, "dist"), {
  recursive: true,
});
console.log("RX CRM built: dist");
