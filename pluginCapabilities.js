const fs = require('fs');
const path = require('path');

const MAX_FILES_PER_WRITE = 32;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

function safeWorkspacePath(projectRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath)) {
    throw new Error('workspace:write requires a non-empty relative path');
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || normalized.includes(`${path.sep}..${path.sep}`)) {
    throw new Error('workspace:write path escapes the project');
  }
  const root = fs.realpathSync(path.resolve(projectRoot));
  const target = path.resolve(root, normalized);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('workspace:write path escapes the project');

  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor) && ancestor !== root) ancestor = path.dirname(ancestor);
  const realAncestor = fs.realpathSync(ancestor);
  if (realAncestor !== root && !realAncestor.startsWith(`${root}${path.sep}`)) {
    throw new Error('workspace:write path resolves through a symlink outside the project');
  }
  return { root, target, relative: normalized };
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.nexus-plugin-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } finally {
    try { fs.rmSync(temp, { force: true }); } catch {}
  }
}

function createWorkspaceWriteHandler(projectRoot) {
  return async (payload = {}, context = {}) => {
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!files.length || files.length > MAX_FILES_PER_WRITE) throw new Error(`workspace:write accepts 1-${MAX_FILES_PER_WRITE} files per call`);
    const overwrite = payload.overwrite === true;
    let totalBytes = 0;
    const prepared = files.map((item) => {
      if (!item || typeof item !== 'object' || typeof item.content !== 'string') throw new Error('workspace:write files require path and string content');
      const location = safeWorkspacePath(projectRoot, item.path);
      const bytes = Buffer.byteLength(item.content, 'utf8');
      if (bytes > MAX_FILE_BYTES) throw new Error(`workspace:write file exceeds ${MAX_FILE_BYTES} bytes: ${item.path}`);
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`workspace:write payload exceeds ${MAX_TOTAL_BYTES} bytes`);
      if (!overwrite && fs.existsSync(location.target)) throw new Error(`workspace:write will not overwrite existing file without explicit overwrite: ${item.path}`);
      return { ...location, content: item.content, bytes };
    });

    for (const item of prepared) writeAtomic(item.target, item.content);
    return {
      ok: true,
      pluginId: context.pluginId || null,
      written: prepared.map((item) => ({ path: item.relative, bytes: item.bytes })),
      overwrite,
    };
  };
}

function createPluginCapabilityHandlers(projectRoot) {
  return {
    'workspace:write': createWorkspaceWriteHandler(projectRoot),
  };
}

module.exports = {
  MAX_FILES_PER_WRITE,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  safeWorkspacePath,
  createWorkspaceWriteHandler,
  createPluginCapabilityHandlers,
};
