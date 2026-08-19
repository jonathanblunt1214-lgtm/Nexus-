// projectSettings.js
// Main-process module for Nexus.
// Manages where Nexus keeps cloned/loaded projects. Defaults to
// Documents\Nexus Projects the very first time Nexus runs, then remembers
// whatever location is actually in use (default or user-changed) in a
// small settings file so it survives relaunches.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'nexus-settings.json');

// First-run default: Documents\Nexus Projects
const DEFAULT_PROJECTS_ROOT = path.join(app.getPath('documents'), 'Nexus Projects');

function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (err) {
    // Corrupt settings file - report it, don't silently overwrite/mask.
    console.error(`Nexus settings file at ${SETTINGS_FILE} could not be parsed:`, err);
    return null;
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

/**
 * Returns the current projects root folder, creating it and the settings
 * file with the Documents\Nexus Projects default the first time this runs.
 */
function getProjectsRoot() {
  let settings = readSettings();

  if (!settings || !settings.projectsRoot) {
    settings = { ...(settings || {}), projectsRoot: DEFAULT_PROJECTS_ROOT };
    writeSettings(settings);
  }

  if (!fs.existsSync(settings.projectsRoot)) {
    fs.mkdirSync(settings.projectsRoot, { recursive: true });
  }

  return settings.projectsRoot;
}

/**
 * Lets the user change the projects root (e.g. from a Settings screen)
 * to somewhere other than Documents\Nexus Projects.
 */
function setProjectsRoot(newPath) {
  if (!newPath || typeof newPath !== 'string') {
    throw new Error('setProjectsRoot requires a valid path string.');
  }
  fs.mkdirSync(newPath, { recursive: true });
  const settings = readSettings() || {};
  settings.projectsRoot = newPath;
  writeSettings(settings);
  return newPath;
}

module.exports = {
  getProjectsRoot,
  setProjectsRoot,
  DEFAULT_PROJECTS_ROOT,
  SETTINGS_FILE,
};
