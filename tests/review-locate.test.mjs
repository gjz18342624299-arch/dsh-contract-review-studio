import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const start=html.indexOf('/* review-locate-integration:v1'),end=html.indexOf('/* risk-card-collapse:',start);
assert.ok(start>=0&&end>start,'shipped latest-request locator exists');
const source=html.slice(start,end);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

function harness(run){
 const c={id:'synthetic-contract',clauses:[{text:'原文甲'},{text:'原文乙'}]},cards=new Map(),messages=[],calls=[];
 function card(id){
  if(cards.has(id))return cards.get(id);
  const next={hidden:true,disabled:true};let status;
  const item={dataset:{},querySelector(selector){return selector==='[data-risk-position]'?status:selector==='[data-next-risk]'?next:null;},append(node){status=node;},get message(){return status?.textContent},next};
  cards.set(id,item);return item;
 }
 const bridge={async run(action,data,options){calls.push({action,data,options});return run(action,data,options);}};
 const context=vm.createContext({AbortController,DOMException,setTimeout,clearTimeout,Date,Map,
  locatingIssue:0,current:()=>c,view:'review',onlyOfficeBridge:bridge,activeOfficeId:c.id,officeStates:new Map([[c.id,{phase:'ready'}]]),
  riskMatchPositions:new WeakMap(),manualMatchPositions:new WeakMap(),decision:()=>({status:'open'}),riskWritePlan:(_c,r)=>({original:r.quote}),manualDraftOriginal:(_r,i)=>i.quote,
  wpsContractId:null,wpsActiveInstance:null,onlyOfficeInstance:null,locateWpsIssue(){},locateManualMatch(){},
  document:{getElementById:id=>card(id),createElement:()=>({dataset:{},setAttribute(){}}),querySelector:()=>null},
  manualMatchFeedback:(target,message,next)=>{target.message=message;target.next=next;},toast:message=>messages.push(message)});
 vm.runInContext(source,context);
 return {context,c,bridge,cards,card,messages,calls};
}

test('quickly changing risk cards cancels the older pending location before it selects text',async()=>{
 const first=deferred();
 const h=harness(async(action,data)=>action==='count'?(data.candidates[0]==='原文甲'?first.promise:{count:1}):{ok:true,quote:data.candidates[0],count:1,occurrenceIndex:0,viewport:{page:3,centered:true}});
 const a={id:'a',clause:0,quote:'原文甲'},b={id:'b',clause:1,quote:'原文乙'};
 const firstRequest=h.context.locateWpsIssue(h.c,a,true);await tick();
 const latestRequest=h.context.locateWpsIssue(h.c,b,true);await latestRequest;
 first.resolve({count:1});await firstRequest;
 assert.deepEqual(h.calls.filter(x=>x.action==='locate').map(x=>x.data.candidates[0]),['原文乙']);
 assert.ok(h.card('risk-b').message.includes('已定位原文'));
 assert.ok(h.card('risk-b').message.includes('第 3 页'));
 assert.equal(h.context.riskMatchPositions.has(a),false);
 assert.equal(h.context.riskMatchPositions.get(b).quote,'原文乙');
});

test('closing a card cancels an in-flight lookup and prevents a delayed jump',async()=>{
 const pending=deferred(),h=harness(()=>pending.promise),risk={id:'a',quote:'原文甲',clause:0};
 const request=h.context.locateWpsIssue(h.c,risk,false);await tick();
 h.context.cancelReviewLocate();pending.resolve({count:1});await request;
 assert.equal(h.calls.filter(x=>x.action==='locate').length,0);
 assert.equal(h.context.riskMatchPositions.has(risk),false);
});

test('manual and model risk cards share the same latest-location guard',async()=>{
 const pending=deferred(),h=harness(async(action,data)=>action==='count'?(data.candidates[0]==='原文甲'?pending.promise:{count:1}):{ok:true,quote:data.candidates[0],count:1,occurrenceIndex:0});
 const entry={record:{ruleId:'manual'},issue:{quote:'原文甲'}},manual={dataset:{}};
 const old=h.context.locateManualMatch(manual,h.c,entry);await tick();
 await h.context.locateWpsIssue(h.c,{id:'b',quote:'原文乙',clause:1},true);
 pending.resolve({count:1});assert.equal(await old,null);
 assert.deepEqual(h.calls.filter(x=>x.action==='locate').map(x=>x.data.candidates[0]),['原文乙']);
 assert.equal(h.context.manualMatchPositions.has(entry.record),false);
});

test('missing text gives visible feedback without retaining an outdated anchor',async()=>{
 const h=harness(async()=>({count:0})),risk={id:'a',quote:'原文甲',clause:0};
 h.context.riskMatchPositions.set(risk,{quote:'旧原文'});
 await h.context.locateWpsIssue(h.c,risk,true);
 assert.match(h.card('risk-a').message,/未找到/);assert.equal(h.card('risk-a').next.hidden,true);
 assert.equal(h.context.riskMatchPositions.has(risk),false);assert.equal(h.messages.length,1);
});
