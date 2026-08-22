// projectRegistry.js
// Main-process module for Nexus.
// Automatically records every project that gets loaded (cloned from a git
// URL or opened from a local folder) so Nexus remembers it next time it
// launches, instead of the user having to re-pick or re-clone it.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { writeJsonAtomicSync } = require('./atomicWrite');

const REGISTRY_FILE = path.join(app.getPath('userData'), 'nexus-projects.json');

function readRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch (err) {
    console.error(`Nexus project registry at ${REGISTRY_FILE} could not be parsed:`, err);
    return [];
  }
}

function writeRegistry(projects) {
  writeJsonAtomicSync(REGISTRY_FILE, projects);
}

/**
 * Records (or updates) a loaded project. Called automatically every time
 * a project finishes loading, whether it came from a local folder pick
 * or a fresh git clone. Matches existing entries by local path, so
 * reloading the same project just updates lastOpened instead of duplicating.
 *
 * @param {Object} project
 * @param {string} project.localPath - real folder path on disk (required)
 * @param {string} [project.name] - display name, defaults to folder name
 * @param {string} [project.sourceUrl] - original git URL, if it was cloned
 */
function saveProject({ localPath, name, sourceUrl }) {
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error(`Cannot save project - "${localPath}" does not exist on disk.`);
  }

  const projects = readRegistry();
  const existing = projects.find((p) => p.localPath === localPath);
  const now = new Date().toISOString();

  if (existing) {
    existing.lastOpened = now;
    if (sourceUrl) existing.sourceUrl = sourceUrl;
    if (name) existing.name = name;
  } else {
    projects.push({
      id: crypto.randomUUID(),
      localPath,
      name: name || path.basename(localPath),
      sourceUrl: sourceUrl || null,
      firstAdded: now,
      lastOpened: now,
    });
  }

  writeRegistry(projects);
  return existing || projects[projects.length - 1];
}

/**
 * Returns all remembered projects, most recently opened first.
 * Use this to populate a "recent projects" list on Nexus startup.
 */
function listProjects() {
  return readRegistry().sort(
    (a, b) => new Date(b.lastOpened) - new Date(a.lastOpened)
  );
}

/**
 * Removes a project from the registry (does NOT delete files on disk -
 * this only forgets it, per the "no destructive silent actions" principle).
 */
function forgetProject(id) {
  const projects = readRegistry().filter((p) => p.id !== id);
  writeRegistry(projects);
}

module.exports = {
  saveProject,
  listProjects,
  forgetProject,
  REGISTRY_FILE,
};
