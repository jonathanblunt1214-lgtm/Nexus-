# Nexus ↔ Smoker-Hours-Tracker Integration Model

**Status**: Architecture Blueprint (Not Wired)  
**Version**: 1.0  
**Date**: August 20, 2026  
**Purpose**: Complete model for integrating Nexus with Smoker-Hours-Tracker including AI components

---

## Overview

This document defines the **complete integration architecture** for Nexus to build, develop, and deploy Smoker-Hours-Tracker with full AI component support. This is a **structural model only** — no wiring/implementation code.

The model covers:
- ✅ Process orchestration
- ✅ TypeScript compilation
- ✅ React/Vite frontend launching
- ✅ Express backend launching
- ✅ Firebase integration
- ✅ AI component management (Gemini, CharGPT)
- ✅ Environment configuration
- ✅ Build pipeline execution
- ✅ Deployment workflows

---

## 1. Core Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Nexus UI Layer                           │
│  (Dashboard, Terminal, Project Panel, Dev Server Viewer)    │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│            Integration Controller Layer                      │
│  • Project Detection                                         │
│  • Configuration Loading                                    │
│  • Command Routing                                          │
│  • State Management                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼────┐  ┌──────▼──────┐  ┌───▼────────┐
│  Process   │  │   Smoker    │  │  AI/Cloud  │
│  Manager   │  │  Support    │  │  Integration
│            │  │  (TypeScript │  │  (Gemini,
│ • Vite     │  │  React Vite)│  │  CharGPT)
│ • Backend  │  │             │  │
│ • Build    │  │ • Detection │  │ • Env Vars
│            │  │ • Env Parse │  │ • API Keys
└────────────┘  │ • Setup     │  │ • Auth
                │             │  │
                └─────────────┘  └────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼────┐  ┌──────▼──────┐  ┌───▼────────┐
