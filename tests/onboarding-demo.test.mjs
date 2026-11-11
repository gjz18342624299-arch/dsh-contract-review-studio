import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/real-files/onboarding-demo.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
function harness(){
 const context=vm.createContext({});
 const clauses=html.match(/const seedClauses=\[[\s\S]*?\n\];/)[0];
 const risks=html.match(/const seedRisks=\[[\s\S]*?\n\];/)[0];
 const sample=html.match(/^function sample\(.*$/m)[0];
 vm.runInContext('const clone=v=>JSON.parse(JSON.stringify(v));'+clauses+risks+sample+';globalThis.sampleFactory=sample;',context);
 vm.runInContext(source,context);
 return {demo:context.ContractReviewDemo,sample:context.sampleFactory,context};
}
const empty=()=>({contracts:[],active:'',v2:{projects:[],templates:[],rules:[],realSourceVersion:1002}});
test('fresh workspace receives one synthetic project and six usable preset risks',()=>{
 const {demo,sample}=harness(),data=empty();
 const p=demo.add(data,sample,true),c=data.contracts[0];
 assert.equal(data.v2.projects.length,1);assert.equal(c.risks.length,6);assert.equal(c.onboardingDemo,true);
 assert.ok(c.partyA.includes('虚构'));assert.equal(c.projectId,p.id);
 for(const risk of c.risks){assert.ok(c.clauses[risk.clause].text.includes(risk.quote));assert.ok(risk.suggestion.length>10);}
 assert.equal(c.onlyOfficeFileId,undefined);assert.equal(data.v2.realSourceVersion,1002);
});
test('automatic onboarding leaves existing projects, materials and preferences unchanged',()=>{
 const {demo,sample}=harness(),data=empty();data.v2.projects.push({id:'user-project',contractIds:['user-contract']});data.contracts.push({id:'user-contract',title:'用户合同'});data.active='user-contract';
 const before=JSON.stringify(data);assert.equal(demo.add(data,sample,true),null);assert.equal(JSON.stringify(data),before);
});
test('reopening or explicitly opening does not duplicate or reset edited demo',()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);const c=data.contracts[0];
 demo.decide(c,c.risks[0].id,'accepted');const before=JSON.stringify(data);
 assert.equal(demo.add(data,sample,true),null);demo.add(data,sample);assert.equal(JSON.stringify(data),before);
});
test('removed demonstration stays removed until explicitly requested',()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);data.contracts=[];data.v2.projects=[];
 assert.equal(demo.add(data,sample,true),null);assert.equal(data.contracts.length,0);
 assert.ok(demo.add(data,sample));assert.equal(data.contracts.length,1);
});
test('manual addition preserves user data and refusal on ID collision does not overwrite it',()=>{
 const {demo,sample}=harness(),data=empty();const user={id:'user-contract',title:'真实资料'};data.contracts.push(user);data.active=user.id;
 demo.add(data,sample);assert.equal(data.contracts[0],user);assert.equal(data.active,user.id);
 const collision=empty();collision.v2.projects.push({id:demo.projectId,name:'用户自建项目'});const before=JSON.stringify(collision);
 assert.equal(demo.add(collision,sample),null);assert.equal(JSON.stringify(collision),before);
});
test('accept and undo are reversible and refuse mutations to real contracts',()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);const c=data.contracts[0],original=JSON.stringify(c.clauses),risk=c.risks[0];
 demo.decide(c,risk.id,'accepted');assert.equal(c.decisions[risk.id].text,risk.suggestion);
 demo.decide(c,risk.id,'open');assert.equal(c.decisions[risk.id],undefined);assert.equal(JSON.stringify(c.clauses),original);
 const real={risks:c.risks,decisions:{}};assert.throws(()=>demo.decide(real,risk.id,'accepted'));assert.equal(JSON.stringify(real.decisions),'{}');
});
test('demo review renders working actions without an editor and delegates real contracts',()=>{
 const {demo,sample,context}=harness(),data=empty();
 let handler,ordinary=0,preview=0,saves=0;
 Object.assign(context,{data,sample,selected:'payment',view:'projects',riskHTML:()=>'<real-risk>',renderReview:()=>ordinary++,shell:()=>{},current:()=>data.contracts.find(c=>c.id===data.active),old:{review:()=>preview++},save:()=>{saves++;return true;},toast:()=>{},esc:value=>String(value),badge:()=>'<span>预设风险</span>'});
 context.window={ContractReviewDemo:demo,addEventListener:(name,fn)=>{assert.equal(name,'click');handler=fn;}};
 context.document={createElement:()=>({setAttribute(){}}),querySelector:()=>null,querySelectorAll:()=>[]};
 context.fetch=()=>{throw Error('demo must not call external services');};
 const integration=html.match(/\/\* onboarding-demo-integration:v1 \*\/[\s\S]*?\/\* \/onboarding-demo-integration:v1 \*\//)[0];
 vm.runInContext(integration,context);
 context.renderReview();assert.equal(preview,1);assert.equal(ordinary,0);
 const c=data.contracts[0];assert.ok(context.riskHTML(c,c.risks[0]).includes('采纳修改（演示）'));
 let stopped=false;
 handler({target:{closest:()=>({dataset:{v2:'wps-insert',id:c.risks[0].id}})},preventDefault(){},stopImmediatePropagation(){stopped=true;}});
 assert.equal(stopped,true);assert.equal(c.decisions.payment.status,'accepted');assert.equal(saves,1);
 assert.ok(context.riskHTML(c,c.risks[0]).includes('撤回处理'));
 data.contracts.unshift({id:'real',onboardingDemo:false});data.active='real';context.renderReview();assert.equal(ordinary,1);
});
test('both application scripts and demo integration remain valid JavaScript',()=>{
 let count=0;for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
  if(/\bsrc\s*=/.test(match[1]))continue;new vm.Script(match[2]);count++;
 }
 assert.equal(count,3);
 assert.equal(html.match(/<script id="onboarding-demo-model">([\s\S]*?)<\/script>/)[1].trim(),source.trim());
});
