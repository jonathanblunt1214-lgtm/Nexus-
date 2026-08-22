const crypto = require('crypto');

const VAULT_VERSION = 1;
const MAX_VAULT_BYTES = 1024 * 1024;

function requirePassphrase(value) {
  const passphrase = String(value || '');
  if (passphrase.length < 12) throw new Error('The account-vault passphrase must be at least 12 characters.');
  return passphrase;
}

function encryptVault(payload, passphrase) {
  const secret = requirePassphrase(passphrase);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plaintext.length > MAX_VAULT_BYTES) throw new Error('The account vault is too large to sync safely.');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return JSON.stringify({
    format: 'nexus-account-vault', version: VAULT_VERSION, kdf: 'scrypt', cipher: 'aes-256-gcm',
    salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptVault(serialized, passphrase) {
  const secret = requirePassphrase(passphrase);
  if (Buffer.byteLength(String(serialized || ''), 'utf8') > MAX_VAULT_BYTES * 2) throw new Error('The account vault is too large.');
  let envelope;
  try { envelope = JSON.parse(serialized); } catch { throw new Error('The account vault is not valid JSON.'); }
  if (envelope?.format !== 'nexus-account-vault' || envelope.version !== VAULT_VERSION) throw new Error('This account-vault format is not supported.');
  try {
    const salt = Buffer.from(envelope.salt, 'base64');
    const iv = Buffer.from(envelope.iv, 'base64');
    const key = crypto.scryptSync(secret, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('The vault could not be unlocked. Check the passphrase and try again.');
  }
}

module.exports = { encryptVault, decryptVault, requirePassphrase, VAULT_VERSION };
