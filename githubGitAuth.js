function authenticatedGitEnvironment(gitUrl, token, baseEnvironment = process.env) {
  const env = { ...baseEnvironment, GIT_TERMINAL_PROMPT: '0' };
  let parsed;
  try { parsed = new URL(gitUrl); } catch { return env; }
  if (!token || parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== 'github.com') return env;
  // Git reads this transient header from its child-process environment. The
  // credential never enters the URL, process arguments, logs, or Git config.
  env.GIT_CONFIG_COUNT = '1';
  env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
  env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  return env;
}

module.exports = { authenticatedGitEnvironment };
