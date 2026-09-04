import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRunView, computeShopGrid } from '../js/views/shop-model.js';

const item = (id, name, extra = {}) =>
  ({ id, name, deletedAt: null, boughtAt: null, removedAt: null, storeIds: [], ...extra });

// ── computeRunView ──

test('computeRunView: active unchecked item → wanted', () => {
  const vm = computeRunView({ allStoreItems: [item(1, 'Milk')], checkedNow: [] });
  assert.deepEqual(vm.wanted.map(i => i.name), ['Milk']);
  assert.equal(vm.ticked.length, 0);
  assert.equal(vm.inactive.length, 0);
  assert.equal(vm.empty, false);
});

test('computeRunView: checked item → ticked (not wanted)', () => {
  const vm = computeRunView({ allStoreItems: [item(1, 'Milk')], checkedNow: [{ itemId: 1 }] });
  assert.deepEqual(vm.ticked.map(i => i.name), ['Milk']);
  assert.equal(vm.wanted.length, 0);
  assert.equal(vm.inactive.length, 0);
});

test('computeRunView: bought item not checked → inactive', () => {
  const vm = computeRunView({ allStoreItems: [item(1, 'Milk', { boughtAt: 'now' })], checkedNow: [] });
  assert.deepEqual(vm.inactive.map(i => i.name), ['Milk']);
  assert.equal(vm.wanted.length, 0);
  assert.equal(vm.ticked.length, 0);
});

test('computeRunView: removed item → inactive even if checked', () => {
  const vm = computeRunView({
    allStoreItems: [item(1, 'Milk', { removedAt: 'now' })],
    checkedNow: [{ itemId: 1 }],
  });
  assert.deepEqual(vm.inactive.map(i => i.name), ['Milk']);
  assert.equal(vm.ticked.length, 0);
  assert.equal(vm.wanted.length, 0);
});

test('computeRunView: empty when no items at all', () => {
  const vm = computeRunView({ allStoreItems: [], checkedNow: [] });
  assert.equal(vm.empty, true);
});

test('computeRunView: sorts each section by name', () => {
  const vm = computeRunView({
    allStoreItems: [item(1, 'Zebra'), item(2, 'Apple')],
    checkedNow: [],
  });
  assert.deepEqual(vm.wanted.map(i => i.name), ['Apple', 'Zebra']);
});

// ── computeShopGrid ──

test('computeShopGrid: per-store counts and background', () => {
  const vm = computeShopGrid({
    stores: [{ id: 1, name: 'A', colour: '#000' }],
    counts: { 1: 3 },
  });
  assert.equal(vm.empty, false);
  assert.deepEqual(vm.cards, [{ id: 1, name: 'A', count: 3, bg: '#000' }]);
});

test('computeShopGrid: missing count defaults to 0', () => {
  const vm = computeShopGrid({ stores: [{ id: 1, name: 'A', colour: '#000' }], counts: {} });
  assert.equal(vm.cards[0].count, 0);
});

test('computeShopGrid: empty when no stores', () => {
  const vm = computeShopGrid({ stores: [], counts: {} });
  assert.equal(vm.empty, true);
  assert.equal(vm.cards.length, 0);
});
