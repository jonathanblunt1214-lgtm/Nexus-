// Public publisher identifiers bundled into every Nexus build.
// OAuth client IDs and Firebase Web API keys identify the application and
// project, not the user - Firebase's own docs say the Web API key is safe
// to embed in client apps. Never place OAuth client secrets, Firebase
// service-account keys, or user tokens in this file.
module.exports = Object.freeze({
  githubOAuthClientId: 'Ov23liPiROYsTTGcF9jA',
  googleOAuthClientId: '1091154247930-dk4mqms66bu99jauqo45g9nu9bq8hvkd.apps.googleusercontent.com',
  // Requires Email/Password Auth, Firestore, and Cloud Storage enabled on
  // the project (see the "Account provider configuration for development
  // builds" panel for the full checklist) before sign-up/sign-in actually
  // works - the values below just mean nobody has to enter them per machine.
  firebaseWebApiKey: 'AIzaSyBjsAPCT-lmUKlHvG6Z5MZanjJDo5dGkxQ',
  firebaseProjectId: 'nexus-2020b',
  firebaseStorageBucket: 'nexus-2020b.firebasestorage.app',
});
