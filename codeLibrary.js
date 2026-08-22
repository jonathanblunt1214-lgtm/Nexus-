const fs = require('fs');
const path = require('path');

const entry = (value) => Object.freeze({ dependencies: [], projectTypes: [], tags: [], ...value, code: value.code.join('\n') });
const ENTRIES = Object.freeze([
  entry({ id:'js-fetch-timeout', title:'Fetch JSON with timeout', summary:'Fetch JSON with cancellation, status validation, and a useful error.', language:'javascript', category:'Networking', projectTypes:['web','node','desktop'], filePatterns:['.js','.mjs','.jsx'], tags:['fetch','api','http','timeout'], usage:'Call fetchJson(url, { timeoutMs, options }).', code:[
    'export async function fetchJson(url, { timeoutMs = 10000, options = {} } = {}) {',
    '  const controller = new AbortController();',
    '  const timer = setTimeout(() => controller.abort(), timeoutMs);',
    '  try {',
    '    const response = await fetch(url, { ...options, signal: controller.signal });',
    '    if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);',
    '    return await response.json();',
    '  } finally { clearTimeout(timer); }',
    '}',
  ]}),
  entry({ id:'ts-result', title:'Typed Result helper', summary:'Represent expected success and failure without throwing.', language:'typescript', category:'Core', projectTypes:['web','node','desktop','game'], filePatterns:['.ts','.tsx'], tags:['typescript','error','result'], usage:'Return ok(value) or err(message) from operations with expected failures.', code:[
    'export type Result<T> =',
    '  | { ok: true; value: T }',
    '  | { ok: false; error: string };',
    '',
    'export const ok = <T>(value: T): Result<T> => ({ ok: true, value });',
    'export const err = <T = never>(error: string): Result<T> => ({ ok: false, error });',
  ]}),
  entry({ id:'react-async-hook', title:'React asynchronous data hook', summary:'Load data with explicit loading, error, and stale-request handling.', language:'typescript', category:'React', projectTypes:['web'], dependencies:['react'], filePatterns:['.tsx','.ts'], tags:['react','hook','async','loading'], usage:'Pass a memoized loader and dependency list.', code:[
    "import { useEffect, useState } from 'react';", '',
    'export function useAsyncData<T>(loader: () => Promise<T>, dependencies: unknown[]) {',
    '  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });',
    '  useEffect(() => {', '    let active = true;', '    setState({ loading: true });',
    '    loader().then(', '      (data) => active && setState({ data, loading: false }),',
    '      (error) => active && setState({ error: error instanceof Error ? error.message : String(error), loading: false }),',
    '    );', '    return () => { active = false; };', '  }, dependencies);', '  return state;', '}',
  ]}),
  entry({ id:'express-json-route', title:'Validated Express JSON route', summary:'An API route with input checks and consistent failure responses.', language:'javascript', category:'Backend API', projectTypes:['node','api'], dependencies:['express'], filePatterns:['.js','.mjs'], tags:['express','api','route','validation'], usage:'Mount the router with app.use("/api", router). Replace the persistence section.', code:[
    "import { Router } from 'express';", "import crypto from 'node:crypto';", '', 'export const router = Router();',
    "router.post('/items', async (request, response, next) => {", '  try {', "    const name = String(request.body?.name || '').trim();",
    "    if (!name) return response.status(400).json({ error: 'name is required' });", '    const item = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };',
    '    return response.status(201).json(item);', '  } catch (error) { return next(error); }', '});',
  ]}),
  entry({ id:'node-env-config', title:'Validated environment configuration', summary:'Read required environment variables once and fail with clear names.', language:'javascript', category:'Configuration', projectTypes:['node','api','desktop'], filePatterns:['.js','.mjs'], tags:['env','config','secrets'], usage:'Import during startup. Keep secret values in Nexus Secrets, not source control.', code:[
    'function required(name) {', '  const value = process.env[name];', '  if (!value) throw new Error(`Missing required environment variable: ${name}`);', '  return value;', '}', '',
    'export const config = Object.freeze({', "  nodeEnv: process.env.NODE_ENV || 'development',", '  port: Number(process.env.PORT || 3000),', "  apiUrl: required('API_URL'),", '});',
  ]}),
  entry({ id:'python-fastapi-route', title:'Validated FastAPI route', summary:'A typed FastAPI endpoint with Pydantic request validation.', language:'python', category:'Backend API', projectTypes:['python','api'], dependencies:['fastapi'], filePatterns:['.py'], tags:['python','fastapi','pydantic','api'], usage:'Include the router in a FastAPI application.', code:[
    'from datetime import datetime, timezone', 'from uuid import uuid4', 'from fastapi import APIRouter', 'from pydantic import BaseModel, Field', '',
    'router = APIRouter()', '', 'class ItemInput(BaseModel):', '    name: str = Field(min_length=1, max_length=120)', '',
    '@router.post("/items", status_code=201)', 'async def create_item(payload: ItemInput):', '    return {"id": str(uuid4()), "name": payload.name.strip(), "created_at": datetime.now(timezone.utc)}',
  ]}),
  entry({ id:'css-responsive-grid', title:'Responsive card grid', summary:'A compact responsive grid with accessible focus behavior.', language:'css', category:'Interface', projectTypes:['web','desktop'], filePatterns:['.css','.scss'], tags:['css','responsive','grid','cards'], usage:'Apply .card-grid to the container and .card to each item.', code:[
    '.card-grid {', '  display: grid;', '  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));', '  gap: 1rem;', '}', '',
    '.card {', '  min-width: 0;', '  padding: 1rem;', '  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);', '  border-radius: 0.75rem;', '}', '',
    '.card:focus-within {', '  outline: 2px solid Highlight;', '  outline-offset: 2px;', '}',
  ]}),
  entry({ id:'vitest-unit-test', title:'Vitest unit-test starter', summary:'A table-driven unit test with readable failure cases.', language:'typescript', category:'Testing', projectTypes:['web','node','desktop'], dependencies:['vitest'], filePatterns:['.test.ts','.spec.ts','.test.tsx'], tags:['vitest','test','typescript'], usage:'Replace normalizeName and the cases with the behavior under test.', code:[
    "import { describe, expect, it } from 'vitest';", "import { normalizeName } from './normalizeName';", '', "describe('normalizeName', () => {",
    "  it.each([['  Example  ', 'Example'], ['', '']])('normalizes %j', (input, expected) => {", '    expect(normalizeName(input)).toBe(expected);', '  });', '});',
  ]}),
  entry({ id:'electron-safe-ipc', title:'Narrow Electron IPC bridge', summary:'Expose one named renderer operation without revealing raw Electron APIs.', language:'javascript', category:'Desktop', projectTypes:['desktop'], dependencies:['electron'], filePatterns:['preload.js','.js'], tags:['electron','ipc','security','preload'], usage:'Register the matching ipcMain handler and validate its sender in the main process.', code:[
    "const { contextBridge, ipcRenderer } = require('electron');", '', "contextBridge.exposeInMainWorld('appApi', {",
    "  loadProjectSummary: (projectId) => ipcRenderer.invoke('project:summary', { projectId }),", '});',
  ]}),
  entry({ id:'phaser-scene', title:'Phaser scene starter', summary:'A minimal Phaser scene with lifecycle methods and keyboard input.', language:'javascript', category:'Game', projectTypes:['game','web'], dependencies:['phaser'], filePatterns:['.js','.ts'], tags:['phaser','game','scene','input'], usage:'Add the scene to the Phaser game configuration. Use Phaser tooling for play testing and profiling.', code:[
    "import Phaser from 'phaser';", '', 'export class MainScene extends Phaser.Scene {', "  constructor() { super('main'); }", '', '  preload() {', "    // this.load.image('player', 'assets/player.png');", '  }', '',
    '  create() {', "    this.add.text(24, 24, 'Game ready');", "    this.input.keyboard?.once('keydown-ESC', () => this.scene.pause());", '  }', '',
    '  update(_time, _delta) {', '    // Keep frame-based behavior delta-time aware.', '  }', '}',
  ]}),
  entry({ id:'github-actions-node', title:'Node.js GitHub Actions workflow', summary:'Install reproducibly, test, and audit a Node project on pushes and PRs.', language:'yaml', category:'Automation', projectTypes:['web','node','desktop'], filePatterns:['.yml','.yaml'], tags:['github','actions','ci','node'], usage:'Save as .github/workflows/verify.yml and adjust the Node version if needed.', code:[
    'name: Verify', 'on:', '  push:', '  pull_request:', 'permissions:', '  contents: read', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:',
    '      - uses: actions/checkout@v4', '      - uses: actions/setup-node@v4', '        with:', '          node-version: 22', '          cache: npm',
    '      - run: npm ci', '      - run: npm test', '      - run: npm audit --audit-level=high',
  ]}),
]);

