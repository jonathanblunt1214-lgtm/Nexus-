// Nexus bootstrap: registers narrowly scoped upgrade IPC before loading the legacy main process.
const { ipcMain, webContents } = require('electron');
const { registerSection7Ipc } = require('./section7Ipc');

registerSection7Ipc({ ipcMain, webContents });
require('./main');
