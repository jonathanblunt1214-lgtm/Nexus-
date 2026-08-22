// atomicWrite.js
// Two-stage JSON persistence helpers. They write the complete replacement
// payload to a sibling temporary file, then atomically rename it over the
// target. The previous target remains intact if the write or rename fails.

const fs = require('fs');
const path = require('path');

function validateTargetPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new TypeError('targetPath must be a non-empty string.');
  }
}

function writeJsonAtomicSync(targetPath, data, options = {}) {
  validateTargetPath(targetPath);
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

async function writeJsonAtomic(targetPath, data, options = {}) {
  validateTargetPath(targetPath);
  const fsPromises = options.fsPromises || fs.promises;
  const tempPath = options.tempPath || `${targetPath}.tmp`;
  const payload = JSON.stringify(data, null, 2);

  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });

  try {
    await fsPromises.writeFile(tempPath, payload, 'utf8');
    await fsPromises.rename(tempPath, targetPath);
  } catch (err) {
    try {
      await fsPromises.rm(tempPath, { force: true });
    } catch {
      // Cleanup failure must not hide the original persistence error.
    }
    throw new Error(`Atomic JSON persistence failed for ${targetPath}: ${err.message}`);
  }
}

module.exports = { writeJsonAtomicSync, writeJsonAtomic };
