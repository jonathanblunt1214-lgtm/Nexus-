const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PLATFORMS, detectOfficialPlatforms } = require('../officialDevelopmentPlatforms');

test('official platform registry covers requested web, mobile, desktop, CMS, and commerce systems', () => {
  const ids = PLATFORMS.map((item) => item.id);
  for (const id of ['angular','nuxt','astro','remix','qwik','solid','react-native','flutter','android','apple-native','dotnet-maui','wpf','winui','tauri','wordpress','drupal','shopify']) assert.ok(ids.includes(id), id);
  for (const platform of PLATFORMS) {
    assert.ok(platform.name && platform.vendor && platform.kind);
    assert.ok(platform.commands?.check || platform.commands?.develop);
  }
});

test('detects official platforms from real manifests without executing project code', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-platform-'));
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ dependencies:{ '@angular/core':'1', 'react-native':'1' } }));
  fs.writeFileSync(path.join(folder, 'angular.json'), '{}');
  const detected = detectOfficialPlatforms(folder).map((item) => item.id);
  assert.ok(detected.includes('angular'));
  assert.ok(detected.includes('react-native'));
  fs.rmSync(folder, { recursive:true, force:true });
});

test('Flutter detection requires the Flutter section rather than every Dart package', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-flutter-'));
  fs.writeFileSync(path.join(folder, 'pubspec.yaml'), 'name: sample\ndependencies:\n  flutter:\n    sdk: flutter\n');
  assert.ok(detectOfficialPlatforms(folder).some((item) => item.id === 'flutter'));
  fs.rmSync(folder, { recursive:true, force:true });
});
