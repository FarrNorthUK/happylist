import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeListView } from '../js/views/list-model.js';

const item = (id, name, extra = {}) =>
  ({ id, name, deletedAt: null, boughtAt: null, removedAt: null, storeIds: [], ...extra });
const store = (id, name) => ({ id, name, sortOrder: id, colour: '#000' });

test('computeListView: no items → empty "no-items"', () => {
  const vm = computeListView({ items: [], stores: [] });
  assert.equal(vm.empty, 'no-items');
  assert.equal(vm.active.length, 0);
  assert.equal(vm.inactive.length, 0);
});

test('computeListView: items exist but all filtered out → empty "no-match"', () => {
  const vm = computeListView({
    items: [item(1, 'Milk', { storeIds: [1] })],
    stores: [store(1, 'A')],
    selectedStoreIds: [99],
  });
  assert.equal(vm.empty, 'no-match');
});

test('computeListView: splits active and inactive, sorted by name', () => {
  const vm = computeListView({
    items: [
      item(1, 'Milk'),
      item(2, 'Eggs', { boughtAt: 'now' }),
      item(3, 'Bread', { removedAt: 'now' }),
    ],
    stores: [],
  });
  assert.deepEqual(vm.active.map(i => i.name), ['Milk']);
  assert.deepEqual(vm.inactive.map(i => i.name), ['Bread', 'Eggs']);
  assert.equal(vm.empty, null);
});

test('computeListView: sorts active by name', () => {
  const vm = computeListView({ items: [item(1, 'Zebra'), item(2, 'Apple')], stores: [] });
  assert.deepEqual(vm.active.map(i => i.name), ['Apple', 'Zebra']);
});

test('computeListView: store filter narrows items', () => {
  const vm = computeListView({
    items: [item(1, 'Milk', { storeIds: [1] }), item(2, 'Eggs', { storeIds: [2] })],
    stores: [store(1, 'A'), store(2, 'B')],
    selectedStoreIds: [1],
  });
  assert.deepEqual(vm.active.map(i => i.name), ['Milk']);
});

test('computeListView: multiple stores union — items from any selected store show', () => {
  const vm = computeListView({
    items: [
      item(1, 'Milk', { storeIds: [1] }),
      item(2, 'Eggs', { storeIds: [2] }),
      item(3, 'Bread', { storeIds: [3] }),
    ],
    stores: [store(1, 'A'), store(2, 'B'), store(3, 'C')],
    selectedStoreIds: [1, 2],
  });
  assert.deepEqual(vm.active.map(i => i.name), ['Eggs', 'Milk']);
});

test('computeListView: item in both selected stores appears once', () => {
  const vm = computeListView({
    items: [item(1, 'Milk', { storeIds: [1, 2] }), item(2, 'Eggs', { storeIds: [2] })],
    stores: [store(1, 'A'), store(2, 'B')],
    selectedStoreIds: [1, 2],
  });
  assert.deepEqual(vm.active.map(i => i.name), ['Eggs', 'Milk']);
});

test('computeListView: empty selection = All — every item shows', () => {
  const vm = computeListView({
    items: [item(1, 'Milk', { storeIds: [1] }), item(2, 'Eggs', { storeIds: [2] })],
    stores: [store(1, 'A'), store(2, 'B')],
    selectedStoreIds: [],
  });
  assert.deepEqual(vm.active.map(i => i.name), ['Eggs', 'Milk']);
});

test('computeListView: search filter narrows items (case-insensitive)', () => {
  const vm = computeListView({ items: [item(1, 'Milk'), item(2, 'Bread')], stores: [], searchQuery: 'MILK' });
  assert.deepEqual(vm.active.map(i => i.name), ['Milk']);
});

test('computeListView: filters array is All + per-store with correct active flag', () => {
  const vm = computeListView({
    items: [],
    stores: [store(1, 'A'), store(2, 'B')],
    selectedStoreIds: [2],
  });
  assert.equal(vm.filters.length, 3);
  assert.deepEqual(vm.filters[0], { label: 'All', storeId: null, colour: null, active: false });
  assert.equal(vm.filters[1].active, false);
  assert.equal(vm.filters[2].label, 'B');
  assert.equal(vm.filters[2].active, true);
});

test('computeListView: multiple store chips can be active at once', () => {
  const vm = computeListView({
    items: [],
    stores: [store(1, 'A'), store(2, 'B'), store(3, 'C')],
    selectedStoreIds: [1, 3],
  });
  assert.equal(vm.filters[0].active, false);
  assert.equal(vm.filters[1].active, true);
  assert.equal(vm.filters[2].active, false);
  assert.equal(vm.filters[3].active, true);
});

test('computeListView: "All" filter active when no store selected', () => {
  const vm = computeListView({ items: [], stores: [store(1, 'A')] });
  assert.equal(vm.filters[0].active, true);
});
