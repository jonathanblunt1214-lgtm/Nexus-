const path = require('path');
const { TextDocument } = require('vscode-languageserver-textdocument');
const html = require('vscode-html-languageservice');
const css = require('vscode-css-languageservice');

function uriFor(filePath) { return `file:///${path.resolve(filePath).replace(/\\/g, '/')}`; }
function document(filePath, content, languageId) { return TextDocument.create(uriFor(filePath), languageId, 1, String(content ?? '')); }
function applyEdits(doc, edits) {
  return [...(edits || [])].sort((a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)).reduce((text, edit) => {
    const start = doc.offsetAt(edit.range.start); const end = doc.offsetAt(edit.range.end);
    return text.slice(0, start) + edit.newText + text.slice(end);
  }, doc.getText());
}
function normalized(items, source) {
  return (items || []).map((item) => ({ line:item.range.start.line, column:item.range.start.character, length:Math.max(1, item.range.end.character - item.range.start.character), severity:item.severity === 1 ? 'error' : 'warning', message:item.message, code:String(item.code || 'language-service'), source }));
}

async function jsonCheck({ filePath, content }) {
  const json = await import('vscode-json-languageservice'); const doc = document(filePath, content, 'json'); const service = json.getLanguageService({}); const parsed = service.parseJSONDocument(doc);
  return { diagnostics:normalized(await service.doValidation(doc, parsed, { trailingCommas:'error', comments:'error' }), 'Microsoft JSON Language Service'), provider:'Microsoft JSON Language Service' };
}
async function jsonFix({ filePath, content }) {
  const json = await import('vscode-json-languageservice'); const doc = document(filePath, content, 'json'); const service = json.getLanguageService({}); const correctedContent = applyEdits(doc, service.format(doc, undefined, { tabSize:2, insertSpaces:true, insertFinalNewline:false }));
  return { ok:true, correctedContent, fixesApplied:correctedContent === content ? 0 : 1, source:'Microsoft JSON Language Service' };
}
function htmlFix({ filePath, content }) {
  const doc = document(filePath, content, 'html'); const service = html.getLanguageService(); const correctedContent = applyEdits(doc, service.format(doc, undefined, { tabSize:2, insertSpaces:true, wrapLineLength:120, unformattedContentDelimiter:'' }));
  return { ok:true, correctedContent, fixesApplied:correctedContent === content ? 0 : 1, source:'Microsoft HTML Language Service' };
}
function cssService(filePath) { const ext = path.extname(filePath).toLowerCase(); return ext === '.scss' ? css.getSCSSLanguageService() : ext === '.less' ? css.getLESSLanguageService() : css.getCSSLanguageService(); }
function cssCheck({ filePath, content }) {
  const languageId = path.extname(filePath).slice(1) || 'css'; const doc = document(filePath, content, languageId); const service = cssService(filePath); const stylesheet = service.parseStylesheet(doc);
  return { diagnostics:normalized(service.doValidation(doc, stylesheet), 'Microsoft CSS Language Service'), provider:'Microsoft CSS Language Service' };
}
function cssFix({ filePath, content }) {
  const languageId = path.extname(filePath).slice(1) || 'css'; const doc = document(filePath, content, languageId); const service = cssService(filePath); const stylesheet = service.parseStylesheet(doc); const diagnostics = service.doValidation(doc, stylesheet);
  const fullRange = { start:{ line:0, character:0 }, end:doc.positionAt(content.length) }; const actions = service.doCodeActions2(doc, fullRange, { diagnostics }, stylesheet) || [];
  const actionEdits = actions.flatMap((action) => action.edit?.changes?.[doc.uri] || []); const formatted = applyEdits(doc, actionEdits.length ? actionEdits : service.format(doc, undefined, { tabSize:2, insertSpaces:true }));
  return { ok:true, correctedContent:formatted, fixesApplied:formatted === content ? 0 : 1, source:'Microsoft CSS Language Service' };
}

module.exports = { jsonCheck, jsonFix, htmlFix, cssCheck, cssFix, applyEdits };
