// experimentationFramework.js
// Main-process module: side-by-side (A/B) experiments for comparing two AI
// configurations (models, prompts, whatever the caller is testing) using
// real recorded observations. The "analysis" is honest, conservative
// statistics on actual numbers - a mean/stddev comparison with a minimum
// sample-size gate - not a model guessing at a winner.

const fs = require('fs');
const path = require('path');

const STORE_FILENAME = '.nexus-ai-experiments.json';
const MIN_SAMPLES_FOR_VERDICT = 5;

function storePath(projectPath) {
  return path.join(projectPath, STORE_FILENAME);
}

function loadStore(projectPath) {
  const file = storePath(projectPath);
  if (!fs.existsSync(file)) return { experiments: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && data.experiments ? data : { experiments: {} };
  } catch {
    return { experiments: {} };
  }
}

function saveStore(projectPath, store) {
  fs.writeFileSync(storePath(projectPath), JSON.stringify(store, null, 2), 'utf8');
}

function createExperiment(projectPath, { name, description, variantA, variantB }) {
  if (!name || !variantA || !variantB) return { ok: false, error: 'name, variantA, and variantB are required.' };
  const store = loadStore(projectPath);
  if (store.experiments[name]) return { ok: false, error: `An experiment named "${name}" already exists.` };
  store.experiments[name] = {
    name,
    description: description || '',
    variantA,
    variantB,
    createdAt: new Date().toISOString(),
    observations: { [variantA]: [], [variantB]: [] },
  };
  saveStore(projectPath, store);
  return { ok: true, experiment: store.experiments[name] };
}

function recordObservation(projectPath, { name, variant, value }) {
  if (typeof value !== 'number') return { ok: false, error: 'value (a number) is required.' };
  const store = loadStore(projectPath);
  const exp = store.experiments[name];
  if (!exp) return { ok: false, error: `No experiment named "${name}".` };
  if (!exp.observations[variant]) return { ok: false, error: `"${variant}" is not a variant of experiment "${name}".` };
  exp.observations[variant].push({ value, recordedAt: new Date().toISOString() });
  saveStore(projectPath, store);
  return { ok: true };
}

function stats(values) {
  const n = values.length;
  if (n === 0) return { n: 0, mean: null, stddev: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { n, mean, stddev: Math.sqrt(variance) };
}

/**
 * Compares the two variants' recorded observations. Only calls a winner
 * once both variants have at least MIN_SAMPLES_FOR_VERDICT observations and
 * their mean±stddev ranges don't overlap - a deliberately conservative bar,
 * not a real significance test, but one that won't call a winner off noise.
 */
function analyzeExperiment(projectPath, name) {
  const store = loadStore(projectPath);
  const exp = store.experiments[name];
  if (!exp) return { ok: false, error: `No experiment named "${name}".` };

  const valuesA = exp.observations[exp.variantA].map((o) => o.value);
  const valuesB = exp.observations[exp.variantB].map((o) => o.value);
  const statsA = { variant: exp.variantA, ...stats(valuesA) };
  const statsB = { variant: exp.variantB, ...stats(valuesB) };

  let verdict = 'insufficient-data';
  let winner = null;
  if (statsA.n >= MIN_SAMPLES_FOR_VERDICT && statsB.n >= MIN_SAMPLES_FOR_VERDICT) {
    const aHigh = statsA.mean + statsA.stddev, aLow = statsA.mean - statsA.stddev;
    const bHigh = statsB.mean + statsB.stddev, bLow = statsB.mean - statsB.stddev;
    const overlaps = aLow <= bHigh && bLow <= aHigh;
    if (overlaps) {
      verdict = 'no-clear-difference';
    } else {
      verdict = 'clear-difference';
      winner = statsA.mean > statsB.mean ? exp.variantA : exp.variantB;
    }
  }

  return { ok: true, name, description: exp.description, statsA, statsB, verdict, winner };
}

function listExperiments(projectPath) {
  const store = loadStore(projectPath);
  return Object.values(store.experiments).map((e) => ({
    name: e.name,
    description: e.description,
    variantA: e.variantA,
    variantB: e.variantB,
    sampleCountA: e.observations[e.variantA].length,
    sampleCountB: e.observations[e.variantB].length,
    createdAt: e.createdAt,
  }));
}

module.exports = { createExperiment, recordObservation, analyzeExperiment, listExperiments };
