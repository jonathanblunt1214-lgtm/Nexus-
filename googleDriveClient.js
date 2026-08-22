async function driveRequest(token, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  if (!response.ok) { const text = await response.text(); throw new Error(`Google Drive request failed (${response.status}): ${text.slice(0, 200)}`); }
  return response;
}

async function listFiles(token) {
  const fields = encodeURIComponent('files(id,name,mimeType,modifiedTime,size),nextPageToken');
  const response = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?pageSize=100&orderBy=modifiedTime desc&fields=${fields}`);
  return (await response.json()).files || [];
}

async function uploadFile(token, name, mimeType, content) {
  const boundary = `nexus-${Date.now()}`;
  const metadata = JSON.stringify({ name, appProperties: { createdBy: 'Nexus' } });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--`)]);
  const response = await driveRequest(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return response.json();
}

async function downloadFile(token, id) { return Buffer.from(await (await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer()); }

module.exports = { listFiles, uploadFile, downloadFile };
