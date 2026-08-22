// atomicWrite.js
// Two-stage JSON persistence helper. Writes the complete replacement payload
// to a sibling temporary file, then atomically renames it over the target.
// The previous target remains intact if the write or rename step fails.

const fs = require('fs');
const path = require('path');

function writeJsonAtomicSync(targetPath, data, options = {}) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new TypeError('targetPath must be a non-empty string.');
  }

  const fsImpl = options.fs || fs;
  const tempPath = options.tempPath || `${targetPath}.tmp`;
  const payload = JSON.stringify(data, null, 2);

  fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });

  try {
    fsImpl.writeFileSync(tempPath, payload, 'utf8');
    fsImpl.renameSync(tempPath, targetPath);
  } catch (err) {
    try {
      if (fsImpl.existsSync(tempPath)) fsImpl.unlinkSync(tempPath);
    } catch {
      // Cleanup failure must not hide the original persistence error.
    }
    throw new Error(`Atomic JSON persistence failed for ${targetPath}: ${err.message}`);
  }
}

module.exports = { writeJsonAtomicSync };
