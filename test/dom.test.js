import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, storeBg } from '../js/dom.js';

// ── esc ──

test('esc: escapes HTML special characters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('esc: passes through plain text unchanged', () => {
  assert.equal(esc('hello world'), 'hello world');
});

test('esc: coerces non-strings to string', () => {
  assert.equal(esc(42), '42');
  assert.equal(esc(null), 'null');
  assert.equal(esc(undefined), 'undefined');
});

// ── storeBg ──

test('storeBg: single colour when no colour2', () => {
  assert.equal(storeBg({ colour: '#fff', colour2: null }), '#fff');
  assert.equal(storeBg({ colour: '#000', colour2: '' }), '#000');
});

test('storeBg: gradient when colour2 present', () => {
  assert.equal(storeBg({ colour: '#fff', colour2: '#000' }), 'linear-gradient(135deg, #fff 50%, #000 50%)');
});
