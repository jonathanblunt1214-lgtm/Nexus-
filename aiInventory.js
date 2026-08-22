// aiInventory.js
// Main-process facade for repository inventory scanning.
// Heavy traversal and file inspection execute in inventoryWorker.js so the
// Electron main event loop remains responsive on large workspaces.

const path = require('path');
const { Worker } = require('worker_threads');

function scanProject(projectPath) {
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

module.exports = { scanProject };
