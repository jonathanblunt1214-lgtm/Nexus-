// aiInventory.js
// Main-process facade for repository inventory scanning.
// Heavy traversal, file inspection, and semantic parsing execute in workers so
// the Electron main event loop remains responsive on large workspaces.

const path = require('path');
const { Worker } = require('worker_threads');
const { getSemanticContext } = require('./semanticContext');

function scanInventoryWorker(projectPath) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'inventoryWorker.js'), {
      workerData: { projectPath },
    });

    let settled = false;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    worker.once('message', (message) => {
      if (message && message.ok) {
        finish(resolve, message.inventory);
      } else {
        finish(reject, new Error(message?.error || 'Inventory worker failed without an error message.'));
      }
    });

    worker.once('error', (err) => finish(reject, err));

    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        finish(reject, new Error(`Inventory worker exited with code ${code}.`));
      }
    });
  });
}

async function scanProject(projectPath) {
  const inventory = await scanInventoryWorker(projectPath);

  try {
    const semanticContext = await getSemanticContext(projectPath);
    return { ...inventory, semanticContext };
  } catch (err) {
    // Inventory remains useful even if structural parsing fails. Surface the
    // failure explicitly rather than fabricating an empty semantic result.
    return {
      ...inventory,
      semanticContext: null,
      semanticContextError: err.message,
    };
  }
}

module.exports = { scanProject, getSemanticContext };
