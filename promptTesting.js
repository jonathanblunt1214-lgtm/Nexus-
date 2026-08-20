// promptTesting.js
// Main-process module: lets a project keep named prompt variants and record
// real quality scores against them over time, so "which prompt works
// better" becomes a comparison of recorded numbers instead of a guess.
// Pure data storage - it never calls a model itself. Scores come from
// wherever the caller got them (a human rating, an eval script, etc.).

const fs = require('fs');
const path = require('path');

const PROMPTS_FILENAME = '.nexus-ai-prompts.json';

function storePath(projectPath) {
  return path.join(projectPath, PROMPTS_FILENAME);
}

function loadStore(projectPath) {
  const file = storePath(projectPath);
  if (!fs.existsSync(file)) return { variants: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && data.variants ? data : { variants: {} };
  } catch {
    return { variants: {} };
  }
}

function saveStore(projectPath, store) {
  fs.writeFileSync(storePath(projectPath), JSON.stringify(store, null, 2), 'utf8');
}

function saveVariant(projectPath, { name, prompt, notes }) {
  if (!name || !prompt) return { ok: false, error: 'name and prompt are required.' };
  const store = loadStore(projectPath);
  const existing = store.variants[name];
  store.variants[name] = {
    name,
    prompt,
    notes: notes || (existing ? existing.notes : ''),
    createdAt: existing ? existing.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: existing ? existing.results : [],
  };
  saveStore(projectPath, store);
  return { ok: true, variant: store.variants[name] };
}

function recordResult(projectPath, variantName, { score, notes }) {
  if (typeof score !== 'number') return { ok: false, error: 'score (a number) is required.' };
  const store = loadStore(projectPath);
  if (!store.variants[variantName]) return { ok: false, error: `No prompt variant named "${variantName}". Save it first.` };
  store.variants[variantName].results.push({ score, notes: notes || '', recordedAt: new Date().toISOString() });
  saveStore(projectPath, store);
  return { ok: true };
}

function compareVariants(projectPath) {
  const store = loadStore(projectPath);
  const rows = Object.values(store.variants).map((v) => {
    const scores = v.results.map((r) => r.score);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    return {
      name: v.name,
      prompt: v.prompt,
      sampleCount: scores.length,
      avgScore: avg === null ? null : +avg.toFixed(2),
      lastResultAt: v.results.length ? v.results[v.results.length - 1].recordedAt : null,
    };
  });
  rows.sort((a, b) => (b.avgScore ?? -Infinity) - (a.avgScore ?? -Infinity));
  return { ok: true, variants: rows };
}

module.exports = { saveVariant, recordResult, compareVariants };
