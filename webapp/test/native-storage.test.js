import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeStorage } from '../native-storage.js';

test('native-storage：异步原生写回调完成前不 resolve，且能 flush', async () => {
  let tokenSeen = '';
  globalThis.OrbitAndroidStorage = {
    hasDirectory: () => true,
    readDatabase: () => '',
    writeDatabaseAsync: (_b64, token) => {
      tokenSeen = token;
      setTimeout(() => globalThis.__orbitNativeWriteDone(token, true), 20);
    },
    describe: () => 'mock',
  };
  const storage = createNativeStorage();
  let done = false;
  const p = storage.write(new Uint8Array([1, 2, 3])).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(done, false);
  assert.notEqual(tokenSeen, '');
  await p;
  await storage.flush();
  assert.equal(done, true);
});
