// Public publisher identifiers bundled into every Nexus build.
// OAuth client IDs and Firebase Web API keys identify the application and
// project, not the user - Firebase's own docs say the Web API key is safe
// to embed in client apps. Never place OAuth client secrets, Firebase
// service-account keys, or user tokens in this file.
module.exports = Object.freeze({
  githubOAuthClientId: 'Ov23liPiROYsTTGcF9jA',
  // Fill in once you create a Google Cloud OAuth client (Application type:
  // "Desktop app") - then every install signs in with Google in one click,
  // the same way GitHub already does above, and nobody needs the
  // per-machine "Account provider configuration for development builds"
  // panel just to use Google sign-in.
  googleOAuthClientId: '',
  // Fill in once you create the Firebase project (Email/Password Auth,
  // Firestore, and Cloud Storage enabled - see the "Account provider
  // configuration for development builds" panel for the full checklist)
  // - then Nexus Account sign-up/sign-in works for every install with no
  // per-machine setup, the same way GitHub sign-in already does.
  firebaseWebApiKey: '',
  firebaseProjectId: '',
  firebaseStorageBucket: '',
});
