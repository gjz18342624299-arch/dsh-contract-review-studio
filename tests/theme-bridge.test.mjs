import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');

// Mount the real theme effect with only its DOM/React boundaries replaced.
function mount(){
 const origin='https://workbench.example',messages=[],effects=[],observers=[],frames=new Map();
 const listeners=new Map(),frameListeners=new Map(),fontListeners=new Map(),tokens=new Map();
 const bodyAttributes=new Map(),htmlAttributes=new Map(),containerProperties=new Map();
 const style={fontFamily:'"Segoe UI", sans-serif',getPropertyValue:name=>tokens.get(name)||''};
 const body={hasAttribute:name=>bodyAttributes.has(name)};
 const html={getAttribute:name=>htmlAttributes.get(name)||null};
 const child={postMessage:(payload,target)=>messages.push({payload:JSON.parse(JSON.stringify(payload)),target})};
 const iframe={contentWindow:child,parentElement:{style:{setProperty:(name,value)=>containerProperties.set(name,value)}},
  addEventListener:(name,fn)=>frameListeners.set(name,fn),removeEventListener:(name,fn)=>{if(frameListeners.get(name)===fn)frameListeners.delete(name);}};
 const window={location:{origin},getComputedStyle:()=>style,
  requestAnimationFrame:fn=>{const id=frames.size+1;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
  addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};
 const document={body,documentElement:html,head:{},fonts:{
  addEventListener:(name,fn)=>fontListeners.set(name,fn),removeEventListener:(name,fn)=>{if(fontListeners.get(name)===fn)fontListeners.delete(name);}
 }};
 let module,Panel,ref=0;
 const React={createElement:(...args)=>args,useRef:()=>({current:ref++===1?iframe:null}),
  useState:initial=>[initial==='正在连接工作台…'?'ready':initial,()=>{}],
  useEffect:(effect,deps)=>effects.push({effect,deps})};
 window.__ModuleLoader__={load:value=>{module=value;}};
 class MutationObserver{
  constructor(callback){this.callback=callback;this.targets=[];this.disconnected=false;observers.push(this);}
  observe(target,options){this.targets.push({target,options});}
  disconnect(){this.disconnected=true;}
 }
 vm.runInNewContext(source,{window,document,MutationObserver});
 module.factory(()=>React).apply({get:()=>({register:(_info,component)=>{Panel=component;}}),effect:fn=>fn()});
 Panel({conversation:null});
 const cleanup=effects.find(({deps})=>deps.length===1&&deps[0]==='ready').effect();
 const flush=()=>{const scheduled=[...frames.values()];frames.clear();for(const fn of scheduled)fn();};
 const receive=data=>listeners.get('message')?.({origin,source:child,data});
 return {origin,messages,tokens,style,iframe,bodyAttributes,htmlAttributes,containerProperties,observers,frames,listeners,frameListeners,fontListeners,cleanup,flush,receive};
}

test('theme adapter sends explicit light/dark theme, actual allowlisted tokens and inherited user font',()=>{
 const t=mount();
 assert.deepEqual(t.messages[0],{target:t.origin,payload:{type:'contract-workbench-theme',version:1,theme:'light',tokens:{'--dsw-font-family':'"Segoe UI", sans-serif'}}});
 t.tokens.set('--dsw-alias-label-primary','#f9fafb');
 t.tokens.set('--unknown-private-token','must not cross boundary');
 t.bodyAttributes.set('data-ds-dark-theme','');
 t.observers[0].callback();t.flush();
 assert.equal(t.messages.at(-1).payload.theme,'dark');
 assert.equal(t.messages.at(-1).payload.tokens['--dsw-alias-label-primary'],'#f9fafb');
 assert.equal(t.messages.at(-1).payload.tokens['--unknown-private-token'],undefined);
 assert.equal(t.containerProperties.get('--contract-host-bg'),'#151517');
 assert.equal(t.iframe.parentElement.style.colorScheme,'dark');
 t.cleanup();
});

test('theme-ready handshake checks origin, iframe identity and protocol version',()=>{
 const t=mount(),receive=t.listeners.get('message');
 const ready={type:'contract-workbench-theme-ready',version:1};
 receive({origin:'https://other.example',source:t.iframe.contentWindow,data:ready});
 receive({origin:t.origin,source:{},data:ready});
 t.receive({...ready,version:2});
 t.receive({type:'unrelated-message',version:1});
 assert.equal(t.messages.length,1);
 t.receive(ready);assert.equal(t.messages.length,2);
 t.frameListeners.get('load')();assert.equal(t.messages.length,3);
 assert.ok(t.messages.every(message=>message.target===t.origin));
 t.cleanup();
});

test('font/theme mutations coalesce without polling and cleanup removes subscriptions',()=>{
 const t=mount();
 t.style.fontFamily='"Microsoft YaHei", sans-serif';
 t.observers[0].callback();t.observers[0].callback();t.fontListeners.get('loadingdone')();
 assert.equal(t.frames.size,1);t.flush();
 assert.equal(t.messages.at(-1).payload.tokens['--dsw-font-family'],'"Microsoft YaHei", sans-serif');
 assert.equal(t.messages.length,2);
 t.observers[0].callback();t.flush();assert.equal(t.messages.length,2);
 t.observers[0].callback();assert.equal(t.frames.size,1);
 t.cleanup();
 assert.equal(t.frames.size,0);assert.equal(t.listeners.size,0);assert.equal(t.frameListeners.size,0);assert.equal(t.fontListeners.size,0);
 assert.ok(t.observers.every(observer=>observer.disconnected));
});
