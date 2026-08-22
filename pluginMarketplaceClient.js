const crypto = require('crypto');

function documentBase(projectId) { return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`; }
function packageId(uid, pluginId) { return crypto.createHash('sha256').update(`${uid}:${pluginId}`).digest('hex'); }
function authHeaders(idToken, contentType = 'application/json') { return { ...(contentType ? { 'Content-Type': contentType } : {}), ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) }; }
function fieldValue(value) {
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return { integerValue: String(value) };
  return { stringValue: String(value ?? '') };
}
function fromFields(fields = {}) { return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.stringValue ?? value.booleanValue ?? Number(value.integerValue)])); }
async function jsonResponse(response, label) { const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(`${label} failed (${response.status}): ${data?.error?.message || 'request rejected'}`); return data; }

async function publishPlugin({ projectId, storageBucket, idToken, uid, metadata, packageContent }) {
  const id = packageId(uid, metadata.pluginId);
  const objectName = `pluginPackages/${uid}/${id}.nexusplugin`;
  const boundary = `nexus-plugin-${crypto.randomUUID()}`;
  const storageMetadata = JSON.stringify({ name: objectName, contentType: 'application/vnd.nexus.plugin+json', metadata: { ownerUid: uid, visibility: metadata.visibility, digest: metadata.digest } });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${storageMetadata}\r\n--${boundary}\r\nContent-Type: application/vnd.nexus.plugin+json\r\n\r\n`), Buffer.from(packageContent), Buffer.from(`\r\n--${boundary}--`)]);
  const upload = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o?uploadType=multipart`, { method:'POST', headers: authHeaders(idToken, `multipart/related; boundary=${boundary}`), body });
  await jsonResponse(upload, 'Plug-in package upload');
  const fields = { ...metadata, ownerUid: uid, packageId: id, objectName, updatedAt: new Date().toISOString() };
  const document = await fetch(`${documentBase(projectId)}/pluginMarketplace/${id}`, { method:'PATCH', headers:authHeaders(idToken), body:JSON.stringify({ fields:Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, fieldValue(value)])) }) });
  await jsonResponse(document, 'Plug-in catalog update');
  return { id, ...fields };
}

async function runQuery(projectId, idToken, field, value) {
  const body = { structuredQuery:{ from:[{ collectionId:'pluginMarketplace' }], where:{ fieldFilter:{ field:{ fieldPath:field }, op:'EQUAL', value:fieldValue(value) } }, limit:100 } };
  const response = await fetch(`${documentBase(projectId)}:runQuery`, { method:'POST', headers:authHeaders(idToken), body:JSON.stringify(body) });
  const rows = await jsonResponse(response, 'Plug-in catalog query');
  return rows.filter((row) => row.document).map((row) => ({ id:row.document.name.split('/').pop(), ...fromFields(row.document.fields) }));
}

async function listPlugins({ projectId, idToken, uid }) {
  const publicItems = await runQuery(projectId, null, 'visibility', 'public');
  const privateItems = uid && idToken ? await runQuery(projectId, idToken, 'ownerUid', uid) : [];
  return [...new Map([...publicItems, ...privateItems].map((item) => [item.id, item])).values()].sort((a,b) => String(a.name).localeCompare(String(b.name)));
}

async function downloadPlugin({ storageBucket, idToken, item }) {
  const token = item.visibility === 'private' ? idToken : null;
  if (item.visibility === 'private' && !token) throw new Error('Sign in as the plug-in owner to download this private package.');
  const response = await fetch(`https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(storageBucket)}/o/${encodeURIComponent(item.objectName)}?alt=media`, { headers:authHeaders(token, null) });
  if (!response.ok) throw new Error(`Plug-in download failed (${response.status}).`);
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > 22 * 1024 * 1024) throw new Error('Marketplace package exceeds the download limit.');
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  if (digest !== item.packageDigest) throw new Error('Marketplace package digest does not match its catalog record.');
  return content.toString('utf8');
}

module.exports = { packageId, publishPlugin, listPlugins, downloadPlugin };
