// Public publisher identifiers bundled into every Nexus build.
// OAuth client IDs identify the application and are not credentials.
// Never place OAuth client secrets or user tokens in this file.
module.exports = Object.freeze({
  githubOAuthClientId: 'Ov23liPiROYsTTGcF9jA',
  // Fill in once you create a Google Cloud OAuth client (Application type:
  // "Desktop app") - then every install signs in with Google in one click,
  // the same way GitHub already does above, and nobody needs the
  // per-machine "Account provider configuration for development builds"
  // panel just to use Google sign-in.
  googleOAuthClientId: '',
});
