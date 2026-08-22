const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getSignToolPath } = require('app-builder-lib/out/toolsets/windows');

const execFileAsync = promisify(execFile);

module.exports = async function signLocalWindows(configuration) {
  const thumbprint = process.env.NEXUS_LOCAL_SIGNING_THUMBPRINT;
  if (!/^[0-9A-F]{40}$/.test(thumbprint || '')) {
    throw new Error('NEXUS_LOCAL_SIGNING_THUMBPRINT is missing or invalid.');
  }

  const signTool = await getSignToolPath(null, true);
  const args = [
    'sign', '/sha1', thumbprint, '/s', 'My', '/fd', 'SHA256',
    '/tr', 'http://timestamp.acs.microsoft.com', '/td', 'SHA256',
    '/d', configuration.name || 'Nexus', '/debug', configuration.path,
  ];
  await execFileAsync(signTool.path, args, { env: { ...process.env, ...(signTool.env || {}) }, timeout: 10 * 60 * 1000, windowsHide: true });
};
