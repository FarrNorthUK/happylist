import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDevVersion, needsUpdate, createUpdateChecker } from '../js/update.js';

// ── needsUpdate ──

test('needsUpdate: same version → false', () => {
  assert.equal(needsUpdate('happylist-v1', 'happylist-v1'), false);
});

test('needsUpdate: different version → true', () => {
  assert.equal(needsUpdate('happylist-v1', 'happylist-v2'), true);
});

test('needsUpdate: null remote → false', () => {
  assert.equal(needsUpdate('happylist-v1', null), false);
});

test('needsUpdate: undefined remote → false', () => {
  assert.equal(needsUpdate('happylist-v1', undefined), false);
});

test('needsUpdate: empty-string remote → false', () => {
  assert.equal(needsUpdate('happylist-v1', ''), false);
});

// ── isDevVersion ──

test('isDevVersion: dev sentinel → true', () => {
  assert.equal(isDevVersion('dev'), true);
});

test('isDevVersion: stamped version → false', () => {
  assert.equal(isDevVersion('happylist-v20260904120000'), false);
});

// ── createUpdateChecker ──

test('checker: dev version skips fetch', async () => {
  const checker = createUpdateChecker({
    currentVersion: 'dev',
    fetchVersion: () => { throw new Error('fetchVersion must not be called'); },
  });
  const result = await checker.check();
  assert.deepEqual(result, { ok: true, updateAvailable: false, skipped: true });
});

test('checker: same remote version → no update', async () => {
  let calls = 0;
  const checker = createUpdateChecker({
    currentVersion: 'happylist-v1',
    fetchVersion: async () => { calls++; return 'happylist-v1'; },
  });
  const result = await checker.check();
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, updateAvailable: false, remote: 'happylist-v1' });
});

test('checker: different remote version → update available', async () => {
  const checker = createUpdateChecker({
    currentVersion: 'happylist-v1',
    fetchVersion: async () => 'happylist-v2',
  });
  const result = await checker.check();
  assert.deepEqual(result, { ok: true, updateAvailable: true, remote: 'happylist-v2' });
});

test('checker: null remote → no update', async () => {
  const checker = createUpdateChecker({
    currentVersion: 'happylist-v1',
    fetchVersion: async () => null,
  });
  const result = await checker.check();
  assert.deepEqual(result, { ok: true, updateAvailable: false, remote: null });
});

test('checker: fetch rejection → ok:false with error', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const checker = createUpdateChecker({
      currentVersion: 'happylist-v1',
      fetchVersion: async () => { throw new Error('network down'); },
    });
    const result = await checker.check();
    assert.equal(result.ok, false);
    assert.equal(result.updateAvailable, undefined);
    assert.equal(result.error.message, 'network down');
  } finally {
    console.warn = originalWarn;
  }
});
