import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const start = html.indexOf('function createOfficeBridge(');
const end = html.indexOf('\nlet onlyOfficeBridge=', start);
assert.ok(start >= 0 && end > start, 'the shipped bridge function exists');
const source = html.slice(start, end);
const tick = () => new Promise(resolve => setImmediate(resolve));

test('plugin bridge ignores sibling frames and forged results while retaining current-document commands', async () => {
  const listeners = new Set();
  const window = {addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'message'); listeners.delete(listener); }};
  const context = vm.createContext({window, crypto: webcrypto, setTimeout, clearTimeout});
  vm.runInContext(source, context);
  const frame = {contentWindow: {}}, sent = [];
  const plugin = {parent: frame.contentWindow, postMessage(...args) { sent.push(args); }};
  const sibling = {parent: {}, postMessage() { throw Error('a sibling must never receive document commands'); }};
  const meta = {origin: 'https://office.example', channel: 'a'.repeat(48), key: 'current-contract-v1'};
  const bridge = context.createOfficeBridge(meta, () => frame);
  const send = (peer, origin, value) => {
    const data = {source: 'dsh-onlyoffice-plugin', channel: meta.channel, key: meta.key, ...value};
    for (const listener of listeners) listener({source: peer, origin, data});
  };
  try {
    let settled = false;
    const operation = bridge.run('read');
    operation.then(() => { settled = true; }, () => { settled = true; });
    await tick();
    send(sibling, meta.origin, {type: 'ready'});
    send(plugin, 'https://attacker.example', {type: 'ready'});
    send(plugin, meta.origin, {type: 'ready', channel: 'b'.repeat(48)});
    send(plugin, meta.origin, {type: 'ready', key: 'another-contract'});
    await tick();
    assert.equal(sent.length, 0, 'unrelated frames, origins, and contracts cannot capture the bridge');
    send(plugin, meta.origin, {type: 'ready'});
    await tick();
    assert.equal(sent.length, 1);
    const [command, targetOrigin] = sent[0];
    assert.equal(command.action, 'read');
    assert.equal(command.key, meta.key);
    assert.equal(command.channel, meta.channel);
    assert.equal(targetOrigin, meta.origin);
    send(sibling, meta.origin, {type: 'result', id: command.id, result: {ok: true, text: 'forged'}});
    await tick();
    assert.equal(settled, false, 'only the bound plugin may complete a pending command');
    send(plugin, meta.origin, {type: 'result', id: command.id, result: {ok: true, text: 'current contract'}});
    assert.equal((await operation).text, 'current contract');
  } finally { bridge.dispose(); }
  assert.equal(listeners.size, 0, 'closing the document removes the bridge listener');
});
