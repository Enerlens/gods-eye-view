// src/data/lazyLayer.test.mjs
//
// The stub has to be indistinguishable from the module it stands in for, from
// where `DataLayerManager` sits. These tests pin the two halves of that: what
// the stub answers BEFORE the chunk is fetched (and that it does not fetch it),
// and that everything the module publishes reaches callers afterwards.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAZY_LAYER_CAPABILITIES,
  LAZY_LAYER_REQUIRED_METHODS,
  createLazyLayer,
} from './lazyLayer.js';

/** A layer module with a recording surface, plus the loader that yields it. */
function fakeLayer(overrides = {}) {
  const calls = [];
  const module = {
    id: 'test-layer',
    name: 'Test Layer',
    icon: '◈',
    source: 'Test',
    refreshInterval: 30000,
    params: { mode: 'now' },
    init: (...args) => { calls.push(['init', ...args]); return true; },
    enable: (...args) => { calls.push(['enable', ...args]); return true; },
    disable: (...args) => { calls.push(['disable', ...args]); return true; },
    update: (...args) => { calls.push(['update', ...args]); return true; },
    destroy: () => { calls.push(['destroy']); return true; },
    getStats: () => ({ count: 7, lastUpdate: 1234 }),
    setParams: function setParams(params) {
      calls.push(['setParams', params]);
      this.params = { ...this.params, ...params };
      return true;
    },
    getParams: function getParams() { return { ...this.params }; },
    getRowControls: function getRowControls() { return { owner: this.id }; },
    ...overrides,
  };
  return { module, calls };
}

function descriptorFor(module, { load, ...extra } = {}) {
  return {
    id: module.id,
    name: module.name,
    icon: module.icon,
    source: module.source,
    capabilities: LAZY_LAYER_CAPABILITIES.filter((name) => typeof module[name] === 'function'),
    defaultParams: typeof module.getParams === 'function' ? module.getParams() : undefined,
    load: load || (async () => module),
    ...extra,
  };
}

test('identity is answered without loading anything', () => {
  const { module } = fakeLayer();
  let loads = 0;
  const layer = createLazyLayer(descriptorFor(module, {
    load: async () => { loads += 1; return module; },
  }));
  assert.equal(layer.id, 'test-layer');
  assert.equal(layer.name, 'Test Layer');
  assert.equal(layer.icon, '◈');
  assert.equal(layer.source, 'Test');
  assert.equal(layer.__lazy.isLoaded(), false);
  assert.equal(loads, 0);
});

test('showInTogglePanel is carried only when the module hides itself', () => {
  const { module } = fakeLayer();
  const shown = createLazyLayer(descriptorFor(module));
  // getAll() reads `showInTogglePanel !== false`, so absent must stay absent.
  assert.equal(Object.hasOwn(shown, 'showInTogglePanel'), false);
  const hidden = createLazyLayer(descriptorFor(module, { showInTogglePanel: false }));
  assert.equal(hidden.showInTogglePanel, false);
});

test('optional methods exist only where the module has them', () => {
  const { module } = fakeLayer({ setParams: undefined, getParams: undefined });
  delete module.setParams;
  delete module.getParams;
  const layer = createLazyLayer(descriptorFor(module));
  // The manager decides a layer takes no parameters by probing for the method.
  // A stub that always had one would make it accept an intent it must refuse.
  assert.equal(typeof layer.setParams, 'undefined');
  assert.equal(typeof layer.getParams, 'undefined');
  assert.equal(typeof layer.destroy, 'function');
  for (const method of LAZY_LAYER_REQUIRED_METHODS) {
    assert.equal(typeof layer[method], 'function');
  }
});

test('init() loads once, however many callers race it', async () => {
  const { module, calls } = fakeLayer();
  let loads = 0;
  const layer = createLazyLayer(descriptorFor(module, {
    load: async () => { loads += 1; return module; },
  }));
  const [a, b] = await Promise.all([layer.init('viewer', { signal: null }), layer.init('viewer')]);
  assert.equal(a, true);
  assert.equal(b, true);
  assert.equal(loads, 1);
  assert.equal(layer.__lazy.isLoaded(), true);
  assert.equal(calls.filter(([name]) => name === 'init').length, 2);
  // The arguments are forwarded untouched.
  assert.deepEqual(calls[0], ['init', 'viewer', { signal: null }]);
});

test('lifecycle calls reach the module after load', async () => {
  const { module, calls } = fakeLayer();
  const layer = createLazyLayer(descriptorFor(module));
  await layer.init('viewer');
  assert.equal(await layer.enable('viewer'), true);
  assert.equal(await layer.update('viewer'), true);
  assert.equal(await layer.disable('viewer'), true);
  assert.deepEqual(calls.map(([name]) => name), ['init', 'enable', 'update', 'disable']);
});

test('destroy() on an unloaded layer is a no-op that fetches nothing', async () => {
  const { module, calls } = fakeLayer();
  let loads = 0;
  const layer = createLazyLayer(descriptorFor(module, {
    load: async () => { loads += 1; return module; },
  }));
  assert.equal(layer.destroy('viewer'), true);
  assert.equal(loads, 0);
  assert.deepEqual(calls, []);
  await layer.init('viewer');
  assert.equal(layer.destroy('viewer'), true);
  assert.deepEqual(calls.at(-1), ['destroy']);
});

