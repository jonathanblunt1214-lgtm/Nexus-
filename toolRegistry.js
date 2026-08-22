const path = require('path');

function resolveInsideWorkspace(workspaceRoot, candidate) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, candidate || '.');
  return target === root || target.startsWith(root + path.sep) ? target : null;
}

class ToolRegistry {
  constructor({ workspaceRoot }) {
    if (!workspaceRoot) throw new Error('workspaceRoot is required');
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.tools = new Map();
  }

  register({ name, description = '', inputSchema = {}, capability, handler }) {
    if (!name || typeof handler !== 'function') throw new Error('tool name and handler are required');
    if (!capability) throw new Error(`Tool ${name} must declare a capability`);
    if (this.tools.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.tools.set(name, { name, description, inputSchema, capability, handler });
  }

  listTools() {
    return [...this.tools.values()].map(({ handler, ...tool }) => tool);
  }

  validateInput(schema, input) {
    const value = input && typeof input === 'object' ? input : {};
    for (const [key, rule] of Object.entries(schema || {})) {
      const v = value[key];
      if (rule.required && (v === undefined || v === null || v === '')) throw new Error(`Missing required tool argument: ${key}`);
      if (v !== undefined && rule.type && typeof v !== rule.type) throw new Error(`Invalid type for ${key}; expected ${rule.type}`);
      if (typeof v === 'string' && rule.maxLength && v.length > rule.maxLength) throw new Error(`Argument ${key} exceeds max length`);
      if (typeof v === 'string' && rule.pattern && !rule.pattern.test(v)) throw new Error(`Argument ${key} failed validation`);
    }
    return value;
  }

  async callTool(name, input, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const allowed = new Set(context.allowedCapabilities || []);
    if (!allowed.has(tool.capability)) throw new Error(`Capability denied: ${tool.capability}`);
    const safeInput = this.validateInput(tool.inputSchema, input);

    if (typeof safeInput.path === 'string') {
      const resolved = resolveInsideWorkspace(this.workspaceRoot, safeInput.path);
      if (!resolved) throw new Error('Path escapes the active workspace');
      safeInput.path = resolved;
    }

    return tool.handler(safeInput, { ...context, workspaceRoot: this.workspaceRoot });
  }
}

function rejectShellMetacharacters(value) {
  if (typeof value !== 'string') return value;
  if (/[;&|`$<>\r\n]/.test(value)) throw new Error('Shell metacharacters are not allowed');
  return value;
}

module.exports = { ToolRegistry, resolveInsideWorkspace, rejectShellMetacharacters };
