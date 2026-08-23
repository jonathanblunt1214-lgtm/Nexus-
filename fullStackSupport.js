// fullStackSupport.js
// Main-process module for full-stack project support in Nexus.
// Detects TypeScript/React/Vite/Express-style projects and surfaces the
// setup steps and commands they need, so Nexus isn't limited to simple
// single-process JS projects.

const path = require('path');
const fs = require('fs');
const { detectOfficialPlatforms } = require('./officialDevelopmentPlatforms');

/**
 * Detects project type and returns configuration
 */
function detectProjectType(projectPath) {
  const packageJsonPath = path.join(projectPath, 'package.json');
  const tsconfigPath = path.join(projectPath, 'tsconfig.json');
  const viteConfigPath = path.join(projectPath, 'vite.config.ts');
  const serverTsPath = path.join(projectPath, 'server.ts');
  const firebaseJsonPath = path.join(projectPath, 'firebase.json');
  const envExamplePath = path.join(projectPath, '.env.example');

  if (!fs.existsSync(packageJsonPath)) {
    return { type: 'unknown', isTypeScript: false, isReact: false };
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const hasTypeScript = fs.existsSync(tsconfigPath);
    const hasVite = fs.existsSync(viteConfigPath);
    const hasReact = !!(packageJson.dependencies?.react || packageJson.devDependencies?.react);
    const hasExpress = !!(packageJson.dependencies?.express || packageJson.devDependencies?.express);
    const hasFirebase = !!(packageJson.dependencies?.firebase || packageJson.dependencies?.['firebase-admin']) || fs.existsSync(firebaseJsonPath);
    const hasBackend = fs.existsSync(serverTsPath) || hasExpress;
    const hasEnvExample = fs.existsSync(envExamplePath);

    // Capacitor-wrapped mobile companion app (e.g. an Android/iOS build
    // alongside the web app) - detected the same way as everything else
    // here: real config file or real dependency, never assumed.
    const capacitorConfigPath1 = path.join(projectPath, 'capacitor.config.json');
    const capacitorConfigPath2 = path.join(projectPath, 'capacitor.config.ts');
    const hasCapacitor = fs.existsSync(capacitorConfigPath1) || fs.existsSync(capacitorConfigPath2) ||
      !!(packageJson.dependencies?.['@capacitor/core'] || packageJson.devDependencies?.['@capacitor/core']);

    const isFullStack = hasTypeScript && hasReact && hasVite && hasBackend;
    const isModern = hasTypeScript && (hasReact || hasVite || hasExpress);

    return {
      type: isFullStack ? 'full-stack' : isModern ? 'modern' : 'legacy',
      isTypeScript: hasTypeScript,
      isReact: hasReact,
      isVite: hasVite,
      hasExpress: hasExpress,
      hasFirebase: hasFirebase,
      hasCapacitor: hasCapacitor,
      hasBackend: hasBackend,
      hasEnvExample: hasEnvExample,
      scripts: packageJson.scripts || {},
      devCommand: packageJson.scripts?.dev || 'npm run dev',
      buildCommand: packageJson.scripts?.build || 'npm run build',
      startCommand: packageJson.scripts?.start || 'npm start',
      lintCommand: packageJson.scripts?.lint || 'npm run lint',
      isFullStack,
      isModern
    };
  } catch (err) {
    console.error('Error detecting project type:', err);
    return { type: 'error', isTypeScript: false, isReact: false, error: err.message };
  }
}

/**
 * Surfaces this project's OWN real npm scripts for mobile (Capacitor) builds
 * and Firebase operations - Nexus has no dedicated Capacitor/Firebase UI
 * (no emulator, no device preview), so this is deliberately just discovery:
 * find whatever real scripts the project already defines and hand back
 * {label, command, description} for each, same shape as
 * getFullStackCommands(). Never invents a script name that doesn't exist in
 * this project's own package.json.
 */
function getMobileAndFirebaseCommands(projectPath, scripts, hasCapacitor, hasFirebase) {
  const commands = [];
  const scriptNames = Object.keys(scripts || {});

  if (hasCapacitor) {
    const capScripts = scriptNames.filter((name) => /\b(cap|capacitor|android|ios)\b/i.test(name));
    for (const name of capScripts) {
      commands.push({
        label: `Mobile: ${name}`,
        command: `npm run ${name}`,
        description: `This project's own Capacitor/mobile script ("${scripts[name]}"). Nexus has no built-in Android/iOS emulator or device preview - this runs the project's real build/sync command and streams its output, same as Deploy.`,
        category: 'mobile',
      });
    }
    if (capScripts.length === 0) {
      commands.push({
        label: 'Mobile: sync (npx cap sync)',
        command: 'npx cap sync',
        description: 'Capacitor was detected (capacitor.config.* or @capacitor/core) but this project has no dedicated npm script for it - falling back to the standard Capacitor CLI command directly.',
        category: 'mobile',
      });
    }
  }

  if (hasFirebase) {
    const firebaseScripts = scriptNames.filter((name) => /\b(firebase|firestore|emulator)\b/i.test(name));
    for (const name of firebaseScripts) {
      commands.push({
        label: `Firebase: ${name}`,
        command: `npm run ${name}`,
        description: `This project's own Firebase-related script ("${scripts[name]}"). Nexus has no dedicated Firebase ops panel beyond the GCP project ID field in Config - this runs the project's real script and streams its output.`,
        category: 'firebase',
      });
    }
  }

  return commands;
}

