# Nexus Enhancement Guide for Smoker-Hours-Tracker

**Objective**: Enable Nexus to effectively support TypeScript + React + Express development for Smoker-Hours-Tracker

---

## Phase 1: TypeScript Support (Immediate - Week 1)

### 1.1 Add TypeScript Dependencies

**File**: `package.json`

```json
{
  "devDependencies": {
    "typescript": "~5.8.2",
    "tsx": "^4.21.0",
    "@types/node": "^26.2.0"
  }
}
```

**Command**: 
```bash
npm install --save-dev typescript tsx @types/node
```

### 1.2 Create TypeScript Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "allowJs": true,
    "noEmit": true,
    "strict": true
  },
  "include": ["main.js", "preload.js", "renderer.js"]
}
```

### 1.3 Add TypeScript Watching

**File**: `package.json` (scripts section)

```json
{
  "scripts": {
    "type-check": "tsc --noEmit",
    "type-check:watch": "tsc --watch --noEmit",
    "start": "npm run type-check:watch & electron ."
  }
}
```

### 1.4 Project Detection Logic

**File**: `projectSettings.js` (add this function)

```javascript
function detectTypeScriptProject(projectPath) {
  const fs = require('fs');
  const path = require('path');
  
  const tsconfigPath = path.join(projectPath, 'tsconfig.json');
  const packageJsonPath = path.join(projectPath, 'package.json');
  
  if (fs.existsSync(tsconfigPath)) {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8')
    );
    
    return {
      isTypeScript: true,
      hasReact: !!(packageJson.dependencies?.react),
      hasVite: !!(packageJson.dependencies?.vite),
      tsVersion: packageJson.devDependencies?.typescript || 'unknown',
      hasTsx: !!(packageJson.devDependencies?.tsx)
    };
  }
  
  return { isTypeScript: false };
}

module.exports = { detectTypeScriptProject };
```

### 1.5 Add Type Checking to UI

**File**: `renderer.js` (add to project actions)

```javascript
// In projectActions object
'Type Check': {
  command: 'npm run type-check',
  description: 'Run TypeScript type checking',
  icon: '✓',
  color: '#007ACC' // TypeScript blue
},

'Watch Types': {
  command: 'npm run type-check:watch',
  description: 'Watch for type errors',
  icon: '👁',
  color: '#1AC620' // Green for watching
}
```

---

## Phase 2: React & Vite Support (Week 2)

### 2.1 Detect Vite Projects

**File**: `projectSettings.js` (add this function)

```javascript
function detectReactViteProject(projectPath) {
  const fs = require('fs');
  const path = require('path');
  
  const viteConfigPath = path.join(projectPath, 'vite.config.ts');
  const packageJsonPath = path.join(projectPath, 'package.json');
  
  if (fs.existsSync(viteConfigPath)) {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8')
    );
    
    const srcDir = fs.existsSync(path.join(projectPath, 'src'));
    const hasReact = !!packageJson.dependencies?.react;
    const hasVite = !!packageJson.dependencies?.vite;
    
    return {
      isViteProject: true,
      hasReact,
      hasVite,
      hasSrcDirectory: srcDir,
      devCommand: packageJson.scripts?.dev || 'vite',
      buildCommand: packageJson.scripts?.build || 'vite build'
    };
  }
  
  return { isViteProject: false };
}

module.exports = { detectReactViteProject };
```

### 2.2 Launch Vite Dev Server

**File**: `projectCloner.js` (add this function)

```javascript
async function launchViteDev(projectPath) {
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    const viteProcess = spawn('npm', ['run', 'dev'], {
      cwd: projectPath,
      stdio: 'pipe'
    });
    
    viteProcess.stdout.on('data', (data) => {
      console.log(`[VITE] ${data}`);
      
      // Detect when server is ready
      if (data.toString().includes('ready in')) {
        resolve({
          process: viteProcess,
          port: extractPort(data.toString())
        });
      }
    });
    
    viteProcess.stderr.on('data', (data) => {
      console.error(`[VITE ERROR] ${data}`);
    });
    
    viteProcess.on('error', reject);
    
    setTimeout(() => reject(new Error('Vite startup timeout')), 30000);
  });
}

