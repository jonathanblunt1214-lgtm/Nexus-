// semanticContext.js
// Main-process facade for semantic repository context. Parsing and indexing
// run in a worker; this module only manages request lifecycle and cached hashes.

const path = require('path');
const { Worker } = require('worker_threads');

const indexCache = new Map();

function getSemanticContext(projectPath, options = {}) {
  const previousIndex = indexCache.get(projectPath) || {};
  const mapCharBudget = Number.isFinite(options.mapCharBudget)
    ? Math.max(512, Math.min(options.mapCharBudget, 8192))
    : 4096;

  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'semanticWorker.js'), {
      workerData: { projectPath, previousIndex, mapCharBudget },
    });

    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    worker.once('message', (message) => {
      if (message && message.ok) {
        indexCache.set(projectPath, message.context.index || {});
        finish(resolve, message.context);
      } else {
        finish(reject, new Error(message?.error || 'Semantic context worker failed without an error message.'));
      }
    });
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        finish(reject, new Error(`Semantic context worker exited with code ${code}.`));
      }
    });
  });
}

function clearSemanticContextCache(projectPath) {
  if (projectPath) indexCache.delete(projectPath);
  else indexCache.clear();
}

module.exports = {
  getSemanticContext,
  clearSemanticContextCache,
};
