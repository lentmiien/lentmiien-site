/* Reproduce the original vector emblem without external tools or services.
   World/rocket geometry is reproduced directly by js/renderer.mjs at startup. */
const fs = require('node:fs');
const path = require('node:path');
const emblem = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#20242a"/><path d="M32 8 43 31 40 45H24l-3-14Z" fill="#e8ecf2"/><path d="m21 31-8 16 12-5m18-11 8 16-12-5" fill="#ff6a1f"/><circle cx="32" cy="28" r="5" fill="#20242a"/><path d="m27 48 5 11 5-11" fill="#ffc247"/></svg>\n';
fs.writeFileSync(path.join(__dirname, '../assets/emblem.svg'), emblem);