function extractPort(output) {
  const match = output.match(/localhost:(\d+)/);
  return match ? parseInt(match[1]) : 5173; // Vite default
}

module.exports = { launchViteDev };
```

### 2.3 Add React-Specific UI Actions

**File**: `renderer.js` (add to project actions)

```javascript
'Start Dev Server': {
  command: 'npm run dev',
  description: 'Launch Vite dev server with HMR',
  icon: '🚀',
  color: '#FF7A00' // Vite orange
},

'Build React': {
  command: 'npm run build',
  description: 'Build for production',
  icon: '📦',
  color: '#61DAFB' // React blue
},

'Preview Build': {
  command: 'npm run preview',
  description: 'Preview production build',
  icon: '👁',
  color: '#4A90E2'
}
```

### 2.4 React File Recognition

**File**: `renderer.js` (file syntax highlighting)

```javascript
const FILE_SYNTAX_MAP = {
  '.tsx': 'tsx',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.js': 'javascript',
  '.css': 'css',
  '.json': 'json'
};

function getFileSyntax(filename) {
  const ext = filename.substring(filename.lastIndexOf('.'));
  return FILE_SYNTAX_MAP[ext] || 'text';
}
```

---

## Phase 3: Backend & Express Support (Week 3)

### 3.1 Detect Express Backend

**File**: `projectSettings.js` (add this function)

```javascript
function detectExpressBackend(projectPath) {
  const fs = require('fs');
  const path = require('path');
  
  const packageJsonPath = path.join(projectPath, 'package.json');
  const serverTsPath = path.join(projectPath, 'server.ts');
  const serverJsPath = path.join(projectPath, 'server.js');
  const serverDirPath = path.join(projectPath, 'server');
  
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(
      fs.readFileSync(packageJsonPath, 'utf8')
    );
    
    const hasExpress = !!packageJson.dependencies?.express;
    const serverFile = fs.existsSync(serverTsPath) ? 'server.ts' :
                       fs.existsSync(serverJsPath) ? 'server.js' : null;
    const hasServerDir = fs.existsSync(serverDirPath);
    
    return {
      hasBackend: hasExpress,
      serverFile,
      hasServerDir,
      backendCommand: packageJson.scripts?.start || 'node server.js'
    };
  }
  
  return { hasBackend: false };
}

module.exports = { detectExpressBackend };
```

### 3.2 Launch Backend Server

**File**: `projectCloner.js` (add this function)

```javascript
async function launchBackend(projectPath, command = 'npm start') {
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    const backendProcess = spawn(command.split(' ')[0], 
                                command.split(' ').slice(1), {
      cwd: projectPath,
      stdio: 'pipe'
    });
    
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) resolve({ process: backendProcess, port: null });
    }, 5000);
    
    backendProcess.stdout.on('data', (data) => {
      console.log(`[BACKEND] ${data}`);
      
      // Check for common "ready" signals
      const output = data.toString().toLowerCase();
      if (output.includes('listening') || 
          output.includes('started') ||
          output.includes('ready')) {
        ready = true;
        clearTimeout(timeout);
        resolve({
          process: backendProcess,
          port: extractPort(data.toString()) || 3000
        });
      }
    });
    
    backendProcess.stderr.on('data', (data) => {
      console.error(`[BACKEND ERROR] ${data}`);
    });
    
    backendProcess.on('error', reject);
  });
}

module.exports = { launchBackend };
```

### 3.3 Dual Process Management

**File**: `main.js` (add process management)

```javascript
class DualProcessManager {
  constructor() {
    this.frontend = null;
    this.backend = null;
    this.isRunning = false;
  }
  
  async startDevelopment(projectPath, hasFrontend = true, hasBackend = true) {
    this.isRunning = true;
    
    try {
      if (hasBackend) {
        console.log('Starting backend...');
        this.backend = await launchBackend(projectPath);
        console.log(`Backend running on port ${this.backend.port}`);
      }
      
      if (hasFrontend) {
        console.log('Starting frontend...');
        this.frontend = await launchViteDev(projectPath);
        console.log(`Frontend running on port ${this.frontend.port}`);
      }
      
      return {
        success: true,
        frontend: this.frontend?.port,
        backend: this.backend?.port
      };
    } catch (error) {
      console.error('Failed to start development:', error);
      this.stopDevelopment();
      throw error;
    }
  }
  
