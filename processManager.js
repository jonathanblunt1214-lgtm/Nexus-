// processManager.js
// Main-process module for managing development processes.
// Handles launching and monitoring dev servers, build processes, and multiple concurrent processes.
// Essential for full-stack development (frontend + backend running simultaneously).

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();
    this.projectPath = null;
  }

  /**
   * Launches a command as a separate process and monitors it
   */
  launch(projectPath, command, processId = 'default') {
    return new Promise((resolve, reject) => {
      if (this.processes.has(processId)) {
        this.kill(processId);
      }

      this.projectPath = projectPath;
      const [cmd, ...args] = command.split(' ');

      console.log(`[ProcessManager] Launching: ${command} in ${projectPath}`);
      this.emit('log', { processId, message: `Starting: ${command}` });

      try {
        const proc = spawn(cmd, args, {
          cwd: projectPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
          detached: false
        });

        const processData = {
          process: proc,
          command,
          startTime: new Date(),
          output: [],
          error: [],
          running: true
        };

        proc.stdout.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            processData.output.push(message);
            this.emit('log', { processId, message, type: 'stdout' });
          }
        });

        proc.stderr.on('data', (data) => {
          const message = data.toString().trim();
          if (message) {
            processData.error.push(message);
            this.emit('log', { processId, message, type: 'stderr' });
          }
        });

        proc.on('error', (err) => {
          processData.running = false;
          this.emit('error', { processId, error: err.message });
          reject(err);
        });

        proc.on('close', (code) => {
          processData.running = false;
          processData.exitCode = code;
          this.emit('close', { processId, code });
          
          if (code === 0) {
            resolve({ processId, code });
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });

        this.processes.set(processId, processData);
        resolve({ processId, process: proc });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Launches Vite dev server (React frontend)
   */
  async launchVite(projectPath) {
    console.log('[ProcessManager] Launching Vite dev server...');
    
    return new Promise((resolve, reject) => {
      this.launch(projectPath, 'npm run dev', 'vite')
        .then(({ process: proc }) => {
          // Listen for "ready" signal
          let foundReady = false;
          const timeout = setTimeout(() => {
            if (!foundReady) {
              resolve({ 
                processId: 'vite', 
                status: 'launched',
                url: 'http://localhost:5173',
                timeout: true
              });
            }
          }, 5000);

          const onLog = (log) => {
            if (log.processId === 'vite' && log.message) {
              console.log('[Vite]', log.message);
              
              if (!foundReady && (log.message.includes('ready in') || 
                                  log.message.includes('Local:') ||
                                  log.message.includes('localhost'))) {
                foundReady = true;
                clearTimeout(timeout);
                resolve({ 
                  processId: 'vite', 
                  status: 'ready',
                  url: 'http://localhost:5173'
                });
              }
            }
          };

          this.on('log', onLog);
        })
        .catch(reject);
    });
  }

  /**
   * Launches Express backend server
   */
  async launchBackend(projectPath, command = 'npm start') {
    console.log('[ProcessManager] Launching backend server...');
    
    return new Promise((resolve, reject) => {
      this.launch(projectPath, command, 'backend')
        .then(() => {
          // Listen for "listening" signal
          let foundReady = false;
          const timeout = setTimeout(() => {
            if (!foundReady) {
              resolve({ 
                processId: 'backend', 
                status: 'launched',
                port: 3000,
                timeout: true
              });
            }
          }, 3000);

          const onLog = (log) => {
            if (log.processId === 'backend' && log.message) {
              console.log('[Backend]', log.message);
              
              if (!foundReady && (log.message.includes('listening') ||
                                  log.message.includes('started') ||
                                  log.message.includes('ready') ||
                                  log.message.includes('Server running'))) {
                foundReady = true;
                clearTimeout(timeout);
                
                // Try to extract port from message
                const portMatch = log.message.match(/(:\d{4,5}|port[\s:]*\d{4,5})/i);
                const port = portMatch ? parseInt(portMatch[0].replace(/\D/g, '')) : 3000;
                
                resolve({ 
                  processId: 'backend', 
                  status: 'ready',
                  port,
                  url: `http://localhost:${port}`
                });
              }
            }
          };

          this.on('log', onLog);
        })
        .catch(reject);
    });
  }

  /**
   * Launches full stack (frontend + backend)
   */
  async launchFullStack(projectPath) {
    console.log('[ProcessManager] Launching full stack...');
    
    try {
      const frontend = await this.launchVite(projectPath);
      const backend = await this.launchBackend(projectPath);
      
      return {
        success: true,
        frontend,
        backend,
        readyAt: new Date()
      };
    } catch (err) {
      this.killAll();
      throw err;
    }
  }

  /**
   * Gets process information
   */
  getProcess(processId) {
    return this.processes.get(processId);
  }

  /**
   * Gets all running processes
   */
  getAllProcesses() {
    return Array.from(this.processes.entries()).map(([id, data]) => ({
      id,
      command: data.command,
      running: data.running,
      startTime: data.startTime,
      exitCode: data.exitCode,
      outputCount: data.output.length,
      errorCount: data.error.length
    }));
  }

  /**
   * Gets recent output from a process
   */
  getOutput(processId, lines = 50) {
    const proc = this.processes.get(processId);
    if (!proc) return [];
    
    return {
      stdout: proc.output.slice(-lines),
      stderr: proc.error.slice(-lines),
      running: proc.running
    };
  }

  /**
   * Kills a specific process
   */
  kill(processId) {
    const procData = this.processes.get(processId);
    if (!procData) return false;
    
    try {
      procData.process.kill('SIGTERM');
      this.emit('log', { processId, message: 'Process terminating...' });
      return true;
    } catch (err) {
      console.error(`Error killing process ${processId}:`, err);
      return false;
    }
  }

  /**
   * Kills all running processes
   */
  killAll() {
    for (const [processId] of this.processes) {
      this.kill(processId);
    }
  }

  /**
   * Restarts a process
   */
  async restart(projectPath, processId) {
    this.kill(processId);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const procData = this.processes.get(processId);
    if (procData) {
      return this.launch(projectPath, procData.command, processId);
    }
  }

  /**
   * Clears process history
   */
  clear() {
    this.killAll();
    this.processes.clear();
  }
}

module.exports = ProcessManager;