test('getStats() reads empty before load and the module after', async () => {
  const { module } = fakeLayer();
  const layer = createLazyLayer(descriptorFor(module));
  assert.deepEqual(layer.getStats(), { count: 0, lastUpdate: null });
  await layer.init('viewer');
  assert.deepEqual(layer.getStats(), { count: 7, lastUpdate: 1234 });
});

test('parameters set before load are replayed in order once it lands', async () => {
  const { module, calls } = fakeLayer();
  const layer = createLazyLayer(descriptorFor(module));
  assert.equal(layer.setParams({ mode: 'week' }, { origin: 'user' }), true);
  assert.equal(layer.setParams({ extra: 1 }), true);
  // Read back before the module exists: the manifest's defaults, updated by
  // what the stub was handed.
  assert.deepEqual(layer.getParams(), { mode: 'week', extra: 1 });
  await layer.init('viewer');
  assert.deepEqual(
    calls.filter(([name]) => name === 'setParams'),
    [['setParams', { mode: 'week' }], ['setParams', { extra: 1 }]],
  );
  assert.deepEqual(layer.getParams(), { mode: 'week', extra: 1 });
});

test('getParams() before load answers the module default', () => {
  const { module } = fakeLayer();
  const layer = createLazyLayer(descriptorFor(module));
  assert.deepEqual(layer.getParams(), { mode: 'now' });
});

test('attachDataManager is replayed before the module is initialized', async () => {
  const order = [];
  const { module } = fakeLayer({
    attachDataManager(manager) { order.push(['attach', manager]); },
    init() { order.push(['init']); return true; },
  });
  const layer = createLazyLayer(descriptorFor(module));
  layer.attachDataManager('manager');
  assert.deepEqual(order, []);
  await layer.init('viewer');
  assert.deepEqual(order, [['attach', 'manager'], ['init']]);
});

test('only the last lifecycle presentation survives the wait', async () => {
  const seen = [];
  const { module } = fakeLayer({ setLifecyclePresentation: (state) => seen.push(state) });
  const layer = createLazyLayer(descriptorFor(module));
  layer.setLifecyclePresentation({ state: 'enabling' });
  layer.setLifecyclePresentation({ state: 'enabled' });
  assert.deepEqual(seen, []);
  await layer.init('viewer');
  assert.deepEqual(seen, [{ state: 'enabled' }]);
});

test('cancelling a pending restore on an unloaded layer fetches nothing', async () => {
  const seen = [];
  const { module } = fakeLayer({ cancelPendingTrackingRestore: (opts) => seen.push(opts) });
  let loads = 0;
  const layer = createLazyLayer(descriptorFor(module, {
    load: async () => { loads += 1; return module; },
  }));
  assert.equal(layer.cancelPendingTrackingRestore({ reason: 'x' }), undefined);
  assert.equal(loads, 0);
  assert.deepEqual(seen, []);
  await layer.init('viewer');
  layer.cancelPendingTrackingRestore({ reason: 'y' });
  assert.deepEqual(seen, [{ reason: 'y' }]);
});

test('the module surface appears on the stub once loaded, bound to the module', async () => {
  const { module } = fakeLayer();
  const layer = createLazyLayer(descriptorFor(module));
  assert.equal(typeof layer.getRowControls, 'undefined');
  await layer.init('viewer');
  assert.equal(typeof layer.getRowControls, 'function');
  // `this` stays the module, so a method reading its siblings still finds them.
  assert.deepEqual(layer.getRowControls(), { owner: 'test-layer' });
  // Non-function fields are live, not snapshots: `_armUpdateLoop()` reads
  // refreshInterval after enable, and layers mutate their own published fields.
  assert.equal(layer.refreshInterval, 30000);
  module.refreshInterval = 60000;
  assert.equal(layer.refreshInterval, 60000);
});

test('a failed load can be retried', async () => {
  const { module } = fakeLayer();
  let attempts = 0;
  const layer = createLazyLayer(descriptorFor(module, {
    load: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('chunk 404');
      return module;
    },
  }));
  await assert.rejects(() => layer.init('viewer'), /chunk 404/);
  assert.equal(layer.__lazy.isLoaded(), false);
  assert.equal(await layer.init('viewer'), true);
  assert.equal(attempts, 2);
});

test('a loader that answers with the wrong module is refused', async () => {
  const { module } = fakeLayer();
  const layer = createLazyLayer(descriptorFor(module, {
    load: async () => ({ ...module, id: 'someone-else' }),
  }));
  await assert.rejects(() => layer.init('viewer'), /loaded someone-else/);
});

test('a descriptor without an id, a loader, or a known capability is refused', () => {
  const { module } = fakeLayer();
  assert.throws(() => createLazyLayer({ load: async () => module }), /stable id/);
  assert.throws(() => createLazyLayer({ id: 'x' }), /no loader/);
  assert.throws(
    () => createLazyLayer({ id: 'x', load: async () => module, capabilities: ['getRowControls'] }),
    /Unknown lazy-layer capability/,
  );
});
