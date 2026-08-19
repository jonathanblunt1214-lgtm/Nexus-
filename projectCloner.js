// projectCloner.js
// Main-process module for Nexus.
// Detects when "open project" input is a git URL rather than a local folder,
// clones it into a dedicated Nexus projects directory, and returns the real
// local path so the existing launcher (npm install / spawn dev server) can
// run against it exactly as it does for locally-picked folders.
//
// Fixes: previously a GitHub URL was passed straight through as `cwd` to
// `npm install`, producing `[exit ENOENT]` because the URL is not a real path.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { getProjectsRoot } = require('./projectSettings');
const { saveProject } = require('./projectRegistry');

// --- Detection ----------------------------------------------------------

/**
 * Returns true if the given input string looks like a remote git URL
 * rather than a local filesystem path.
 */
function isGitUrl(input) {
  if (typeof input !== 'string') return false;
  const trimmed = input.trim();
  return (
    /^https?:\/\/.+\.git$/i.test(trimmed) ||
    /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+\/?$/i.test(trimmed) ||
    /^git@.+:.+\.git$/i.test(trimmed)
  );
}

/**
 * Derives a filesystem-safe folder name from a repo URL.
 * https://github.com/user/Smoker-Hours-Tracker.git -> "Smoker-Hours-Tracker"
 */
function repoNameFromUrl(url) {
  const cleaned = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = cleaned.split('/');
  const name = parts[parts.length - 1] || 'nexus-project';
  return name.replace(/[^a-zA-Z0-9._-]/g, '-');
}

// --- Cloning --------------------------------------------------------------

/**
 * Clones `gitUrl` into the configured projects root (default:
 * Documents\Nexus Projects) under a folder named after the repo, streaming progress via
 * onLog(line). Resolves with the absolute local path to the cloned project.
 * Rejects with a clear Error (never a silent/masked failure) if git isn't
 * available, the destination already exists and isn't empty, or clone fails.
 */
function cloneProject(gitUrl, onLog = () => {}) {
  return new Promise((resolve, reject) => {
    if (!isGitUrl(gitUrl)) {
      reject(new Error(`Not a recognized git URL: ${gitUrl}`));
      return;
    }

    const projectsRoot = getProjectsRoot(); // defaults to Documents\Nexus Projects
    const folderName = repoNameFromUrl(gitUrl);
    const destPath = path.join(projectsRoot, folderName);

    if (fs.existsSync(destPath)) {
      const contents = fs.readdirSync(destPath);
      if (contents.length > 0) {
        // Already cloned - don't re-clone or silently overwrite. Load as-is.
        onLog(`Project already exists locally at ${destPath}, using existing clone.`);
        saveProject({ localPath: destPath, name: folderName, sourceUrl: gitUrl });
        resolve(destPath);
        return;
      }
    }

    onLog(`Cloning ${gitUrl} into ${destPath} …`);

    const gitProcess = spawn('git', ['clone', gitUrl, destPath]);

    gitProcess.stdout.on('data', (data) => onLog(data.toString().trim()));
    gitProcess.stderr.on('data', (data) => onLog(data.toString().trim())); // git writes progress to stderr

    gitProcess.on('error', (err) => {
      // ENOENT here means git itself isn't on PATH - same class of issue
      // you hit with node after install. Surface it clearly, don't mask it.
      if (err.code === 'ENOENT') {
        reject(new Error(
          'git was not found on PATH. If git was recently installed, a full restart may be required for the PATH change to propagate to spawned processes.'
        ));
      } else {
        reject(err);
      }
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        onLog(`Clone complete: ${destPath}`);
        saveProject({ localPath: destPath, name: folderName, sourceUrl: gitUrl });
        resolve(destPath);
      } else {
        reject(new Error(`git clone exited with code ${code}`));
      }
    });
  });
}

/**
 * Entry point for the launcher: given whatever the user provided (a real
 * local folder path OR a git URL), returns a real local folder path,
 * cloning first if necessary. This is the function the existing
 * "open project" flow should call before it does npm install / spawn.
 */
async function resolveProjectPath(input, onLog = () => {}) {
  if (isGitUrl(input)) {
    return cloneProject(input, onLog);
  }

  // Not a URL - validate it's actually a real local directory before
  // handing it back, so a bad path fails loudly here instead of at spawn.
  if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) {
    throw new Error(`"${input}" is not a valid local project folder.`);
  }

  saveProject({ localPath: input });
  return input;
}

module.exports = {
  isGitUrl,
  repoNameFromUrl,
  cloneProject,
  resolveProjectPath,
};
