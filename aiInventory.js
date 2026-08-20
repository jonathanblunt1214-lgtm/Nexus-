// aiInventory.js
// Main-process module: scans a project folder and builds a real inventory of
// the AI models, API keys, config files, and guardrail/safety files it uses.
// Read-only - never edits anything. This is the "know what you have" module
// the rest of the AI Improvement Framework (aiMetrics, aiGuardrailTester,
// aiUpgradeOrchestrator, etc.) is built on top of.

const fs = require('fs');
const path = require('path');

const SCAN_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.json', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', 'coverage']);
const MAX_FILES_SCANNED = 4000;
const MAX_FILE_SIZE = 1_000_000; // skip anything absurdly large (bundles, lockfiles handled separately)

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

function walk(dir, depth, out) {
  if (out.length >= MAX_FILES_SCANNED) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES_SCANNED) return;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, depth + 1, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function readSafe(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_FILE_SIZE) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function scanProject(projectPath) {
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

  if (!projectPath || !fs.existsSync(projectPath)) {
    return { ...inventory, error: 'Folder not found.' };
  }

  // 1. AI-related npm dependencies from package.json (cheap, exact).
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const aiPkgPattern = /genai|generative-ai|anthropic|openai|@xenova|ollama|langchain|firebase/i;
      Object.entries(deps || {}).forEach(([name, version]) => {
        if (aiPkgPattern.test(name)) inventory.aiPackages.push({ name, version });
      });
    } catch {
      // malformed package.json - not fatal for the rest of the scan
    }
  }

  // 2. Required API keys from .env.example (never reads the real .env - no secrets touched).
  const envExample = path.join(projectPath, '.env.example');
  const envContent = readSafe(envExample);
  if (envContent) {
    const keyPattern = /^([A-Z][A-Z0-9_]*(?:_API_KEY|_KEY|_TOKEN))\s*=/gm;
    let m;
    while ((m = keyPattern.exec(envContent))) {
      const name = m[1];
      if (!inventory.apiKeys.some((k) => k.name === name)) {
        inventory.apiKeys.push({ name, isSetInEnvironment: !!process.env[name] });
      }
    }
  }

  // 3. Walk source files once, classify each by name and (for smaller files) content.
  const files = [];
  walk(projectPath, 0, files);
  inventory.filesScanned = files.length;

  const seenModels = new Set();
  for (const file of files) {
    const base = path.basename(file);
    const ext = path.extname(file);

    if (CONFIG_NAME_PATTERNS.some((p) => p.test(base))) {
      inventory.configs.push({ path: path.relative(projectPath, file) });
    }
    if (GUARDRAIL_NAME_PATTERNS.some((p) => p.test(base))) {
      inventory.guardrails.push({ path: path.relative(projectPath, file) });
    }

    if (!SCAN_EXTENSIONS.has(ext)) continue;
    if (base === 'package-lock.json' || base === 'yarn.lock') continue;

    const content = readSafe(file);
    if (!content) continue;

    for (const [type, pattern] of Object.entries(MODEL_PATTERNS)) {
      const match = content.match(pattern);
      if (match) {
        const key = `${type}:${match[0]}`;
        if (!seenModels.has(key)) {
          seenModels.add(key);
          inventory.models.push({
            type,
            match: match[0],
            file: path.relative(projectPath, file),
          });
        }
      }
    }
  }

  return inventory;
}

module.exports = { scanProject };
