// inventoryWorker.js
// Worker-thread implementation for repository inventory scanning. This keeps
// recursive traversal and file content inspection off Electron's main thread.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs').promises;
const path = require('path');

const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.json', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);
const MAX_FILES_SCANNED = 20000;
const MAX_FILE_SIZE = 1_000_000;

const MODEL_PATTERNS = {
  gemini: /gemini-[\w.-]+|@google\/genai|@google\/generative-ai/i,
  claude: /claude-[\w.-]+|@anthropic-ai\/sdk/i,
  gpt: /gpt-[\w.-]+|\bopenai\b/i,
  nvidiaNim: /nvidia[_-]?nim|qwen\/qwen[\w.-]*/i,
  local: /\bollama\b|llama\.cpp|@xenova\/transformers/i,
};

const CONFIG_NAME_PATTERNS = [
  /geminiconfig/i,
  /(char|nexus)?gptpolicy/i,
  /(char|nexus)?gptcontext/i,
  /ai[._-]?config/i,
  /llm[._-]?config/i,
  /model[._-]?config/i,
];

const GUARDRAIL_NAME_PATTERNS = [
  /guardrail/i,
  /constitution/i,
  /policy/i,
  /safety/i,
];

async function walk(dir, out = []) {
  if (out.length >= MAX_FILES_SCANNED) return out;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (out.length >= MAX_FILES_SCANNED) break;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(fullPath, out);
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }

  return out;
}

async function readSafe(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return null;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function scanProject(projectPath) {
  const inventory = {
    projectPath,
    scannedAt: new Date().toISOString(),
    models: [],
    apiKeys: [],
    configs: [],
    guardrails: [],
    aiPackages: [],
    filesScanned: 0,
  };

  try {
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) return { ...inventory, error: 'Folder not found.' };
  } catch {
    return { ...inventory, error: 'Folder not found.' };
  }

  const pkgPath = path.join(projectPath, 'package.json');
  const pkgContent = await readSafe(pkgPath);
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const aiPkgPattern = /genai|generative-ai|anthropic|openai|@xenova|ollama|langchain|firebase/i;
      for (const [name, version] of Object.entries(deps || {})) {
        if (aiPkgPattern.test(name)) inventory.aiPackages.push({ name, version });
      }
    } catch {
      // A malformed package.json does not invalidate the rest of the scan.
    }
  }

  const envContent = await readSafe(path.join(projectPath, '.env.example'));
  if (envContent) {
    const keyPattern = /^([A-Z][A-Z0-9_]*(?:_API_KEY|_KEY|_TOKEN))\s*=/gm;
    let match;
    while ((match = keyPattern.exec(envContent))) {
      const name = match[1];
      if (!inventory.apiKeys.some((item) => item.name === name)) {
        inventory.apiKeys.push({ name, isSetInEnvironment: !!process.env[name] });
      }
    }
  }

  const files = await walk(projectPath);
  inventory.filesScanned = files.length;

  const seenModels = new Set();
  for (const file of files) {
    const base = path.basename(file);
    const ext = path.extname(file).toLowerCase();

    if (CONFIG_NAME_PATTERNS.some((pattern) => pattern.test(base))) {
      inventory.configs.push({ path: path.relative(projectPath, file) });
    }
    if (GUARDRAIL_NAME_PATTERNS.some((pattern) => pattern.test(base))) {
      inventory.guardrails.push({ path: path.relative(projectPath, file) });
    }

    if (!SCAN_EXTENSIONS.has(ext)) continue;
    if (base === 'package-lock.json' || base === 'yarn.lock') continue;

    const content = await readSafe(file);
    if (!content) continue;

    for (const [type, pattern] of Object.entries(MODEL_PATTERNS)) {
      const modelMatch = content.match(pattern);
      if (!modelMatch) continue;

      const key = `${type}:${modelMatch[0]}`;
      if (seenModels.has(key)) continue;
      seenModels.add(key);
      inventory.models.push({
        type,
        match: modelMatch[0],
        file: path.relative(projectPath, file),
      });
    }
  }

  return inventory;
}

scanProject(workerData.projectPath)
  .then((inventory) => parentPort.postMessage({ ok: true, inventory }))
  .catch((err) => parentPort.postMessage({ ok: false, error: err.message }));