  stopDevelopment() {
    if (this.frontend?.process) {
      this.frontend.process.kill();
    }
    if (this.backend?.process) {
      this.backend.process.kill();
    }
    this.isRunning = false;
  }
}

module.exports = { DualProcessManager };
```

---

## Phase 4: Environment Management (Week 2-3)

### 4.1 Environment Variable Detection

**File**: `projectSettings.js` (add this function)

```javascript
function detectEnvironmentFiles(projectPath) {
  const fs = require('fs');
  const path = require('path');
  
  const envExamplePath = path.join(projectPath, '.env.example');
  const envPath = path.join(projectPath, '.env');
  
  let envVars = [];
  
  if (fs.existsSync(envExamplePath)) {
    const content = fs.readFileSync(envExamplePath, 'utf8');
    envVars = content
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => {
        const [key, value] = line.split('=');
        return { key: key.trim(), example: value?.trim() || '' };
      });
  }
  
  const hasEnvFile = fs.existsSync(envPath);
  
  return {
    envVars,
    hasEnvFile,
    needsConfiguration: !hasEnvFile && envVars.length > 0
  };
}

module.exports = { detectEnvironmentFiles };
```

### 4.2 Environment Configuration UI

**File**: `renderer.js` (add new UI panel)

```javascript
function renderEnvironmentPanel(projectPath, envVars) {
  if (!envVars || envVars.length === 0) return '';
  
  let html = '<div class="env-panel"><h3>Environment Variables</h3>';
  
  envVars.forEach(({ key, example }) => {
    html += `
      <div class="env-var">
        <label>${key}</label>
        <input type="text" placeholder="${example}" data-env-key="${key}">
      </div>
    `;
  });
  
  html += '<button onclick="saveEnvironment()">Save .env</button>';
  html += '</div>';
  
  return html;
}

function saveEnvironment(projectPath, formData) {
  const envContent = Object.entries(formData)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(
    path.join(projectPath, '.env'),
    envContent
  );
}
```

---

## Phase 5: Build Pipeline Orchestration (Week 4)

### 5.1 Custom Script Detection

**File**: `projectSettings.js` (add this function)

```javascript
function detectBuildPipeline(projectPath) {
  const fs = require('fs');
  const packageJsonPath = require('path').join(projectPath, 'package.json');
  
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, 'utf8')
  );
  
  const scripts = packageJson.scripts || {};
  const buildScripts = Object.keys(scripts)
    .filter(key => key.startsWith('generate:') || key.includes('build'))
    .map(key => ({
      name: key,
      command: scripts[key]
    }));
  
  return {
    hasComplexBuild: buildScripts.length > 3,
    buildScripts,
    allScripts: scripts
  };
}

module.exports = { detectBuildPipeline };
```

### 5.2 Build Script Executor

**File**: `pipelineEngine.js` (enhance existing)

```javascript
async function executePipelineScript(projectPath, scriptName) {
  const { spawn } = require('child_process');
  const steps = [];
  
  console.log(`Starting pipeline: ${scriptName}`);
  
  return new Promise((resolve, reject) => {
    const process = spawn('npm', ['run', scriptName], {
      cwd: projectPath,
      stdio: 'pipe'
    });
    
    process.stdout.on('data', (data) => {
      const step = data.toString();
      steps.push(step);
      console.log(`[${scriptName}] ${step}`);
      
      // Emit progress events
      if (global.sendProgressUpdate) {
        global.sendProgressUpdate({
          script: scriptName,
          progress: steps.length,
          current: step.trim()
        });
      }
    });
    
    process.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, steps, scriptName });
      } else {
        reject(new Error(`Script failed: ${scriptName}`));
      }
    });
  });
}

