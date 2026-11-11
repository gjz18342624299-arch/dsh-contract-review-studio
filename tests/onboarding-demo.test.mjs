import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
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
const simpleAdapters=()=>({decode:base64=>Buffer.from(base64,'base64'),store:async bytes=>({id:'word-original',name:'演示.docx',sha256:'test',size:bytes.length}),persist:async()=>{}});
function zipPart(bytes,part){
 let pos=0;while(pos+30<bytes.length&&bytes.readUInt32LE(pos)===0x04034b50){
  const size=bytes.readUInt32LE(pos+18),nameLength=bytes.readUInt16LE(pos+26),extra=bytes.readUInt16LE(pos+28),start=pos+30+nameLength+extra;
  if(bytes.subarray(pos+30,pos+30+nameLength).toString()===part){const raw=bytes.subarray(start,start+size);return bytes.readUInt16LE(pos+8)===8?inflateRawSync(raw).toString():raw.toString();}pos=start+size;
 }throw Error('missing ZIP part '+part);
}
test('fresh workspace receives six preset risks whose exact quotes exist in the bundled Word',async()=>{
 const {demo,sample}=harness(),data=empty(),p=demo.add(data,sample,true),c=data.contracts[0];
 assert.equal(data.v2.projects.length,1);assert.equal(c.risks.length,6);assert.ok(c.partyA.includes('虚构'));assert.equal(c.projectId,p.id);
 const bytes=Buffer.from(demo.documentBase64,'base64');assert.deepEqual(bytes,await readFile(new URL('../public/real-files/onboarding-demo-contract.docx',import.meta.url)));
 const body=zipPart(bytes,'word/document.xml');for(const r of c.risks){assert.ok(body.includes(r.quote));assert.ok(r.suggestion.length>10);}
 assert.equal(data.v2.realSourceVersion,1002);assert.equal(demo.needsWord(c),true);
});
test('automatic onboarding adds one ordinary bundled project while preserving existing work and active choice',()=>{
 const {demo,sample}=harness(),data=empty();data.v2.projects.push({id:'user-project',contractIds:['user-contract']});data.contracts.push({id:'user-contract',title:'用户合同'});data.active='user-contract';
 const userProject=data.v2.projects[0],userContract=data.contracts[0],before=JSON.stringify({project:userProject,contract:userContract});
 assert.ok(demo.add(data,sample,true));assert.equal(data.v2.projects.length,2);assert.equal(data.contracts.length,2);assert.equal(data.v2.projects[0],userProject);assert.equal(data.contracts[0],userContract);assert.equal(data.active,'user-contract');
 assert.equal(JSON.stringify({project:userProject,contract:userContract}),before);const added=JSON.stringify(data);assert.equal(demo.add(data,sample,true),null);assert.equal(JSON.stringify(data),added);
});
test('reopening does not duplicate or reset edits and removed demonstrations stay removed',()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);data.contracts[0].decisions.payment={status:'kept'};const before=JSON.stringify(data);
 assert.equal(demo.add(data,sample,true),null);demo.add(data,sample);assert.equal(JSON.stringify(data),before);
 const removed=demo.remove(data,demo.projectId);assert.ok(removed);assert.equal(data.contracts.length,0);assert.equal(data.v2.projects.length,0);assert.equal(demo.add(data,sample,true),null);assert.equal(demo.add(data,sample),null);
 const collision=empty();collision.v2.projects.push({id:demo.projectId,name:'用户自建项目'});const conflict=JSON.stringify(collision);assert.equal(demo.add(collision,sample),null);assert.equal(JSON.stringify(collision),conflict);
});
test('same-name and contract-ID collisions never overwrite or duplicate user materials',()=>{
 const {demo,sample}=harness();for(const collision of ['name','contract']){
  const data=empty();if(collision==='name')data.v2.projects.push({id:'custom-project',name:demo.create(sample).project.name,contractIds:[]});else data.contracts.push({id:demo.contractId,title:'用户资料'});
  const before=JSON.stringify(data);assert.equal(demo.add(data,sample,true),null);assert.equal(JSON.stringify(data),before);
 }
});
test('an existing bundled project with a missing seen marker is registered without resetting edits',()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);delete data.v2.onboardingDemoSeen;const p=data.v2.projects[0],c=data.contracts[0];c.decisions.payment={status:'accepted',text:'旧演示修改'};const before=JSON.stringify({p,c});
 assert.equal(demo.add(data,sample,true),p);assert.equal(data.v2.onboardingDemoSeen,true);assert.equal(JSON.stringify({p,c}),before);assert.equal(data.contracts.length,1);assert.equal(data.v2.projects.length,1);
});
test('deleting the demo archives its full project and contracts, preserves user data and stays deleted after reload',()=>{
 const {demo,sample}=harness(),data=empty(),userProject={id:'real-project',contractIds:['real-contract']},userContract={id:'real-contract',projectId:'real-project',title:'真实合同'};
 data.v2.projects.push(userProject);data.contracts.push(userContract);demo.add(data,sample,true);const c=data.contracts.find(c=>c.onboardingDemo);c.originalFile={id:'file-reference',name:'演示.docx'};c.onlyOfficeFileId='saved-word';c.decisions.payment={status:'accepted',text:'保留修改'};data.active=c.id;
 const before=JSON.stringify(data);assert.equal(demo.remove(data,userProject.id),null);assert.equal(JSON.stringify(data),before);
 const removed=demo.remove(data,demo.projectId);assert.equal(data.v2.projects.length,1);assert.equal(data.v2.projects[0],userProject);assert.equal(data.contracts.length,1);assert.equal(data.contracts[0],userContract);assert.equal(data.active,userContract.id);
 assert.equal(removed.contracts[0].originalFile.id,'file-reference');assert.equal(removed.contracts[0].onlyOfficeFileId,'saved-word');assert.equal(removed.contracts[0].decisions.payment.text,'保留修改');assert.equal(data.v2.removedMaterials[0].contract.originalFile.id,'file-reference');
 const reloaded=JSON.parse(JSON.stringify(data)),snapshot=JSON.stringify(reloaded);assert.equal(demo.add(reloaded,sample,true),null);assert.equal(JSON.stringify(reloaded),snapshot);assert.equal(demo.remove(reloaded,demo.projectId),null);
});
test('demo deletion retains contracts also referenced by another project',()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);const shared=data.contracts[0];data.v2.projects.push({id:'other-project',contractIds:[shared.id]});
 const removed=demo.remove(data,demo.projectId);assert.equal(removed.contracts.length,0);assert.equal(data.contracts[0],shared);assert.equal(data.v2.projects[0].id,'other-project');
});
test('first Word preparation stores the actual DOCX once and does not create a remote session',async()=>{
 const {demo,sample}=harness(),c=demo.create(sample).contract;let stored=0;
 const adapters={...simpleAdapters(),store:async bytes=>{stored++;assert.equal(bytes.subarray(0,2).toString(),'PK');return {id:'word-original',name:demo.documentName};},session:()=>assert.fail('new baseline uses the normal editor session')};
 await Promise.all([demo.prepare(c,adapters),demo.prepare(c,adapters)]);assert.equal(stored,1);assert.equal(c.onboardingWordVersion,2);assert.equal(demo.needsWord(c),false);
 await demo.prepare(c,adapters);assert.equal(stored,1);assert.equal(c.originalFile.id,'word-original');
});
test('legacy accepted and manual edits become a Word baseline while their complete history survives',async()=>{
 const {demo,sample}=harness(),c=demo.create(sample).contract;c.decisions.payment={status:'accepted',text:'此前自定义付款修改'};c.overrides[2]='此前手动修改验收';c.versions.push({id:'user-version',name:'用户保存'});
 const original=JSON.stringify(c);let uploads=0;
 await Promise.all([demo.prepare(c,{...simpleAdapters(),migratedBytes:async contract=>{assert.equal(JSON.stringify(contract),original);return Buffer.from('migrated Word');},session:async()=>{uploads++;return {fileId:'word-file',key:'word-key'};}}),demo.prepare(c,simpleAdapters())]);
 assert.equal(uploads,1);assert.equal(c.onlyOfficeFileId,'word-file');assert.equal(c.decisions.payment.text,'此前自定义付款修改');assert.equal(c.decisions.payment.wpsWritten,true);assert.equal(c.overrides[2],'此前手动修改验收');assert.ok(c.versions.some(v=>v.id==='user-version'));
 const before=c.versions.find(v=>v.id==='onboarding-before-word-v2');assert.equal(before.decisions.payment.wpsWritten,undefined);assert.equal(before.decisions.payment.text,'此前自定义付款修改');assert.equal(before.overrides[2],'此前手动修改验收');assert.equal(before.textOnly,true);
});
test('failed migration preserves the old data and can be retried without a fake success',async()=>{
 const {demo,sample}=harness(),c=demo.create(sample).contract;c.decisions.payment={status:'accepted',text:'保留我的修改'};const before=JSON.stringify(c);
 const adapters={...simpleAdapters(),migratedBytes:async()=>Buffer.from('Word'),session:async()=>{throw Error('编辑器未配置');}};
 await assert.rejects(demo.prepare(c,adapters),/编辑器未配置/);assert.equal(JSON.stringify(c),before);assert.equal(demo.needsWord(c),true);
 adapters.session=async()=>({fileId:'restored-session',key:'restored-key'});await demo.prepare(c,adapters);assert.equal(demo.needsWord(c),false);
});
test('durability failure can retry saving without reuploading the Word file',async()=>{
 const {demo,sample}=harness(),c=demo.create(sample).contract;let stores=0,saves=0;
 const adapters={...simpleAdapters(),store:async()=>{stores++;return {id:'same-word'};},persist:async()=>{if(++saves===1)throw Error('保存失败');}};
 await assert.rejects(demo.prepare(c,adapters),/保存失败/);assert.equal(demo.needsWord(c),true);await demo.prepare(c,adapters);assert.equal(stores,1);assert.equal(saves,2);assert.equal(demo.needsWord(c),false);
});
test('existing Word sessions and real contracts are not reset or assigned sample documents',async()=>{
 const {demo,sample}=harness();for(const c of [{id:'real',onboardingDemo:false},Object.assign(demo.create(sample).contract,{onlyOfficeFileId:'existing',onlyOfficeKey:'existing-key'})]){
  const before=JSON.stringify(c);await demo.prepare(c,{store:()=>assert.fail('must not replace'),persist:()=>assert.fail('must not mutate')});assert.equal(JSON.stringify(c),before);
 }
 const c=demo.create(sample).contract;c.latestCapture={captureId:'existing'};const before=JSON.stringify(c);await assert.rejects(demo.prepare(c,simpleAdapters()),/已有来源或工作稿/);assert.equal(JSON.stringify(c),before);
});
test('a removed demo cannot be committed by a preparation that was already in flight',async()=>{
 const {demo,sample}=harness(),data=empty();demo.add(data,sample,true);const c=data.contracts[0];let complete;
 const store=new Promise(resolve=>{complete=resolve;}),task=demo.prepare(c,{...simpleAdapters(),store:()=>store,isPresent:contract=>data.contracts.includes(contract)});
 demo.remove(data,demo.projectId);complete({id:'orphan-kept-file'});await assert.rejects(task,/已移除/);assert.equal(c.originalFile,undefined);assert.equal(data.contracts.length,0);assert.equal(data.v2.removedProjects[0].contracts[0].originalFile,undefined);
});
test('ready demo uses the ordinary Word workflow and does not register a permanent homepage opener',()=>{
 const {demo,sample,context}=harness(),data=empty();demo.add(data,sample,true);const c=data.contracts[0];c.onboardingWordVersion=2;c.originalFile={id:'ready'};
 let ordinary=0,shells=0;const registrations=[],removedSelectors=[];
 Object.assign(context,{data,sample,view:'review',riskHTML:()=>'<real-risk>',renderReview:()=>ordinary++,renderProjects:()=>{},renderProject:()=>{},shell:()=>shells++,current:()=>c,save:()=>{},wpsEdits:new Map(),old:{review:()=>assert.fail('must use editor')},atob:base64=>Buffer.from(base64,'base64').toString('binary')});
 context.window={ContractReviewDemo:demo,addEventListener:(name,fn)=>{registrations.push(name);}};
 context.document={querySelector:()=>null,querySelectorAll:selector=>{removedSelectors.push(selector);return [];}};
 const integration=html.match(/\/\* onboarding-demo-integration:v2 \*\/[\s\S]*?\/\* \/onboarding-demo-integration:v2 \*\//)?.[0];assert.ok(integration,'v2 integration must be installed');
 vm.runInContext(integration,context);context.renderReview();assert.equal(ordinary,1);
 assert.equal(registrations.length,0);context.view='projects';context.shell();assert.equal(shells,1);assert.ok(removedSelectors.includes('#onboarding-demo,[data-demo-open]'));
 assert.equal(context.riskHTML(c,c.risks[0]),'<real-risk>');
});
test('application scripts compile and embed the current demo model',()=>{
 let count=0;for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(/\bsrc\s*=/.test(match[1]))continue;new vm.Script(match[2]);count++;}
 assert.ok(count>=3);assert.equal(html.match(/<script id="onboarding-demo-model">([\s\S]*?)<\/script>/)[1].trim(),source.trim());
});
