// pipelineEngine.js — a small, hand-written interpreter for a
// PowerShell-inspired object pipeline language (Get-X | Where-Object ... |
// Select-Object ...).
//
// SECURITY DESIGN, READ THIS FIRST:
// This deliberately contains NO eval(), new Function(), or vm.Script()
// anywhere. There is no JavaScript execution context for a pipeline
// expression to escape from, because none exists — the evaluator can only
// ever call the fixed, small set of cmdlet functions defined in CMDLETS
// below. Nothing else is reachable no matter what text is typed in.
//
// This is a genuinely different (and stronger) safety property than
// wrapping user input in a JS "sandbox" library. Every mainstream one has
// had serious escape vulnerabilities — vm2, the most widely used Node.js
// sandboxing library, had five new critical (CVSS 9.8–10.0) vulnerabilities
// disclosed in May 2026, all leading to full host code execution. Node's
// own newer Permission Model is stable but its documentation is explicit
// that it "does not provide security guarantees in the presence of
// malicious code" — a seatbelt, not a sandbox. Rather than build on top of
// either of those, this module simply never evaluates the input as code at
// all, so there's no escape category that applies to it.
//
// The cmdlets below only ever read data that's handed to them via the
// `context` object at call time — this module has zero access to
// fs/child_process/network/Electron itself. Real data (the actual project
// list, actual docker containers, etc.) is gathered by the caller using
// Nexus's existing, already-reviewed IPC calls, then passed in — this
// module never fetches anything itself.

class PipelineError extends Error {}

function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '|') { tokens.push({ type: 'PIPE' }); i++; continue; }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let str = '';
      while (j < input.length && input[j] !== quote) { str += input[j]; j++; }
      if (j >= input.length) throw new PipelineError(`Unclosed quote starting at position ${i}.`);
      tokens.push({ type: 'STRING', value: str });
      i = j + 1;
      continue;
    }
    if (ch === '-' && /[a-zA-Z]/.test(input[i + 1] || '')) {
      let j = i + 1;
      let flag = '';
      while (j < input.length && /[a-zA-Z]/.test(input[j])) { flag += input[j]; j++; }
      tokens.push({ type: 'FLAG', value: flag });
      i = j;
      continue;
    }
    let j = i;
    let word = '';
    while (j < input.length && !/[\s|]/.test(input[j])) { word += input[j]; j++; }
    tokens.push({ type: 'WORD', value: word });
    i = j;
  }
  return tokens;
}

function parse(tokens) {
  const commands = [];
  let current = null;
  for (const tok of tokens) {
    if (tok.type === 'PIPE') {
      if (!current) throw new PipelineError('Pipeline has an empty stage (two "|" with nothing between them, or a leading "|").');
      commands.push(current);
      current = null;
      continue;
    }
    if (!current) {
      if (tok.type !== 'WORD') throw new PipelineError(`Expected a cmdlet name, got "${tok.value}".`);
      current = { name: tok.value, args: [] };
    } else {
      current.args.push(tok);
    }
  }
  if (!current) throw new PipelineError('Empty pipeline.');
  commands.push(current);
  return commands;
}

function coerceToMatch(rawValue, actualSample) {
  if (typeof actualSample === 'boolean') return rawValue === 'true' || rawValue === true;
  if (typeof actualSample === 'number') return Number(rawValue);
  return rawValue;
}

const CMDLETS = {
  'get-project': (_input, _args, context) => context.projects || [],
  'get-dockercontainer': (_input, _args, context) => context.dockerContainers || [],
  'get-gitstatusfile': (_input, _args, context) => context.gitStatusFiles || [],
  'get-recentchange': (_input, _args, context) => context.recentChanges || [],
  'get-runningprocess': (_input, _args, context) => (context.projects || []).filter((p) => p.running),

  'where-object': (input, args) => {
    if (args.length < 3) throw new PipelineError('Where-Object needs: <property> -operator <value> (e.g. Where-Object running -eq true)');
    const [propTok, opTok, valueTok] = args;
    if (propTok.type !== 'WORD') throw new PipelineError('Where-Object expects a property name first.');
    if (opTok.type !== 'FLAG') throw new PipelineError('Where-Object expects an operator like -eq after the property name.');
    const prop = propTok.value;
    const op = opTok.value.toLowerCase();
    const rawValue = valueTok.value;

    return input.filter((item) => {
      const actual = item[prop];
      const target = coerceToMatch(rawValue, actual);
      switch (op) {
        case 'eq': return actual === target;
        case 'ne': return actual !== target;
        case 'gt': return actual > target;
        case 'lt': return actual < target;
        case 'like': return String(actual ?? '').toLowerCase().includes(String(rawValue).toLowerCase());
        default: throw new PipelineError(`Unknown operator -${opTok.value}. Supported: -eq -ne -gt -lt -like`);
      }
    });
  },

  'select-object': (input, args) => {
    if (args.length === 0) throw new PipelineError('Select-Object needs at least one property name (e.g. Select-Object name,port).');
    const props = args[0].value.split(',').map((s) => s.trim()).filter(Boolean);
    if (props.length === 0) throw new PipelineError('Select-Object needs at least one property name.');
    return input.map((item) => {
      const out = {};
      for (const p of props) out[p] = item ? item[p] : undefined;
      return out;
    });
  },

  'sort-object': (input, args) => {
    if (args.length === 0) throw new PipelineError('Sort-Object needs a property name.');
    const prop = args[0].value;
    const descending = args.some((a) => a.type === 'FLAG' && a.value.toLowerCase() === 'descending');
    const sorted = [...input].sort((a, b) => {
      const av = a ? a[prop] : undefined;
      const bv = b ? b[prop] : undefined;
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    return descending ? sorted.reverse() : sorted;
  },

  'measure-object': (input) => [{ count: input.length }],
};

function runPipeline(input, context) {
  if (typeof input !== 'string' || !input.trim()) throw new PipelineError('Empty pipeline.');
  const tokens = tokenize(input);
  const commands = parse(tokens);

  let data = [];
  for (const cmd of commands) {
    const key = cmd.name.toLowerCase();
    const fn = CMDLETS[key];
    if (!fn) {
      throw new PipelineError(`Unknown cmdlet: ${cmd.name}. Available: ${Object.keys(CMDLETS).join(', ')}`);
    }
    data = fn(data, cmd.args, context || {});
  }
  return data;
}

module.exports = { tokenize, parse, runPipeline, CMDLETS, PipelineError };
