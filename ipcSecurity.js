const path = require('path');
const { pathToFileURL } = require('url');

function createSenderValidator(appRoot) {
  const trustedUrl = pathToFileURL(path.join(appRoot, 'index.html')).href;
  return function assertTrustedSender(event) {
    const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
    if (senderUrl !== trustedUrl) throw new Error('Blocked IPC request from an untrusted renderer.');
    return true;
  };
}

function secureIpcHandlers(ipcMain, assertTrustedSender) {
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => originalHandle(channel, (event, ...args) => {
    assertTrustedSender(event);
    return listener(event, ...args);
  });
}

module.exports = { createSenderValidator, secureIpcHandlers };