│  Smoker    │  │  Firebase   │  │ Code Gen   │
│  Project   │  │  Services   │  │ Pipeline   │
│            │  │             │  │            │
│ • Files    │  │ • Firestore │  │ • generate:│
│ • Config   │  │ • Emulator  │  │   release  │
│ • Scripts  │  │ • Rules     │  │ • generate:|
│            │  │             │  │   secure-* │
└────────────┘  └─────────────┘  └────────────┘
```

---

## 2. Data Model Structure

### 2.1 Project Configuration Object
```javascript
{
  // Identity
  projectId: "smoker-hours-tracker",
  projectPath: "/path/to/project",
  name: "Smoker-Hours-Tracker",
  
  // Project Type Detection
  projectType: {
    type: "smoker-stack",
    isTypeScript: true,
    isReact: true,
    isVite: true,
    hasExpress: true,
    hasFirebase: true,
    hasBackend: true,
    isSmoker: true,
    isModern: true
  },
  
  // TypeScript Configuration
  typescript: {
    enabled: true,
    version: "5.8.2",
    configPath: "tsconfig.json",
    strictMode: true,
    jsxMode: "react-jsx",
    files: ["src/**/*.ts", "src/**/*.tsx", "server.ts"],
    needsCompilation: true
  },
  
  // Frontend Configuration (Vite + React)
  frontend: {
    framework: "react",
    version: "19.0.1",
    buildTool: "vite",
    vitePort: 5173,
    viteConfigPath: "vite.config.ts",
    cssFramework: "tailwind",
    plugins: [
      "@vitejs/plugin-react",
      "@tailwindcss/vite"
    ],
    hmrEnabled: true,
    commands: {
      dev: "npm run dev",
      build: "npm run build",
      preview: "npm run preview"
    }
  },
  
  // Backend Configuration (Express)
  backend: {
    framework: "express",
    version: "4.21.2",
    serverFile: "server.ts",
    port: 3000,
    apiPath: "/api",
    commands: {
      start: "npm start",
      dev: "npm run dev"
    }
  },
  
  // AI/Cloud Integration
  aiIntegration: {
    gemini: {
      enabled: true,
      package: "@google/genai",
      version: "2.4.0",
      apiKeyEnv: "GOOGLE_GENAI_API_KEY",
      configured: false,
      requiresSetup: true
    },
    charGPT: {
      enabled: true,
      custom: true,
      description: "Custom CharGPT implementation",
      configPath: "scripts/apply-chargpt-production-policy.mjs"
    },
    firebaseAI: {
      enabled: true,
      services: ["genai", "vertexAI"]
    }
  },
  
  // Firebase Configuration
  firebase: {
    enabled: true,
    packages: ["firebase", "firebase-admin"],
    versions: {
      firebase: "12.17.0",
      firebaseAdmin: "13.4.0"
    },
    services: ["firestore", "auth", "storage"],
    rulesFile: "firestore.rules",
    configFile: "firebase.json",
    emulatorsAvailable: true,
    emulatorPort: 8080,
    projectId: "smokestack-rules-test"
  },
  
  // Environment Variables
  environment: {
    hasEnvFile: false,
    hasEnvExample: true,
    requiredVars: [
      { key: "GOOGLE_GENAI_API_KEY", type: "secret", required: true },
      { key: "FIREBASE_API_KEY", type: "secret", required: true },
      { key: "FIREBASE_PROJECT_ID", type: "config", required: true },
      { key: "VITE_API_BASE", type: "config", required: false, default: "http://localhost:3000" }
    ],
    variables: [] // Populated from .env.example
  },
  
  // Build Pipeline
  buildPipeline: {
    complex: true,
    steps: [
      { step: 1, name: "generate:release", command: "node scripts/generate-release-metadata.mjs" },
      { step: 2, name: "generate:secure-server", command: "npm run generate:secure-server" },
      { step: 3, name: "generate:trusted-runtime", command: "npm run generate:trusted-runtime" },
      { step: 4, name: "vite:build", command: "vite build" },
      { step: 5, name: "esbuild:server", command: "esbuild server.secure.generated.ts --bundle..." }
    ],
    dependencies: {
      "generate:trusted-runtime": ["generate:secure-server", "generate:trusted-storage", "generate:trusted-client"],
      "build": ["generate:release", "generate:trusted-runtime", "vite build"]
    }
  },
  
  // Database Configuration
  database: {
    firestore: {
      enabled: true,
      projectId: "smokestack-prod",
      rulesFile: "firestore.rules",
      indexes: "firestore.indexes.json",
      emulatorSupported: true
    }
  },
  
  // Development Processes
  processes: {
    vite: {
      id: "vite",
      command: "npm run dev",
      status: "stopped",
      port: 5173,
      url: "http://localhost:5173",
      restartable: true
    },
    backend: {
      id: "backend",
      command: "npm start",
      status: "stopped",
      port: 3000,
      url: "http://localhost:3000",
      restartable: true
    },
    firebase: {
      id: "firebase-emulator",
      command: "firebase emulators:start",
      status: "stopped",
      port: 8080,
      requiresSetup: true
    }
  },
  
  // Scripts
  scripts: {
    lint: "npm run lint",
    test: "npm run test:*",
    typeCheck: "npm run lint",
    customScripts: [
      "generate:release",
      "generate:secure-server",
      "generate:trusted-client",
      "generate:trusted-storage",
      "test:firestore-rules",
      "test:chargpt-contract",
      "test:agent-governance"
    ]
  }
}
```

---

## 3. AI Components Model

### 3.1 Gemini Integration
```javascript
{
  componentName: "Gemini AI",
  type: "external-api",
  
  // Package Info
  package: "@google/genai",
  npmUrl: "https://www.npmjs.com/package/@google/genai",
  documentation: "https://ai.google.dev/docs",
  
  // API Configuration
  apiEndpoint: "https://generativelanguage.googleapis.com",
  apiVersion: "v1beta",
  models: [
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash"
  ],
  
  // Authentication
  auth: {
    type: "API_KEY",
    envVar: "GOOGLE_GENAI_API_KEY",
    obtainedFrom: "https://ai.google.dev",
    setupInstructions: "docs/GEMINI-SETUP.md"
  },
  
  // Usage in Smoker
  usedIn: [
    "src/components/AIAssist.tsx",
    "server.ts (API routes)",
    "scripts/apply-verified-knowledge.mjs"
  ],
  
  // Features
  capabilities: [
    "Text generation",
    "Code analysis",
    "Feature suggestions",
    "Bug analysis",
    "Documentation generation"
  ],
  
  // Rate Limits
  rateLimits: {
    freetier: "60 req/min",
    paidTier: "configurable"
  },
  
  // Health Check
  healthCheck: {
    endpoint: "POST /api/ai/health",
    expectedResponse: 200,
    timeout: 5000
  }
}
```

### 3.2 CharGPT Custom Implementation
```javascript
{
  componentName: "CharGPT",
  type: "custom-implementation",
  
  // Implementation Details
  entryPoint: "scripts/apply-chargpt-production-policy.mjs",
  architecture: "custom-build-system",
  
  // Policy Files
  policyFiles: [
    "scripts/apply-chargpt-production-policy.mjs",
    "scripts/apply-chargpt-c[...]" // Truncated in original
  ],
  
  // Integration Points
  integratedWith: [
    "build-pipeline",
    "trusted-runtime-generation",
    "security-policies"
  ],
  
  // Custom Configuration
  config: {
    productionMode: true,
    verifiedKnowledge: true,
    securityLevel: "high"
  }
}
```

### 3.3 Firebase AI Integration
```javascript
{
  componentName: "Firebase AI Services",
  type: "firebase-extension",
  
  // Available Services
  services: {
    vertexAI: {
      enabled: true,
      description: "Google Cloud Vertex AI integration",
      useCase: "Advanced model training and inference"
    },
    genAI: {
      enabled: true,
      description: "Generative AI API",
      useCase: "Text and content generation"
    }
  },
  
  // Configuration
  firebaseProject: {
    projectId: "smokestack-prod",
    region: "us-central1"
  },
  
  // Authentication
  serviceAccount: {
    type: "firebase-admin-sdk",
    envVar: "FIREBASE_SERVICE_ACCOUNT_KEY",
    setupPath: "docs/FIREBASE-SETUP.md"
  }
}
```

---

## 4. Process Orchestration Model

### 4.1 Single Process Launch
```javascript
{
  processType: "SingleProcess",
  
  models: [
    {
      name: "TypeCheck",
      command: "npm run lint",
      description: "Run TypeScript compiler",
      expectedOutput: "Compilation successful",
      errorPatterns: ["error TS", "Type error"],
      timeout: 30000,
      critical: false
    },
    {
      name: "ViteDev",
      command: "npm run dev",
      description: "Launch Vite dev server",
      expectedOutput: ["ready in", "Local:", "localhost"],
      errorPatterns: ["error", "ENOENT", "not found"],
      timeout: 10000,
      critical: true,
      port: 5173
    },
    {
      name: "BackendServer",
      command: "npm start",
      description: "Launch Express backend",
      expectedOutput: ["listening", "started", "Server running"],
      errorPatterns: ["error", "EADDRINUSE"],
      timeout: 5000,
      critical: true,
      port: 3000
    }
  ]
}
```

### 4.2 Full Stack Orchestration
```javascript
{
  processType: "FullStack",
  
  orchestration: {
    launchStrategy: "parallel",
    dependencyOrder: [
      { process: "TypeCheck", required: false, runBefore: ["ViteDev", "BackendServer"] },
      { process: "BackendServer", required: true, startFirst: true },
      { process: "ViteDev", required: true, startAfter: ["BackendServer"] }
    ],
    
    sequenceModel: {
      phase1: {
        name: "Preparation",
        steps: [
          "Validate environment variables",
          "Check node_modules",
          "Type checking (optional)"
        ]
      },
      phase2: {
        name: "Backend Launch",
        steps: [
          "Start Express server",
          "Wait for port 3000",
          "Verify connection"
        ]
      },
      phase3: {
        name: "Frontend Launch",
        steps: [
          "Start Vite dev server",
          "Wait for port 5173",
          "Enable HMR"
        ]
      },
      phase4: {
        name: "Verification",
        steps: [
          "Health check both servers",
          "Verify API connectivity",
          "Ready for development"
        ]
      }
    }
  }
}
```

### 4.3 Build Pipeline Orchestration
```javascript
{
  processType: "BuildPipeline",
  
  pipeline: {
    type: "sequential",
    
    stages: [
      {
        stage: 1,
        name: "Release Generation",
        command: "npm run generate:release",
        description: "Generate release metadata",
        outputs: ["build metadata"],
        onFailure: "stop"
      },
      {
        stage: 2,
        name: "Trusted Runtime Generation",
        command: "npm run generate:trusted-runtime",
        description: "Build secure server, client, storage",
        outputs: [
          "server.secure.generated.ts",
          "src/App.trusted.tsx",
          "secure-client-bundle"
        ],
        dependencies: ["stage1"],
        onFailure: "stop"
      },
      {
        stage: 3,
        name: "Frontend Build",
        command: "vite build",
        description: "Bundle React app with Vite",
        outputs: ["dist/"],
        dependencies: ["stage2"],
        onFailure: "stop"
      },
      {
        stage: 4,
        name: "Backend Build",
        command: "esbuild server.secure.generated.ts --bundle...",
        description: "Bundle Express server",
        outputs: ["dist/server.cjs"],
        dependencies: ["stage2"],
        onFailure: "stop"
      },
      {
        stage: 5,
        name: "Verification",
        command: "npm run verify:owner-security",
        description: "Verify security policies",
        outputs: [],
        dependencies: ["stage3", "stage4"],
        onFailure: "warn"
      }
    ]
  }
}
```

---

## 5. Environment Configuration Model

```javascript
{
  environmentModel: {
    sourceFiles: [".env.example", ".env"],
    
    requiredVariables: [
      {
        name: "GOOGLE_GENAI_API_KEY",
        category: "ai",
        type: "secret",
        required: true,
        documentation: "API key from https://ai.google.dev",
        validation: {
          pattern: /^[a-zA-Z0-9_-]{32,}$/,
          minLength: 20,
          sensitive: true
        }
      },
      {
        name: "FIREBASE_API_KEY",
        category: "firebase",
        type: "secret",
        required: true,
        documentation: "Firebase API key",
        validation: { sensitive: true }
      },
      {
        name: "FIREBASE_PROJECT_ID",
        category: "firebase",
        type: "string",
        required: true,
        validation: { pattern: /^[a-z0-9-]+$/ }
      },
      {
        name: "FIREBASE_AUTH_DOMAIN",
        category: "firebase",
        type: "string",
        required: false
      },
      {
        name: "VITE_API_BASE",
        category: "frontend",
        type: "url",
        required: false,
        default: "http://localhost:3000"
      }
    ],
    
    setupWorkflow: {
      step1: "Detect missing variables",
      step2: "Show configuration UI",
      step3: "Validate inputs",
      step4: "Create .env file",
      step5: "Verify with health check"
    }
  }
}
```

---

## 6. AI Component Health Model

```javascript
{
  healthModel: {
    checks: [
      {
        name: "Gemini API",
        endpoint: "POST /api/ai/health",
        timeout: 5000,
        expectedStatus: 200,
        validateResponse: {
          hasKey: "status",
          hasKey: "model",
          hasKey: "authenticated"
        },
        frequency: "on-demand",
        fallbackBehavior: "degrade"
      },
      {
        name: "Firebase Connection",
        check: "firestore-connectivity",
        timeout: 3000,
        expectedStatus: "connected",
        frequency: "on-demand",
        fallbackBehavior: "use-emulator"
      },
      {
        name: "Environment Variables",
        check: "all-required-vars-set",
        timeout: 1000,
        expectedStatus: "complete",
        frequency: "startup",
        fallbackBehavior: "prompt-setup"
      }
    ],
    
    statusLevels: {
      healthy: { color: "green", canDevelop: true },
      degraded: { color: "yellow", canDevelop: true, withLimitations: true },
      unhealthy: { color: "red", canDevelop: false, requiresSetup: true }
    }
  }
}
```

---

## 7. Command Execution Model

```javascript
{
  commandExecutionModel: {
    
    categories: {
      development: [
        { label: "Start Dev (Full Stack)", command: "npm run dev", color: "green" },
        { label: "Type Check", command: "npm run lint", color: "blue" },
        { label: "Build Production", command: "npm run build", color: "orange" }
      ],
      
      aiComponents: [
        { label: "Test Gemini Connection", command: "test:gemini", process: "health-check" },
        { label: "Generate with Gemini", command: "generate:suggestions", requiresSetup: true },
        { label: "Run CharGPT Policy", command: "apply-chargpt-production-policy", process: "build" }
      ],
      
      firebase: [
        { label: "Start Firebase Emulator", command: "firebase emulators:start" },
        { label: "Run Firestore Rules Tests", command: "npm run test:firestore-rules" },
        { label: "Deploy to Firebase", command: "firebase deploy" }
      ],
      
      pipeline: [
        { label: "Generate Release", command: "npm run generate:release" },
        { label: "Generate Trusted Runtime", command: "npm run generate:trusted-runtime" },
        { label: "Full Build", command: "npm run build" },
        { label: "Test All", command: "npm run test:*" }
      ]
    },
    
    executionContext: {
      projectPath: "/path/to/smoker",
      environment: { /* from .env */ },
      processManager: "ProcessManager instance",
      timeout: 300000, // 5 minutes
      outputCapture: true
    }
  }
}
```

---

## 8. State Management Model

```javascript
{
  stateModel: {
    
    projectState: {
      loaded: false,
      projectPath: null,
      projectConfig: null,
      errors: []
    },
    
    environmentState: {
      configured: false,
      missingVariables: [],
      envFileExists: false,
      validated: false
    },
    
    processState: {
      processes: new Map(),
      activeProcesses: [],
      lastOutput: {},
      errorStates: {}
    },
    
    aiComponentsState: {
      gemini: {
        available: false,
        installed: false,
        configured: false,
        apiKeyValid: false,
        lastHealthCheck: null
      },
      charGPT: {
        available: false,
        installed: false,
        configured: false
      },
      firebase: {
        available: false,
        installed: false,
        emulatorRunning: false,
        connected: false
      }
    },
    
    developmentState: {
      ready: false,
      frontendRunning: false,
      backendRunning: false,
      typeCheckPassing: false,
      errors: []
    },
    
    uiState: {
      currentView: "dashboard",
      selectedProcess: null,
      showTerminal: false,
      showEnvironmentPanel: false,
      showAIControls: false
    }
  }
}
```

---

## 9. Error Handling Model

```javascript
{
  errorHandlingModel: {
    
    errorCategories: [
      {
        category: "environment",
        errors: [
          { code: "MISSING_ENV_VAR", message: "Required env var missing", recoverable: true },
          { code: "INVALID_ENV_VALUE", message: "Env var format invalid", recoverable: true },
          { code: "NO_ENV_FILE", message: ".env not found", recoverable: true }
        ]
      },
      {
        category: "process",
        errors: [
          { code: "PROCESS_LAUNCH_FAILED", message: "Failed to start process", recoverable: true },
          { code: "PORT_IN_USE", message: "Port already in use", recoverable: true },
          { code: "TIMEOUT", message: "Process startup timeout", recoverable: true }
        ]
      },
      {
        category: "typescript",
        errors: [
          { code: "COMPILATION_ERROR", message: "TypeScript compilation failed", recoverable: false },
          { code: "TYPE_ERROR", message: "Type checking failed", recoverable: false }
        ]
      },
      {
        category: "ai-components",
        errors: [
          { code: "API_KEY_INVALID", message: "AI API key invalid", recoverable: true },
          { code: "API_UNREACHABLE", message: "AI service unreachable", recoverable: false },
          { code: "RATE_LIMITED", message: "API rate limited", recoverable: true }
        ]
      }
    ],
    
    recoveryStrategies: {
      "MISSING_ENV_VAR": { action: "prompt-user", panel: "environment-setup" },
      "PORT_IN_USE": { action: "kill-process", retry: true },
      "TIMEOUT": { action: "increase-timeout", retry: true },
      "API_KEY_INVALID": { action: "prompt-user", panel: "ai-setup" },
      "API_UNREACHABLE": { action: "show-warning", degrade: true }
    }
  }
}
```

---

## 10. Integration Points Map

```javascript
{
  integrationMap: {
    
    "Nexus UI" ↔ "ProcessManager": {
      methods: [
        "launch()",
        "kill()",
        "getOutput()",
        "getAllProcesses()"
      ],
      events: ["log", "error", "close"],
      stateSync: "bidirectional"
    },
    
    "Nexus UI" ↔ "SmokerSupport": {
      methods: [
        "detectProjectType()",
        "createSmokerConfig()",
        "generateSetupSteps()"
      ],
      events: ["config-loaded", "setup-required"],
      stateSync: "one-way (read)"
    },
    
    "ProcessManager" ↔ "SmokerSupport": {
      methods: [
        "getSmokerCommands()",
        "validateEnvironment()"
      ],
      events: ["process-ready", "setup-complete"],
      stateSync: "bidirectional"
    },
    
    "Nexus Main" ↔ "IPC Events": {
      channels: [
        "project:load",
        "process:launch",
        "process:kill",
        "environment:configure",
        "ai:health-check"
      ],
      direction: "bidirectional"
    }
  }
}
```

---

## 11. UI Components Model

```javascript
{
  uiComponentsModel: {
    
    panels: [
      {
        name: "ProjectStatus",
        displays: [
          "Project type (Smoker detected)",
          "File count, languages",
          "Setup status",
          "Requirements checklist"
        ]
      },
      {
        name: "EnvironmentSetup",
        displays: [
          "Required variables",
          "Input fields for setup",
          "Validation status",
          "Health check results"
        ]
      },
      {
        name: "ProcessControl",
        displays: [
          "Launch buttons (TypeCheck, Vite, Backend)",
          "Process status",
          "Stop/Restart buttons",
          "Output terminal"
        ]
      },
      {
        name: "AIComponents",
        displays: [
          "Gemini status",
          "CharGPT status",
          "Firebase AI status",
          "Health checks"
        ]
      },
      {
        name: "DevServer",
        displays: [
          "Frontend URL (Vite)",
          "Backend URL (Express)",
          "API documentation",
          "Live preview"
        ]
      },
      {
        name: "BuildPipeline",
        displays: [
          "Pipeline steps",
          "Current step progress",
          "Output log",
          "Build results"
        ]
      }
    ]
  }
}
```

---

## 12. Configuration Files Model

```javascript
{
  configFilesModel: {
    
    requiredFiles: [
      {
        file: "package.json",
        purpose: "Project metadata and scripts",
        parsed: true,
        required: true
      },
      {
        file: "tsconfig.json",
        purpose: "TypeScript configuration",
        parsed: true,
        required: true
      },
      {
        file: "vite.config.ts",
        purpose: "Vite bundler configuration",
        parsed: true,
        required: true
      },
      {
        file: ".env.example",
        purpose: "Environment variable template",
        parsed: true,
        required: false
      },
      {
        file: ".env",
        purpose: "Runtime environment variables",
        parsed: true,
        created: true,
        required: true
      },
      {
        file: "firebase.json",
        purpose: "Firebase configuration",
        parsed: true,
        required: false
      }
    ],
    
    generatedFiles: [
      {
        file: "server.secure.generated.ts",
        generatedBy: "generate:secure-server",
        purpose: "Secure backend entry point"
      },
      {
        file: "src/App.trusted.tsx",
        generatedBy: "generate:trusted-client",
        purpose: "Trusted React app component"
      }
    ]
  }
}
```

---

## 13. Deployment Model

```javascript
{
  deploymentModel: {
    
    targets: [
      {
        target: "web",
        buildCommand: "npm run build",
        outputDir: "dist/",
        deployment: "static-hosting",
        examples: ["Vercel", "Netlify", "GitHub Pages"]
      },
      {
        target: "docker",
        buildCommand: "docker build -t smoker:latest .",
        dockerfile: "Dockerfile",
        deployment: "container-registry",
        examples: ["Docker Hub", "Google Cloud", "AWS ECR"]
      },
      {
        target: "firebase",
        buildCommand: "firebase build",
        deployment: "firebase-hosting",
        commands: ["firebase deploy"]
      }
    ]
  }
}
```

---

## 14. Health Check Model

```javascript
{
  healthCheckModel: {
    
    checks: {
      startup: [
        { name: "Node Version", command: "node --version", expectedPattern: "v16+" },
        { name: "npm Installed", command: "npm --version", expectedPattern: "\\d+\\.\\d+" },
        { name: "Git Installed", command: "git --version", expectedPattern: "git version" }
      ],
      
      project: [
        { name: "node_modules", check: "directoryExists", path: "node_modules" },
        { name: "TypeScript Config", check: "fileExists", path: "tsconfig.json" },
        { name: "Vite Config", check: "fileExists", path: "vite.config.ts" }
      ],
      
      environment: [
        { name: "All Required Vars", check: "allEnvVarsSet", required: true },
        { name: "API Keys Valid", check: "validateApiKeys" },
        { name: "Firebase Connection", check: "firebaseConnectivity" }
      ],
      
      development: [
        { name: "TypeScript Check", command: "npm run lint", timeout: 30000 },
        { name: "Vite Ready", check: "portOpen", port: 5173, timeout: 10000 },
        { name: "Backend Ready", check: "portOpen", port: 3000, timeout: 5000 }
      ]
    }
  }
}
```

---

## 15. Key Metrics & Monitoring Model

```javascript
{
  monitoringModel: {
    
    metrics: [
      {
        metric: "typeCheckTime",
        unit: "milliseconds",
        threshold: 30000,
        alert: "type-check-slow"
      },
      {
        metric: "viteStartupTime",
        unit: "milliseconds",
        threshold: 10000,
        alert: "vite-slow"
      },
      {
        metric: "backendStartupTime",
        unit: "milliseconds",
        threshold: 5000,
        alert: "backend-slow"
      },
      {
        metric: "buildTime",
        unit: "milliseconds",
        threshold: 60000,
        alert: "build-slow"
      },
      {
        metric: "apiLatency",
        unit: "milliseconds",
        threshold: 1000,
        alert: "api-slow"
      },
      {
        metric: "errorRate",
        unit: "percentage",
        threshold: 5,
        alert: "high-error-rate"
      }
    ]
  }
}
```

---

## Summary

This model defines **every structural component** needed for Nexus to:
- ✅ Detect and understand Smoker-Hours-Tracker
- ✅ Manage TypeScript compilation
- ✅ Launch and monitor Vite frontend + Express backend
- ✅ Configure and validate AI components (Gemini, CharGPT, Firebase AI)
- ✅ Handle environment variables and secrets
- ✅ Execute complex build pipelines
- ✅ Provide comprehensive error handling and recovery
- ✅ Health check and monitor all services

**Status**: Blueprint complete. Ready for implementation when needed.
