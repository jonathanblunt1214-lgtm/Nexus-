# Nexus Email Accounts

Nexus uses Firebase Authentication for email/password identity and Cloud Firestore for the encrypted account-vault copy. Nexus does not operate an authentication server of its own.

## One-time project setup

1. Create or select a Firebase project.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create a Cloud Firestore database in production mode.
4. Open **Firestore Database → Rules**, replace the rules with the contents of `firestore.rules`, and publish them.
5. Enable Cloud Storage, open **Storage → Rules**, replace the rules with `storage.rules`, and publish them.
6. In **Project settings → General**, copy the project ID, Web API key, and Storage bucket name.
7. In Nexus, open **Settings → Connected Services → Account provider configuration**, enter those values, and save.

The repository includes `firebase.json`, so both reviewed rulesets can be deployed together with `firebase deploy --only firestore:rules,storage --project <project-id>`. Always review the target project and pending rules changes before deploying.

Packaged builds can instead provide `NEXUS_FIREBASE_PROJECT_ID` and `NEXUS_FIREBASE_WEB_API_KEY` at build/runtime configuration. The Firebase Web API key identifies the Firebase project; it is not a user password or an administrative credential. Firestore rules are the authorization boundary and must be deployed exactly as reviewed.

## Optional: App Check (attestation for the Web API key)

Nexus's Electron main process calls Identity Toolkit and Firestore directly over REST, so it cannot run the normal browser App Check SDK. `appCheckBroker.js` instead loads a small hidden, sandboxed page — `firebase-hosting/appcheck-broker/` — on Nexus's own Firebase Hosting origin, where a reCAPTCHA Enterprise site key is registered and restricted to that exact domain. The page exchanges a reCAPTCHA token for an App Check token and reports it back over a narrow, contextIsolated bridge; the token is cached in memory only and is never written to disk, a URL, or a log line. This works on Firebase's free Spark plan — reCAPTCHA Enterprise includes a free monthly assessment allowance and requires no billing account.

This is entirely optional and additive: until it is deployed and its broker URL is entered in Settings, Nexus behaves exactly as it does today. Once deployed, Nexus attaches an `X-Firebase-AppCheck` header to Authentication and Firestore requests, but never requires one — a broker failure or missing configuration just falls back to no header, matching current behavior.

To deploy it:

1. In **App Check → APIs**, register a reCAPTCHA Enterprise site key restricted to `<project-id>.web.app` (or your custom Hosting domain).
2. Copy `firebase-hosting/appcheck-broker/config.example.json` to `firebase-hosting/appcheck-broker/config.json` (git-ignored — it is deploy-time configuration, not a secret, but it is project-specific and should not be committed) and fill in `recaptchaEnterpriseSiteKey`, `firebaseWebApiKey`, `firebaseProjectNumber`, and `firebaseWebAppId` from **Project settings**.
3. Deploy the broker: `firebase deploy --only hosting --project <project-id>`.
4. In Nexus, open **Settings → Connected Services → Account provider configuration** and set the **App Check broker URL** to `https://<project-id>.web.app/appcheck-broker/`.
5. Verify Nexus can actually obtain a token (sign in, watch for App Check errors) before turning on App Check **enforcement** in the Firebase console for Authentication and Firestore. Enforcing before verifying will reject real Nexus traffic.

## Account behavior

- Passwords are sent directly to Firebase Authentication over HTTPS and are never stored by Nexus.
- Firebase refresh and ID tokens are encrypted with Electron `safeStorage` for the current Windows user.
- Users must verify their email before reading or writing an email-account vault.
- Firestore stores only the passphrase-encrypted Nexus vault envelope.
- Each verified user can access only `nexusAccountVaults/{their Firebase UID}`.
- Public marketplace plug-ins can be discovered by everyone; private plug-ins and packages are readable only by their verified owner.
- Losing the vault passphrase still makes the vault unrecoverable; resetting the account password does not reset vault encryption.