module.exports = { executePipelineScript };
```

### 5.3 Pipeline UI Integration

**File**: `renderer.js` (add pipeline panel)

```javascript
function renderPipelinePanel(buildScripts) {
  let html = '<div class="pipeline-panel"><h3>Build Pipeline</h3>';
  
  buildScripts.forEach(({ name, command }) => {
    html += `
      <div class="pipeline-step">
        <button onclick="runPipelineScript('${name}')">
          ${name}
        </button>
        <small>${command}</small>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
}

async function runPipelineScript(scriptName) {
  const progressDiv = document.getElementById('pipeline-progress');
  progressDiv.innerHTML = `Running ${scriptName}...`;
  
  try {
    const result = await fetch('/api/run-script', {
      method: 'POST',
      body: JSON.stringify({ script: scriptName })
    });
    
    const data = await result.json();
    if (data.success) {
      progressDiv.innerHTML = `✅ ${scriptName} completed`;
    }
  } catch (error) {
    progressDiv.innerHTML = `❌ Error: ${error.message}`;
  }
}
```

---

## Integration Checklist

### Week 1: TypeScript Support
- [ ] Add TypeScript dependencies to `package.json`
- [ ] Create `tsconfig.json`
- [ ] Add type-check scripts
- [ ] Update `projectSettings.js` with `detectTypeScriptProject()`
- [ ] Add type-check buttons to UI
- [ ] Test with Smoker-Hours-Tracker

### Week 2: React & Vite Support
- [ ] Add Vite detection to `projectSettings.js`
- [ ] Implement `launchViteDev()` function
- [ ] Add React-specific UI actions
- [ ] Add file syntax highlighting for `.tsx`/`.jsx`
- [ ] Test dev server launching
- [ ] Test file watching and HMR

### Week 3: Backend Support
- [ ] Add Express detection to `projectSettings.js`
- [ ] Implement `launchBackend()` function
- [ ] Create `DualProcessManager` class
- [ ] Add backend launch button to UI
- [ ] Test simultaneous frontend/backend startup
- [ ] Add process status monitoring

### Week 2-3: Environment Management
- [ ] Add `.env` file detection
- [ ] Create environment variable UI panel
- [ ] Implement `saveEnvironment()` function
- [ ] Test with `.env.example` parsing
- [ ] Add validation for required variables

### Week 4: Build Pipeline
- [ ] Add custom script detection
- [ ] Enhance `pipelineEngine.js`
- [ ] Create pipeline UI panel
- [ ] Add progress tracking
- [ ] Test with `generate:*` scripts
- [ ] Add error handling and reporting

---

## Testing Strategy

### Unit Tests for New Functions
```bash
npm test
```

### Integration Tests
1. **TypeScript Detection**
   - Test with Smoker-Hours-Tracker
   - Verify `tsconfig.json` parsing
   - Confirm type-check execution

2. **Vite Detection & Launch**
   - Test dev server startup
   - Verify port detection
   - Test HMR functionality

3. **Backend Detection & Launch**
   - Test Express detection
   - Verify server startup
   - Test port availability

4. **Dual Process Management**
   - Start frontend + backend together
   - Test cleanup on exit
   - Verify port conflicts handled

### User Acceptance Tests
1. Clone Smoker-Hours-Tracker into Nexus
2. Nexus detects TypeScript + React + Express
3. Click "Start Dev Server"
4. Both frontend (Vite) and backend (Express) launch
5. Open browser to frontend port
6. Confirm application works

---

## Performance Considerations

1. **TypeScript Compilation**: 2-5s per type-check cycle
2. **Vite Dev Server**: 2-3s startup time
3. **Backend Process**: 1-2s startup time
4. **Memory Usage**: +150-200MB for dual processes

---

## Future Enhancements

- Firebase emulator auto-launch
- Docker container management
- Mobile build targeting
- Advanced debugging UI
- Performance profiling tools

---

## Support & Troubleshooting

### Common Issues

**Issue**: Vite dev server doesn't start
- **Solution**: Check `vite.config.ts` exists and is valid
- **Debug**: Run `npm run dev` manually to see actual error

**Issue**: Backend and frontend use same port
- **Solution**: Configure in `.env` or Vite config
- **Debug**: Check for port conflicts with `netstat`

**Issue**: TypeScript errors not showing
- **Solution**: Ensure `tsx` is installed globally: `npm install -g tsx`
- **Debug**: Run `npm run type-check` manually

---

## Summary

This enhancement guide transforms Nexus into a full-stack development environment suitable for modern TypeScript + React + Express applications like Smoker-Hours-Tracker. Implement in phases for manageable rollout.
