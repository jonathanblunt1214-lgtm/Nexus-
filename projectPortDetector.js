const fs = require('fs');
const path = require('path');

function validPort(value) {
  const port = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? String(port) : null;
}

function detectProjectPort(folder) {
  const readText = (relativePath) => {
    try { return fs.readFileSync(path.join(folder, relativePath), 'utf8'); } catch { return ''; }
  };

  for (const envFile of ['.env.local', '.env.development', '.env']) {
    const env = readText(envFile);
    const match = env.match(/^\s*(?:PORT|VITE_PORT)\s*=\s*["']?(\d{1,5})["']?\s*$/m);
    const port = validPort(match?.[1]);
    if (port) return { port, source: envFile };
  }

  const packageText = readText('package.json');
  let pkg = null;
  try { pkg = packageText ? JSON.parse(packageText) : null; } catch { pkg = null; }
  const scripts = pkg?.scripts || {};
  for (const name of ['dev', 'start', 'serve', 'preview']) {
    const command = scripts[name];
    if (typeof command !== 'string') continue;
    const match = command.match(/(?:--port(?:=|\s+)|(?:^|\s)-p\s+|\bPORT=)(\d{1,5})\b/i);
    const port = validPort(match?.[1]);
    if (port) return { port, source: `package.json script ${name}` };
  }

  for (const configFile of ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']) {
    const config = readText(configFile);
    const match = config.match(/\bserver\s*:\s*\{[\s\S]{0,1200}?\bport\s*:\s*(\d{1,5})\b/);
    const port = validPort(match?.[1]);
    if (port) return { port, source: configFile };
  }

  const dependencies = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  if (dependencies.vite) return { port: '5173', source: 'Vite default' };
  if (dependencies['@angular/core']) return { port: '4200', source: 'Angular default' };
  if (dependencies.next || dependencies['react-scripts']) return { port: '3000', source: 'framework default' };
  return null;
}

module.exports = { detectProjectPort };
