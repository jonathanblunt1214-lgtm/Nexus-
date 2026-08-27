const fs = require('fs');
const path = require('path');

function readPackage(folder) {
  try { return JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')); }
  catch { return null; }
}

function hasFile(folder, names) {
  return names.some((name) => fs.existsSync(path.join(folder, name)));
}

function detectProjectType(folder) {
  const pkg = readPackage(folder);
  const dependencies = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const hasAnyDependency = (...names) => names.some((name) => Boolean(dependencies[name]));

  const apiFramework = hasAnyDependency('express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi', 'hono');
  const interactiveApp = hasAnyDependency('react', 'react-dom', 'vue', 'svelte', '@angular/core', 'electron', 'react-native');
  const websiteFramework = hasAnyDependency('next', 'astro', 'gatsby', '@11ty/eleventy');
  const apiFiles = hasFile(folder, ['server.js', 'server.ts', 'app.js', 'app.ts']) || hasFile(folder, ['routes', 'controllers']);
  const websiteFiles = hasFile(folder, ['index.html', 'public/index.html']);

  if (apiFramework && !interactiveApp && !websiteFramework) {
    return { templateId: 'api', source: 'server framework dependencies' };
  }
  if (interactiveApp) {
    return { templateId: 'app', source: 'interactive application dependencies' };
  }
  if (websiteFramework) {
    return { templateId: 'website', source: 'website framework dependencies' };
  }
  if (apiFiles && !websiteFiles) {
    return { templateId: 'api', source: 'server entry files' };
  }
  if (websiteFiles || hasAnyDependency('vite')) {
    return { templateId: 'website', source: websiteFiles ? 'web entry file' : 'Vite project' };
  }
  return { templateId: 'website', source: 'default project type' };
}

module.exports = { detectProjectType };
