import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDirectoryPermission } from '../storage.js';

test('hasDirectoryPermission：granted 才为 true', async () => {
  assert.equal(await hasDirectoryPermission({ queryPermission: async () => 'granted' }), true);
  assert.equal(await hasDirectoryPermission({ queryPermission: async () => 'prompt' }), false);
  assert.equal(await hasDirectoryPermission({ queryPermission: async () => 'denied' }), false);
});

test('hasDirectoryPermission：没有句柄/接口或查询抛错时安全降级', async () => {
  assert.equal(await hasDirectoryPermission(null), false);
  assert.equal(await hasDirectoryPermission({}), false);
  assert.equal(await hasDirectoryPermission({ queryPermission: async () => { throw new Error('bad handle'); } }), false);
});
