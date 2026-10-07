import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const directory = path.join(os.homedir(), '.codex', 'private', 'wordweave');
fs.mkdirSync(directory, {recursive: true, mode: 0o700});
const keyFile = path.join(directory, 'registration-key.txt');
const configFile = path.join(directory, 'runtime-secrets.json');
if (!fs.existsSync(keyFile) && !fs.existsSync(configFile)) {
  const key = 'WW-' + randomBytes(32).toString('base64url');
  fs.writeFileSync(keyFile, key + '\n', {mode: 0o600, flag: 'wx'});
  fs.writeFileSync(configFile, JSON.stringify({REGISTRATION_KEY_HASH: createHash('sha256').update(key).digest('hex'), PASSWORD_PEPPER: randomBytes(32).toString('hex')}), {mode: 0o600, flag: 'wx'});
}
if (!fs.existsSync(keyFile) || !fs.existsSync(configFile)) throw Error('Incomplete secret files; will not overwrite.');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
// Only verifier and server pepper enter ignored local runtime configuration.
fs.writeFileSync('.dev.vars', Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', {mode: 0o600});
console.log(JSON.stringify({keyFile, configFile}));
