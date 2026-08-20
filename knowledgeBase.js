// knowledgeBase.js
// Main-process module: a small cross-project knowledge base for AI-related
// lessons learned (e.g. "swapping to model X cut latency 30% but needed a
// prompt tweak"). Stored once per Nexus install (not per-project), since the
// whole point is carrying patterns forward into the *next* project.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STORE_PATH = path.join(os.homedir(), '.nexus-ai-knowledge-base.json');
const MAX_ENTRIES = 1000;

function loadStore() {
  if (!fs.existsSync(STORE_PATH)) return { entries: [] };
  try {
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return data && Array.isArray(data.entries) ? data : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

function saveStore(store) {
  fs.writeFileSync(STORE_PATH, JSON.stringify({ entries: store.entries.slice(-MAX_ENTRIES) }, null, 2), 'utf8');
}

/**
 * Adds one lesson/pattern to the knowledge base.
 * entry: { title, lesson, tags: string[], project }
 */
function addEntry({ title, lesson, tags, project }) {
  if (!title || !lesson) return { ok: false, error: 'title and lesson are required.' };
  const store = loadStore();
  const record = {
    id: crypto.randomUUID(),
    title,
    lesson,
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    project: project || null,
    addedAt: new Date().toISOString(),
  };
  store.entries.push(record);
  saveStore(store);
  return { ok: true, entry: record };
}

/**
 * Simple case-insensitive substring search over title, lesson, and tags.
 */
function search(query) {
  const store = loadStore();
  if (!query) return store.entries.slice().reverse();
  const q = query.toLowerCase();
  return store.entries
    .filter((e) => e.title.toLowerCase().includes(q) || e.lesson.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)))
    .reverse();
}

function listAll() {
  return loadStore().entries.slice().reverse();
}

module.exports = { addEntry, search, listAll };
