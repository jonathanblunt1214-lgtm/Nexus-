const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

class PersistentMemoryEngine {
  constructor({ projectRoot, embedder }) {
    if (!projectRoot || !embedder) throw new Error('projectRoot and embedder are required');
    this.projectRoot = path.resolve(projectRoot);
    this.embedder = embedder;
    this.file = path.join(this.projectRoot, '.nexus-memory.json');
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  save(items) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  async indexAcceptedPreferences(preferences, sourceCommitHash) {
    if (!sourceCommitHash) throw new Error('Accepted/merged sourceCommitHash is required');
    const items = this.load();
    for (const pref of preferences || []) {
      if (!pref || typeof pref.preferenceSummary !== 'string' || !pref.preferenceSummary.trim()) continue;
      const vectorEmbedding = await this.embedder.embed(pref.preferenceSummary);
      items.push({
        id: `mem_${crypto.randomUUID()}`,
        category: pref.category || 'architectural_pattern',
        preferenceSummary: pref.preferenceSummary.trim(),
        vectorEmbedding,
        sourceCommitHash,
        pinned: !!pref.pinned,
        timestamp: Date.now(),
      });
    }
    this.save(items);
    return items.length;
  }

  async recallRelevantPreferences(taskPrompt, topK = 5) {
    const query = await this.embedder.embed(taskPrompt);
    return this.load()
      .map((item) => ({ ...item, score: cosine(query, item.vectorEmbedding || []) }))
      .sort((a, b) => (b.pinned - a.pinned) || (b.score - a.score))
      .slice(0, topK)
      .map(({ vectorEmbedding, ...item }) => item);
  }

  list() { return this.load().map(({ vectorEmbedding, ...item }) => item); }

  delete(id) {
    const before = this.load();
    const after = before.filter((item) => item.id !== id);
    this.save(after);
    return before.length !== after.length;
  }

  pin(id, pinned = true) {
    const items = this.load();
    const item = items.find((x) => x.id === id);
    if (!item) return false;
    item.pinned = !!pinned;
    this.save(items);
    return true;
  }

  buildPlanningContext(taskPrompt, recalled) {
    return {
      taskPrompt,
      developerPreferences: (recalled || []).map((x) => x.preferenceSummary),
      precedence: 'Current task instructions and security/constitution constraints override remembered preferences.',
    };
  }
}

module.exports = { PersistentMemoryEngine, cosine };
