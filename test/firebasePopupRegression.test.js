const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { friendlyFirebaseError } = require('../firebaseAccountClient');

test('Firebase popup cancellation errors are presented as actionable Nexus messages', () => {
  assert.equal(
    friendlyFirebaseError('auth/popup-closed-by-user'),
    'The sign-in window was closed before authentication finished. Try signing in again.'
  );
  assert.equal(
    friendlyFirebaseError('auth/popup-blocked'),
    'The sign-in window was blocked. Allow the Nexus authentication popup and try again.'
  );
});

test('preview auth popup redirects are not blocked by the generic BrowserWindow navigation guard', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(main, /if \(isAllowedPopupUrl\(url\)\)/, 'preview popup creation must stay allowlisted');
  assert.doesNotMatch(
    main,
    /if \(contents\.getType\(\) === ['"]window['"]\)\s*\{[\s\S]{0,500}?url !== pathToFileURL\([\s\S]{0,300}?event\.preventDefault\(\)/,
    'auth popup windows must not have every redirect except index.html blocked'
  );
});
