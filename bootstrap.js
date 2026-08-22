// Nexus bootstrap: registers narrowly scoped upgrade IPC before loading the legacy main process.
const { ipcMain, webContents } = require('electron');
const { registerSection7Ipc } = require('./section7Ipc');
const { registerSection8Ipc } = require('./section8Ipc');

registerSection7Ipc({ ipcMain, webContents });
registerSection8Ipc({ ipcMain });
require('./main.js');
