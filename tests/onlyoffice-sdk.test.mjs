import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const sdkPath = process.env.ONLYOFFICE_SDK_TEST_PATH || new URL('../public/real-files/onlyoffice-api.js', import.meta.url);
const sdk = await readFile(sdkPath, 'utf8');
const suffix = '/web-apps/apps/api/documents/api.js';

function harness(origin = 'http://127.0.0.1:43881') {
  const listeners = new Map(), frames = [], scripts = [], nodes = new Map();
  const parent = {replaceChild(node, previous) {
    previous.parentNode = null;
    node.parentNode = parent;
    if (node.tagName === 'IFRAME' && !frames.includes(node)) frames.push(node);
    if (node.id) nodes.set(node.id, node);
  }};
  function element(tag) {
    const node = {tagName: tag.toUpperCase(), style: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; this[name] = value; }};
    if (tag === 'iframe') node.contentWindow = {posted: [], postMessage(...args) { this.posted.push(args); }};
    if (tag === 'script') scripts.push(node);
    return node;
  }
  const location = {origin, href: origin + '/workbench', search: ''};
  const window = {location, JSON, URL,
    alert(message) { throw Error(message); },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  window.parent = window;
  const document = {currentScript: {src: origin + '/api/contract-review-studio/real-files/onlyoffice-api.js'},
    createElement: element, getElementById(id) { return nodes.get(id); },
    getElementsByTagName() { return []; }, body: {style: {}}};
  const context = vm.createContext({window, document, URL, console,
    // An unrelated global must never affect the editor origin or path.
    extensionParams: {url: 'https://attacker.invalid/'},
    localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
    setTimeout, clearTimeout});
  vm.runInContext(sdk, context, {filename: 'onlyoffice-api.js'});
  function mount(id = 'editor') { const node = element('div'); node.id = id; node.parentNode = parent; nodes.set(id, node); }
  function config(events = {}) { return {type: 'desktop', documentType: 'word', width: '100%', height: '100%',
    document: {url: 'https://files.example/current.docx', key: 'contract-a-v1', fileType: 'docx', title: 'Test contract'},
    editorConfig: {mode: 'edit'}, events}; }
  function message(source, sourceOrigin, data) {
    for (const listener of [...(listeners.get('message') || [])]) listener({source, origin: sourceOrigin, data});
  }
  return {DocsAPI: window.DocsAPI, window, document, frames, scripts, mount, config, message, listeners};
}

test('only absolute HTTP(S) document server endpoints outside the workbench origin are accepted', () => {
  const {DocsAPI} = harness();
  for (const [input, expected] of [
    ['https://office.example' + suffix, 'https://office.example/web-apps/apps/'],
    ['http://127.0.0.1:8088' + suffix, 'http://127.0.0.1:8088/web-apps/apps/'],
    ['https://office.example/tenant-a' + suffix, 'https://office.example/tenant-a/web-apps/apps/'],
  ]) assert.equal(DocsAPI.normalizeDocumentServer(input), expected);
  for (const input of [
    undefined, null, {}, '', '//office.example' + suffix, '/web-apps/apps/api/documents/api.js',
    'javascript:alert(1)', 'data:text/javascript,alert(1)', 'file:///tmp/api.js', 'ftp://office.example' + suffix,
    'https://user:secret@office.example' + suffix, 'https://office.example' + suffix + '?cache=1',
    'https://office.example' + suffix + '#fragment', 'https://office.example/evil.js',
    'https://office.example' + suffix + '/extra', 'http://127.0.0.1:43881' + suffix,
    'http://127.0.0.1:43881/tenant' + suffix,
  ]) assert.throws(() => DocsAPI.normalizeDocumentServer(input), String(input));
});

test('gateway endpoint data only selects a cross-origin iframe; it never loads a script', () => {
  const h = harness(); h.mount();
  const config = h.config();
  config.documentServerUrl = 'https://attacker.invalid';
  config.apiUrl = 'https://attacker.invalid/evil.js';
  const editor = new h.DocsAPI.DocEditor('editor', config, 'https://office.example' + suffix);
  assert.equal(h.frames.length, 1);
  const url = new URL(h.frames[0].src);
  assert.equal(url.origin, 'https://office.example');
  assert.equal(url.pathname, '/web-apps/apps/documenteditor/main/index.html');
  assert.equal(h.scripts.length, 0);
  assert.equal(editor.getFrame(), h.frames[0]);
});

test('each editor uses its own server, including when a second instance is created', () => {
  const h = harness(); h.mount('first'); h.mount('second');
  new h.DocsAPI.DocEditor('first', h.config(), 'https://one.example' + suffix);
  new h.DocsAPI.DocEditor('second', h.config(), 'https://two.example' + suffix);
  assert.deepEqual(h.frames.map(frame => new URL(frame.src).origin), ['https://one.example', 'https://two.example']);
});

test('invalid endpoints fail before mounting any remote content', () => {
  for (const apiUrl of ['javascript:alert(1)', 'https://attacker.invalid/evil.js', 'http://127.0.0.1:43881' + suffix]) {
    const h = harness(); h.mount();
    assert.throws(() => new h.DocsAPI.DocEditor('editor', h.config(), apiUrl));
    assert.equal(h.frames.length, 0);
    assert.equal(h.scripts.length, 0);
  }
});

test('test/mobile/custom document configuration cannot select another iframe application', () => {
  for (const overrides of [{type: 'test'}, {type: 'mobile'}, {documentType: 'cell'}, {documentType: '../../evil'}]) {
    const h = harness(); h.mount();
    try { new h.DocsAPI.DocEditor('editor', {...h.config(), ...overrides}, 'https://office.example' + suffix); }
    catch { assert.equal(h.frames.length, 0); continue; }
    assert.equal(new URL(h.frames[0].src).pathname, '/web-apps/apps/documenteditor/main/index.html');
  }
});

test('SDK accepts readiness only from the mounted iframe and sends config to its exact origin', () => {
  const h = harness(); h.mount(); let ready = 0;
  const editor = new h.DocsAPI.DocEditor('editor', h.config({onAppReady() { ready++; }}), 'https://office.example' + suffix);
  const frame = editor.getFrame();
  const event = JSON.stringify({frameEditorId: 'editor', event: 'onAppReady'});
  h.message({postMessage() {}}, 'https://office.example', event);
  h.message(frame.contentWindow, 'https://attacker.invalid', event);
  h.message(frame.contentWindow, 'null', event);
  assert.equal(ready, 0);
  assert.equal(frame.contentWindow.posted.length, 0);
  h.message(frame.contentWindow, 'https://office.example', event);
  assert.equal(ready, 1);
  assert.ok(frame.contentWindow.posted.length >= 2, 'readiness should deliver editor config and document');
  for (const [, targetOrigin] of frame.contentWindow.posted) assert.equal(targetOrigin, 'https://office.example');
  editor.destroyEditor();
  h.message(frame.contentWindow, 'https://office.example', event);
  assert.equal(ready, 1, 'destroy removes the listener');
});
