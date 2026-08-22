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

Packaged builds can instead provide `NEXUS_FIREBASE_PROJECT_ID` and `NEXUS_FIREBASE_WEB_API_KEY` at build/runtime configuration. The Firebase Web API key identifies the Firebase project; it is not a user password or an administrative credential. Firestore rules are the authorization boundary and must be deployed exactly as reviewed.

## Account behavior

- Passwords are sent directly to Firebase Authentication over HTTPS and are never stored by Nexus.
- Firebase refresh and ID tokens are encrypted with Electron `safeStorage` for the current Windows user.
- Users must verify their email before reading or writing an email-account vault.
- Firestore stores only the passphrase-encrypted Nexus vault envelope.
- Each verified user can access only `nexusAccountVaults/{their Firebase UID}`.
- Public marketplace plug-ins can be discovered by everyone; private plug-ins and packages are readable only by their verified owner.
- Losing the vault passphrase still makes the vault unrecoverable; resetting the account password does not reset vault encryption.
