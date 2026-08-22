const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { PluginManager } = require('../pluginManager');
const { packageId, listPlugins, downloadPlugin } = require('../pluginMarketplaceClient');

function safePluginFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-marketplace-source-'));
  fs.writeFileSync(path.join(root, 'nexus.plugin.json'), JSON.stringify({ id:'market.demo', name:'Marketplace Demo', version:'1.0.0', description:'Safe demo', apiVersion:1, entry:'index.js', capabilities:['ui:slot'], slots:['sidebar'] }));
  fs.writeFileSync(path.join(root, 'index.js'), "register({ slots: { sidebar: () => ({ label: 'safe' }) } });");
  return root;
}

test('marketplace package IDs are stable per publisher and plug-in', () => {
  assert.equal(packageId('owner-a', 'demo'), packageId('owner-a', 'demo'));
  assert.notEqual(packageId('owner-a', 'demo'), packageId('owner-b', 'demo'));
  assert.match(packageId('owner-a', 'demo'), /^[a-f0-9]{64}$/);
});

test('marketplace packages are digest verified and fully screened again before disabled installation', async () => {
  const firstRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-marketplace-first-'));
  const first = new PluginManager({ projectRoot:firstRoot, requireSigned:true });
  await first.importFromFolder(safePluginFolder(), { defenderScan:async () => ({ passed:true, engine:'Test Defender' }) });
  const published = first.createMarketplacePackage('market.demo');
  assert.equal(published.packageDigest, crypto.createHash('sha256').update(published.content).digest('hex'));

  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-marketplace-second-'));
  const second = new PluginManager({ projectRoot:secondRoot, requireSigned:true });
  const installed = await second.importMarketplacePackage(published.content, { defenderScan:async () => ({ passed:true, engine:'Test Defender' }) });
  assert.equal(installed.ok, true);
  assert.equal(installed.plugin.status, 'DISABLED');
  assert.equal(installed.plugin.screened, true);

  const tampered = JSON.parse(published.content);
  tampered.files.find((item) => item.path === 'index.js').data = Buffer.from('changed').toString('base64');
  const third = new PluginManager({ projectRoot:fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-marketplace-third-')), requireSigned:true });
  await assert.rejects(() => third.importMarketplacePackage(JSON.stringify(tampered), { defenderScan:async () => ({ passed:true, engine:'Test Defender' }) }), /digest verification/);
});

test('catalog lists public entries anonymously and adds only the signed-in owner records', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requests = [];
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push({ headers:options.headers, field:body.structuredQuery.where.fieldFilter.field.fieldPath });
    const value = requests.at(-1).field === 'visibility'
      ? { name:'Public', visibility:'public', packageId:'public-id' }
      : { name:'Private', visibility:'private', packageId:'private-id', ownerUid:'owner-a' };
    return { ok:true, json:async () => [{ document:{ name:`projects/p/databases/(default)/documents/pluginMarketplace/${value.packageId}`, fields:Object.fromEntries(Object.entries(value).map(([key, item]) => [key, { stringValue:item }])) } }] };
  };
  const anonymous = await listPlugins({ projectId:'p' });
  assert.deepEqual(anonymous.map((item) => item.name), ['Public']);
  const owner = await listPlugins({ projectId:'p', idToken:'token', uid:'owner-a' });
  assert.deepEqual(owner.map((item) => item.name), ['Private', 'Public']);
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.equal(requests.at(-1).headers.Authorization, 'Bearer token');
});

test('downloads verify the catalog digest and do not send credentials for public packages', async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const content = Buffer.from('{"safe":true}');
  let headers;
  global.fetch = async (_url, options) => { headers = options.headers; return { ok:true, arrayBuffer:async () => content }; };
  const item = { visibility:'public', objectName:'pluginPackages/o/x', packageDigest:crypto.createHash('sha256').update(content).digest('hex') };
  assert.equal(await downloadPlugin({ storageBucket:'bucket', idToken:'secret', item }), content.toString());
  assert.equal(headers.Authorization, undefined);
  await assert.rejects(() => downloadPlugin({ storageBucket:'bucket', item:{ ...item, visibility:'private' } }), /owner/);
});

test('Firebase rules enforce public or owner reads and verified owner publishing', () => {
  const firestore = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.rules'), 'utf8');
  assert.match(firestore, /resource\.data\.visibility == 'public'/);
  assert.match(firestore, /request\.auth\.uid == resource\.data\.ownerUid/);
  assert.match(firestore, /request\.auth\.token\.email_verified == true/);
  assert.match(storage, /request\.resource\.size <= 22 \* 1024 \* 1024/);
  assert.match(storage, /application\/vnd\.nexus\.plugin\+json/);
  assert.match(storage, /request\.resource\.metadata\.ownerUid == ownerUid/);
});
