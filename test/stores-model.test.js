import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStoreList } from '../js/views/stores-model.js';

test('computeStoreList: empty when no stores', () => {
  const vm = computeStoreList({ stores: [], itemCounts: {} });
  assert.equal(vm.empty, true);
  assert.equal(vm.rows.length, 0);
});

test('computeStoreList: count, hasCard, and reorder flags per row', () => {
  const vm = computeStoreList({
    stores: [
      { id: 1, name: 'A', colour: '#000', cardNumber: '123' },
      { id: 2, name: 'B', colour: '#fff', cardNumber: null },
    ],
    itemCounts: { 1: 5, 2: 0 },
  });
  assert.equal(vm.empty, false);
  assert.deepEqual(vm.rows[0], { id: 1, name: 'A', count: 5, bg: '#000', hasCard: true, canUp: false, canDown: true });
  assert.deepEqual(vm.rows[1], { id: 2, name: 'B', count: 0, bg: '#fff', hasCard: false, canUp: true, canDown: false });
});

test('computeStoreList: single store cannot reorder', () => {
  const vm = computeStoreList({ stores: [{ id: 1, name: 'A', colour: '#000' }], itemCounts: {} });
  assert.equal(vm.rows[0].canUp, false);
  assert.equal(vm.rows[0].canDown, false);
});

test('computeStoreList: missing count defaults to 0', () => {
  const vm = computeStoreList({ stores: [{ id: 1, name: 'A', colour: '#000' }], itemCounts: {} });
  assert.equal(vm.rows[0].count, 0);
});