/**
 * Parses .env.example file and returns required environment variables
 */
function parseEnvExample(projectPath) {
  const envExamplePath = path.join(projectPath, '.env.example');

  if (!fs.existsSync(envExamplePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(envExamplePath, 'utf-8');
    const envVars = [];

    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, value] = trimmed.split('=');
        if (key) {
          envVars.push({
            key: key.trim(),
            example: value?.trim() || '',
            description: extractDescription(content, key.trim())
          });
        }
      }
    });

    return envVars;
  } catch (err) {
    console.error('Error parsing .env.example:', err);
    return [];
  }
}

/**
 * Extracts description from comments above env var
 */
function extractDescription(content, key) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(key + '=')) {
      if (i > 0 && lines[i - 1].startsWith('#')) {
        return lines[i - 1].replace('#', '').trim();
      }
    }
  }
  return '';
}

/**
 * Checks if TypeScript files exist and returns compilation status
 */
function getTypeScriptStatus(projectPath) {
  const srcPath = path.join(projectPath, 'src');
  const tsFiles = [];

  function findTsFiles(dir) {
    if (!fs.existsSync(dir)) return;

    try {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory() && !file.startsWith('.')) {
          findTsFiles(filePath);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          tsFiles.push(filePath);
        }
      });
    } catch (err) {
      // Ignore read errors
    }
  }

  findTsFiles(srcPath);

  return {
    hasTypeScript: fs.existsSync(path.join(projectPath, 'tsconfig.json')),
    tsFileCount: tsFiles.length,
    tsFiles: tsFiles.slice(0, 10) // First 10
  };
}

/**
 * Returns the standard full-stack commands this project actually defines
 * (only ever surfaces scripts that exist in this project's own
 * package.json - never assumes any project-specific script names).
 */
function getFullStackCommands(projectPath, scripts) {
  const commands = [];

  if (scripts['dev']) {
    commands.push({
      label: 'Start Dev (Full Stack)',
      command: 'npm run dev',
      description: 'Launch the dev server(s) defined by this project'
    });
  }

  if (scripts['build']) {
    commands.push({
      label: 'Build Production',
      command: 'npm run build',
      description: 'Build frontend + bundle backend, per this project\'s own build script'
    });
  }

  if (scripts['lint']) {
    commands.push({
      label: 'Type Check & Lint',
      command: 'npm run lint',
      description: 'Run this project\'s own lint/type-check script'
    });
  }

  if (scripts['test']) {
    commands.push({
      label: 'Run Tests',
      command: 'npm test',
      description: 'Run this project\'s own test script'
    });
  }

  return commands;
}

/**
 * Creates a full-stack-aware configuration summary for a project.
 */
function createFullStackConfig(projectPath) {
  const projectType = detectProjectType(projectPath);
  const envVars = parseEnvExample(projectPath);
  const tsStatus = getTypeScriptStatus(projectPath);
  const fullStackCommands = getFullStackCommands(projectPath, projectType.scripts);
  const mobileAndFirebaseCommands = getMobileAndFirebaseCommands(projectPath, projectType.scripts, projectType.hasCapacitor, projectType.hasFirebase);
  const officialPlatforms = detectOfficialPlatforms(projectPath);

  return {
    projectPath,
    projectType,
    envVars,
    tsStatus,
    fullStackCommands,
    mobileAndFirebaseCommands,
    officialPlatforms,
    readyForDevelopment: (projectType.isTypeScript && projectType.isReact && projectType.isVite) || officialPlatforms.length > 0,
    requiresSetup: envVars.length > 0 || !fs.existsSync(path.join(projectPath, '.env')),
    setupSteps: generateSetupSteps(projectPath, projectType, envVars)
  };
}

/**
 * Generates setup steps needed before development
 */
function generateSetupSteps(projectPath, projectType, envVars) {
  const steps = [];

  // Check npm install
  if (!fs.existsSync(path.join(projectPath, 'node_modules'))) {
    steps.push({
      step: 1,
      label: 'npm install',
      description: 'Install dependencies',
      command: 'npm install',
      required: true
    });
  }

  // Check .env file
  if (envVars.length > 0 && !fs.existsSync(path.join(projectPath, '.env'))) {
    steps.push({
      step: steps.length + 1,
      label: 'Configure .env',
      description: 'Set up environment variables',
      required: true,
      envVars: envVars
    });
  }

  // TypeScript compilation
  if (projectType.isTypeScript) {
    steps.push({
      step: steps.length + 1,
      label: 'npm run lint',
      description: 'Verify TypeScript compilation',
      command: 'npm run lint',
      required: false
    });
  }

  return steps;
}

module.exports = {
  detectProjectType,
  parseEnvExample,
  getTypeScriptStatus,
  getFullStackCommands,
  getMobileAndFirebaseCommands,
  createFullStackConfig,
  generateSetupSteps
};
