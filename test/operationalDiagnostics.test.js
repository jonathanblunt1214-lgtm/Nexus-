const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OperationalDiagnostics } = require('../operationalDiagnostics');

test('structured diagnostics correlate events and redact credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-diagnostics-'));
  try { const diagnostics = new OperationalDiagnostics(root); const id = diagnostics.record('error', 'git', 'push-failed', { token: 'secret', message: 'Authorization: Bearer abc' }); const entry = diagnostics.recent(1)[0]; assert.equal(entry.correlationId, id); assert.equal(entry.data.token, '[REDACTED]'); assert.doesNotMatch(entry.data.message, /abc/); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('support bundle contains redacted logs and system measurements', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-diagnostics-'));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-support-'));
  try { const diagnostics = new OperationalDiagnostics(root); diagnostics.record('info', 'app', 'ready', { startupMs: 123 }); const bundle = diagnostics.exportBundle(output, { appVersion: '1.0.0' }); assert.ok(fs.existsSync(path.join(bundle, 'diagnostics.json'))); assert.match(fs.readFileSync(path.join(bundle, 'system.json'), 'utf8'), /appVersion/); } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(output, { recursive: true, force: true }); }
});

test('Electron main process enables local crash dumps and startup measurement', () => {
  const source = fs.readFileSync(require.resolve('../main'), 'utf8');
  assert.match(source, /crashReporter\.start/);
  assert.match(source, /startupMs/);
  assert.match(source, /unhandledRejection/);
});
