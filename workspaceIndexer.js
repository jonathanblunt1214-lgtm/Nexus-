// workspaceIndexer.js
// Incremental SHA-256 workspace state tracking used by semantic context workers.
// Pure logic: no filesystem access and no Electron dependencies.

const { createHash } = require('crypto');

function computeFileHash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function computeMerkleRoot(entries) {
  let level = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([filePath, hash]) =>
      createHash('sha256').update(`${filePath}\0${hash}`).digest('hex')
    );

  if (level.length === 0) return computeFileHash('');

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      next.push(createHash('sha256').update(left + right).digest('hex'));
    }
    level = next;
  }

  return level[0];
}

function indexWorkspace(files, previousIndex = {}) {
  const hashes = {};
  const changed = [];
  const unchanged = [];

  for (const file of files) {
    const hash = computeFileHash(file.content);
    hashes[file.path] = hash;
    if (previousIndex[file.path] === hash) unchanged.push(file.path);
    else changed.push(file.path);
  }

  const removed = Object.keys(previousIndex).filter((filePath) => !(filePath in hashes));

  return {
    hashes,
    changed,
    unchanged,
    removed,
    rootHash: computeMerkleRoot(hashes),
  };
}

module.exports = {
  computeFileHash,
  computeMerkleRoot,
  indexWorkspace,
};
