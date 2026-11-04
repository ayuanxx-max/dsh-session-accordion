// Regression test for the withdraw guard that ships inside client.js.
// Replays the core assembler contract that used to throw on long sessions:
//   node === null && previous !== null  ->  Error(... withdrew materialized target ...)
// Run: node test/guard.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const source = fs.readFileSync(path.join(root, '..', 'client.js'), 'utf8');

let bundle = null;
globalThis.window = { __ModuleLoader__: { load(def) { bundle = def; } } };
new Function('window', 'console', 'document', 'setInterval', 'setTimeout', 'MutationObserver', source)(
  globalThis.window,
  { info() {}, warn() {}, error() {} },
  undefined,
  () => 0,
  () => 0,
  class {},
);
assert.ok(bundle !== null, 'ModuleLoader.load called');
assert.equal(bundle.id, 'dsh-session-accordion');
const plugin = bundle.factory();
assert.equal(typeof plugin.apply, 'function');

function registry(definitions) {
  const listeners = new Set();
  return {
    definitions,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh() {
      for (const listener of [...listeners]) listener();
    },
  };
}

function upsert(context, definition, target) {
  const previous = context.current.get(target) ?? null;
  const node = definition.buildViewNode({
    key: context.key,
    kind: definition.kind,
    id: 1,
    matches: [],
    start: { event: { type: 'system/message', surfaceOp: 'append', seq: 7 } },
    state: context.state,
    current: context.current,
  });
  if (node === null && previous !== null) {
    throw new Error(`conversation Definition "${definition.kind}" withdrew materialized target "${target}"; return the same key with hidden visibility instead`);
  }
  context.current.set(target, node);
  return node;
}

const chatNode = { key: '7', kind: 'system-prompt', id: 1, target: 'chat', anchorSeq: 7, visibility: 'visible', data: { text: 'prompt' } };

// 1. the regression: withdrawn node is kept hidden instead of throwing
{
  const def = { kind: 'system-message', target: 'chat', buildViewNode: () => null };
  const other = { kind: 'request-prompt', target: 'chat', buildViewNode: () => null };
  const events = registry(new Map([['system-message', def], ['request-prompt', other]]));
  plugin.apply({ uiConversation: { events } });
  const context = { key: '7', state: {}, current: new Map([['chat', chatNode]]) };
  const node = upsert(context, def, 'chat');
  assert.equal(node.visibility, 'hidden');
  assert.equal(node.key, '7');
  assert.equal(node.data.text, 'prompt');
  assert.deepEqual(window.__acWithdrawGuard.installed.sort(), ['request-prompt', 'system-message']);
  assert.ok(window.__acWithdrawGuard.hits >= 1);
}

// 2. a definition that never materialized still reports absence
{
  const def = { kind: 'system-message', target: 'chat', buildViewNode: () => null };
  const context = { key: '9', state: {}, current: new Map() };
  assert.equal(upsert(context, def, 'chat'), null);
}

// 3. a real node passes through (visibility restored)
{
  const visible = { ...chatNode };
  const def = { kind: 'system-message', target: 'chat', buildViewNode: () => visible };
  const context = { key: '7', state: {}, current: new Map([['chat', { ...chatNode, visibility: 'hidden' }]]) };
  assert.equal(upsert(context, def, 'chat'), visible);
}

// 4. late registration is still guarded through registry refresh
{
  const events = registry(new Map());
  plugin.apply({ uiConversation: { events } });
  const late = { kind: 'system-message', target: 'chat', buildViewNode: () => null };
  events.definitions.set('system-message', late);
  events.refresh();
  const context = { key: '7', state: {}, current: new Map([['chat', chatNode]]) };
  assert.equal(upsert(context, late, 'chat').visibility, 'hidden');
}

// 5. malformed hosts never throw out of apply
for (const ctx of [{}, { uiConversation: {} }, { uiConversation: { events: null } }, null]) {
  plugin.apply(ctx);
}

console.log('guard.test.mjs: all assertions passed');
