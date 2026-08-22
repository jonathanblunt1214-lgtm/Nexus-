// updater.js
// Main-process module for Nexus.
// Uses electron-updater to check a GitHub repo's Releases for newer builds
// of Nexus itself, download them, and install on relaunch. This is what
// makes "push an update" real: publish a new GitHub Release with a bumped
// version, and every running Nexus instance picks it up on its own.
//
// Requires: npm install electron-updater --save
// Requires: package.json "build.publish" configured (see bottom of this file
// for the exact block to add) pointing at your GitHub repo.

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

// Don't auto-install the moment a download finishes - let the user choose
// when to restart, so it never yanks the app out from under active work.
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.autoDownload = false;
autoUpdater.fullChangelog = true;

let mainWindow = null;
let initialized = false;
let updateState = {
  state: 'idle',
  currentVersion: app.getVersion(),
  availableVersion: null,
  releaseNotes: null,
  percent: 0,
  message: null,
  canCheck: app.isPackaged,
};

/**
 * Sends a status update to the renderer so the UI can show it
 * (e.g. in a small "Update available" banner).
 */
function notifyRenderer(channel, payload) {
  updateState = { ...updateState, ...payload };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, updateState);
  }
}

/**
 * Call this once, after your main BrowserWindow is created, to wire
 * the updater's events up to the UI.
 */
function initUpdater(win) {
  mainWindow = win;

  if (initialized) return;
  initialized = true;

  if (!app.isPackaged) {
    notifyRenderer('updater:status', {
      state: 'development',
      message: 'Release updates are available in installed builds. This development copy can still pull source updates.',
      canCheck: false,
    });
    return;
  }

  autoUpdater.on('checking-for-update', () => {
    notifyRenderer('updater:status', { state: 'checking', message: null });
  });

  autoUpdater.on('update-available', (info) => {
    notifyRenderer('updater:status', {
      state: 'available',
      availableVersion: info.version,
      releaseNotes: info.releaseNotes || null,
    });
  });

  autoUpdater.on('update-not-available', () => {
    notifyRenderer('updater:status', { state: 'up-to-date', availableVersion: null, releaseNotes: null, percent: 0 });
  });

  autoUpdater.on('download-progress', (progress) => {
    notifyRenderer('updater:status', {
      state: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    notifyRenderer('updater:status', {
      state: 'ready',
      availableVersion: info.version,
      percent: 100,
    });
  });

  autoUpdater.on('error', (err) => {
    // Report the real error, per the "no masked failures" principle -
    // don't silently swallow update failures.
    notifyRenderer('updater:status', {
      state: 'error',
      message: err == null ? 'Unknown updater error' : err.message,
    });
  });
}

/** Checks GitHub Releases for a newer version. Does not download. */
function checkForUpdates() {
  if (!app.isPackaged) return Promise.resolve(getUpdaterState());
  return autoUpdater.checkForUpdates();
}

/** Downloads the update that was found by checkForUpdates(). */
function downloadUpdate() {
  if (!app.isPackaged) return Promise.resolve(getUpdaterState());
  if (updateState.state !== 'available') {
    return Promise.reject(new Error('No update is ready to download. Check for updates first.'));
  }
  return autoUpdater.downloadUpdate();
}

/** Quits Nexus and installs the downloaded update. */
function installUpdateAndRestart() {
  if (!app.isPackaged) return false;
  if (updateState.state !== 'ready') return false;
  autoUpdater.quitAndInstall();
  return true;
}

function getUpdaterState() {
  return { ...updateState };
}

module.exports = {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdateAndRestart,
  getUpdaterState,
};

// -----------------------------------------------------------------------
// SETUP REQUIRED (do this once, outside this file):
//
// 1. npm install electron-updater --save
//
// 2. In package.json, add a "publish" block inside "build" (the same
//    section electron-builder already reads for your NSIS installer):
//
//    "build": {
//      "publish": {
//        "provider": "github",
//        "owner": "your-github-username",
//        "repo": "nexus"
//      }
//    }
//
// 3. In your main.js, after creating the main window:
//
//    const { initUpdater, checkForUpdates } = require('./updater');
//    initUpdater(mainWindow);
//    checkForUpdates(); // or on a timer / menu action
//
// 4. In your preload script, expose IPC so the renderer UI can trigger
//    checks and react to status (see updater-preload-snippet.js).
//
// 5. To actually "push" an update: bump the "version" field in package.json,
//    run your build-installer.bat, then publish the resulting installer as
//    a GitHub Release on the repo configured above (tag must match the
//    version, e.g. v1.2.3). electron-builder can also do this publish step
//    for you directly if you run it with a GH_TOKEN env var set - ask if
//    you want that wired into build-installer.bat too.
// -----------------------------------------------------------------------
