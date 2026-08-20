// smokerSupport.js
// Main-process module for Smoker-Hours-Tracker support in Nexus.
// Detects TypeScript/React/Vite projects and configures Nexus appropriately.
// Enables full-stack development with frontend (Vite) + backend (Express) support.

const path = require('path');
const fs = require('fs');

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
    const hasFirebase = !!(packageJson.dependencies?.firebase || packageJson.dependencies?.['firebase-admin']);
    const hasBackend = fs.existsSync(serverTsPath) || hasExpress;
    const hasEnvExample = fs.existsSync(envExamplePath);

    // Determine if this is Smoker or similar full-stack project
    const isSmoker = hasTypeScript && hasReact && hasVite && hasExpress && hasBackend;
    const isModern = hasTypeScript && (hasReact || hasVite || hasExpress);

    return {
      type: isSmoker ? 'smoker-stack' : isModern ? 'modern' : 'legacy',
      isTypeScript: hasTypeScript,
      isReact: hasReact,
      isVite: hasVite,
      hasExpress: hasExpress,
      hasFirebase: hasFirebase,
      hasBackend: hasBackend,
      hasEnvExample: hasEnvExample,
      scripts: packageJson.scripts || {},
      devCommand: packageJson.scripts?.dev || 'npm run dev',
      buildCommand: packageJson.scripts?.build || 'npm run build',
      startCommand: packageJson.scripts?.start || 'npm start',
      lintCommand: packageJson.scripts?.lint || 'npm run lint',
      isSmoker,
      isModern
    };
  } catch (err) {
    console.error('Error detecting project type:', err);
    return { type: 'error', isTypeScript: false, isReact: false, error: err.message };
  }
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
 * Returns Smoker-specific commands if applicable
 */
function getSmokerCommands(projectPath, scripts) {
  const smokerCommands = [];
  
  // Check for Smoker-specific scripts
  if (scripts['generate:release']) {
    smokerCommands.push({
      label: 'Generate Release',
      command: 'npm run generate:release',
      description: 'Generate release metadata'
    });
  }
  
  if (scripts['generate:trusted-runtime']) {
    smokerCommands.push({
      label: 'Generate Trusted Runtime',
      command: 'npm run generate:trusted-runtime',
      description: 'Build secure server, client, and storage layers'
    });
  }
  
  if (scripts['dev']) {
    smokerCommands.push({
      label: 'Start Dev (Full Stack)',
      command: 'npm run dev',
      description: 'Launch with Vite frontend + Express backend'
    });
  }
  
  if (scripts['build']) {
    smokerCommands.push({
      label: 'Build Production',
      command: 'npm run build',
      description: 'Build frontend + bundle backend'
    });
  }
  
  if (scripts['lint']) {
    smokerCommands.push({
      label: 'Type Check & Lint',
      command: 'npm run lint',
      description: 'Run TypeScript type checking'
    });
  }
  
  return smokerCommands;
}

/**
 * Creates a Smoker-specific configuration object
 */
function createSmokerConfig(projectPath) {
  const projectType = detectProjectType(projectPath);
  const envVars = parseEnvExample(projectPath);
  const tsStatus = getTypeScriptStatus(projectPath);
  const smokerCommands = getSmokerCommands(projectPath, projectType.scripts);
  
  return {
    projectPath,
    projectType,
    envVars,
    tsStatus,
    smokerCommands,
    readyForDevelopment: projectType.isTypeScript && projectType.isReact && projectType.isVite,
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
  getSmokerCommands,
  createSmokerConfig,
  generateSetupSteps
};