function readProjectContext(folder) {
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); } catch {}
  const dependencies = new Set(Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).map((name) => name.toLowerCase()));
  try {
    fs.readFileSync(path.join(folder, 'requirements.txt'), 'utf8').split(/\r?\n/).forEach((line) => {
      const name = line.trim().match(/^([a-z0-9_.-]+)/i)?.[1];
      if (name) dependencies.add(name.toLowerCase());
    });
  } catch {}
  const types = new Set();
  if (dependencies.has('react') || dependencies.has('vite') || dependencies.has('next')) types.add('web');
  if (dependencies.has('express') || dependencies.has('fastify') || dependencies.has('koa')) types.add('api');
  if (dependencies.has('electron')) types.add('desktop');
  if (dependencies.has('phaser') || dependencies.has('playcanvas') || fs.existsSync(path.join(folder, 'project.godot'))) types.add('game');
  if (fs.existsSync(path.join(folder, 'requirements.txt')) || fs.existsSync(path.join(folder, 'pyproject.toml'))) types.add('python');
  if (pkg.scripts || dependencies.size) types.add('node');
  return { dependencies, types };
}

function searchCodeLibrary(folder, { query = '', language = 'all', category = 'all', currentFile = '' } = {}) {
  language = language || 'all';
  category = category || 'all';
  const context = readProjectContext(folder);
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const current = String(currentFile).toLowerCase();
  return ENTRIES.map((item) => {
    const haystack = [item.title, item.summary, item.language, item.category, ...item.tags].join(' ').toLowerCase();
    const missingDependencies = item.dependencies.filter((dependency) => !context.dependencies.has(dependency));
    let score = terms.reduce((total, term) => total + (haystack.includes(term) ? 10 : -100), 0);
    if (item.filePatterns.some((pattern) => current.endsWith(pattern.toLowerCase()))) score += 8;
    if (item.projectTypes.some((type) => context.types.has(type))) score += 5;
    if (!missingDependencies.length) score += 3;
    return { ...item, compatible: missingDependencies.length === 0, missingDependencies, score };
  }).filter((item) => item.score > -50 && (language === 'all' || item.language === language) && (category === 'all' || item.category === category)).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}

function libraryFacets() { return { languages: [...new Set(ENTRIES.map((item) => item.language))].sort(), categories: [...new Set(ENTRIES.map((item) => item.category))].sort(), count: ENTRIES.length }; }

module.exports = { ENTRIES, readProjectContext, searchCodeLibrary, libraryFacets };
