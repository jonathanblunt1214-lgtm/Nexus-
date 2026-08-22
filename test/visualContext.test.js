const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePreviewUrl, normalizeImageDataUrl, buildMultimodalPrompt, captureLocalPreview } = require('../visualContext');

test('visual context only accepts local preview URLs', () => {
  assert.match(validatePreviewUrl('http://localhost:5173/app'), /localhost/);
  assert.match(validatePreviewUrl('http://127.0.0.1:3000/'), /127\.0\.0\.1/);
  assert.throws(() => validatePreviewUrl('https://example.com'), /limited to local preview/);
});

test('image data URL is validated and hashed', () => {
  const dataUrl = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
  const result = normalizeImageDataUrl(dataUrl);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.bytes.toString(), 'png-bytes');
  assert.equal(result.sha256.length, 64);
});

test('multimodal prompt marks screenshot content as untrusted', () => {
  const dataUrl = `data:image/png;base64,${Buffer.from('x').toString('base64')}`;
  const prompt = buildMultimodalPrompt({ taskPrompt: 'Fix layout', imageDataUrl: dataUrl, previewUrl: 'http://localhost:5173' });
  assert.match(prompt.instruction, /untrusted visual evidence/);
  assert.equal(prompt.taskPrompt, 'Fix layout');
});

test('capture rejects non-webview targets and accepts local preview webviews', async () => {
  await assert.rejects(() => captureLocalPreview({ isDestroyed: () => false, getType: () => 'window', getURL: () => 'http://localhost:3000' }), /Only preview webviews/);
  const fake = {
    isDestroyed: () => false,
    getType: () => 'webview',
    getURL: () => 'http://localhost:3000',
    capturePage: async () => ({ toPNG: () => Buffer.from('capture') }),
  };
  const result = await captureLocalPreview(fake);
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.bytes, 7);
});
