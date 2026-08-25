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
  // Requires Email/Password Auth, Firestore, and Cloud Storage enabled on
  // the project (see the "Account provider configuration for development
  // builds" panel for the full checklist) before sign-up/sign-in actually
  // works - the values below just mean nobody has to enter them per machine.
  firebaseWebApiKey: 'AIzaSyBjsAPCT-lmUKlHvG6Z5MZanjJDo5dGkxQ',
  firebaseProjectId: 'nexus-2020b',
  firebaseStorageBucket: 'nexus-2020b.firebasestorage.app',
});
