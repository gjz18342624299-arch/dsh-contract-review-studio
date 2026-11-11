import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/real-files/project-lifecycle.js',import.meta.url),'utf8');
function api(){const context=vm.createContext({});vm.runInContext(source,context);return context.ContractReviewProjects;}
const workspace=(projects=[],contracts=[],active=contracts[0]?.id||'')=>({v2:{projects,removedProjects:[],removedMaterials:[],preferences:{preserve:true}},contracts,active});
const plain=value=>JSON.parse(JSON.stringify(value));

test('any ordinary project can be archived with its contracts, complete review state and file references',()=>{
 const projects=[{id:'first',name:'项目一',contractIds:['a'],fields:{'a:amount':100},confirmed:{'a:amount':true}},{id:'second',contractIds:['b']}];
 const contract={id:'a',projectId:'first',originalFile:{id:'original-bytes',name:'原件.docx'},onlyOfficeFileId:'remote-working-file',decisions:{payment:{status:'accepted',text:'修改文本'}},versions:[{id:'version',wordFile:{id:'word-snapshot'}}],checks:[{result:'pass'}]},other={id:'b',projectId:'second'};
 const data=workspace(projects,[contract,other],'a'),original=plain(contract),removed=api().remove(data,'first');
 assert.deepEqual(plain(removed.project),projects[0]);assert.deepEqual(plain(removed.contracts),[original]);assert.deepEqual(plain(removed.removedContractIds),['a']);assert.deepEqual(plain(removed.retainedContractIds),[]);
 assert.equal(data.v2.projects[0],projects[1]);assert.equal(data.contracts[0],other);assert.equal(data.active,'b');assert.equal(data.v2.removedMaterials.length,1);assert.deepEqual(plain(data.v2.removedMaterials[0].contract),original);assert.equal(data.v2.preferences.preserve,true);assert.equal(data.v2.onboardingDemoDismissed,undefined);
});

test('shared contracts remain live and get a valid remaining owner while the archive preserves their prior state',()=>{
 const a={id:'a',contractIds:['shared','only-a']},b={id:'b',contractIds:['shared','only-b']},shared={id:'shared',projectId:'a',originalFile:{id:'shared-bytes'}},onlyA={id:'only-a',projectId:'a'},onlyB={id:'only-b',projectId:'b'};
 const data=workspace([a,b],[shared,onlyA,onlyB],'shared'),removed=api().remove(data,'a');
 assert.deepEqual(plain(data.contracts.map(c=>c.id)),['shared','only-b']);assert.equal(data.contracts[0],shared);assert.equal(shared.projectId,'b');assert.equal(data.active,'shared');assert.equal(data.v2.projects[0],b);assert.deepEqual(b.contractIds,['shared','only-b']);
 assert.equal(removed.contracts.find(c=>c.id==='shared').projectId,'a');assert.deepEqual(plain(removed.retainedContractIds),['shared']);assert.deepEqual(plain(removed.removedContractIds),['only-a']);assert.deepEqual(plain(data.v2.removedMaterials.map(r=>r.contract.id)),['only-a']);
});

test('a contract with an effective other projectId survives a conflicting target reference',()=>{
 const a={id:'a',contractIds:['owned-by-b']},b={id:'b',contractIds:[]},c={id:'owned-by-b',projectId:'b',title:'保留元数据所有者的合同'};
 const data=workspace([a,b],[c],'owned-by-b'),before=JSON.stringify(c),removed=api().remove(data,'a');
 assert.equal(data.contracts[0],c);assert.equal(JSON.stringify(c),before);assert.deepEqual(b.contractIds,[]);assert.equal(data.v2.removedMaterials.length,0);assert.equal(removed.contracts.length,1);assert.deepEqual(plain(removed.retainedContractIds),[c.id]);
});

test('unlisted contracts owned by the deleted project are recovered without touching unrelated orphan records',()=>{
 const owned={id:'unlisted-owned',projectId:'a',versions:[{id:'preserved'}]},orphan={id:'unrelated-orphan',projectId:'missing-project'},unowned={id:'unowned'};
 const data=workspace([{id:'a',contractIds:[]}],[owned,orphan,unowned],'unlisted-owned'),removed=api().remove(data,'a');
 assert.deepEqual(plain(removed.contracts),[owned]);assert.deepEqual(plain(data.contracts),[orphan,unowned]);assert.equal(data.contracts[0],orphan);assert.equal(data.contracts[1],unowned);assert.equal(data.active,'unrelated-orphan');
});

test('explicit target membership with a stale projectId is removed when there is no other valid owner',()=>{
 const c={id:'stale-owner',projectId:'missing'},data=workspace([{id:'a',contractIds:['stale-owner','missing-file']}],[c]);
 const removed=api().remove(data,'a');assert.equal(data.contracts.length,0);assert.equal(data.active,'');assert.deepEqual(plain(removed.contracts),[c]);assert.deepEqual(plain(removed.project.contractIds),['stale-owner','missing-file']);
});

test('a shared contract with missing or invalid ownership is reassigned to a surviving project',()=>{
 for(const previous of [undefined,'no-longer-present']){
  const c={id:'shared',...(previous?{projectId:previous}:{})},data=workspace([{id:'a',contractIds:['shared']},{id:'b',contractIds:['shared']},{id:'c',contractIds:['shared']}],[c]);
  const removed=api().remove(data,'a');assert.equal(c.projectId,'b');assert.equal(data.contracts[0],c);assert.equal(removed.contracts[0].projectId,previous);assert.equal(data.v2.removedMaterials.length,0);
 }
});

test('a surviving explicit owner is preferred over another surviving referencing project',()=>{
 const c={id:'shared',projectId:'c'},data=workspace([{id:'a',contractIds:['shared']},{id:'b',contractIds:['shared']},{id:'c',contractIds:[]}],[c]);
 api().remove(data,'a');assert.equal(c.projectId,'c');assert.equal(data.active,'shared');
});

test('deleting an empty project preserves all unrelated contracts and the active contract',()=>{
 const other={id:'b',contractIds:['b-file']},c={id:'b-file',projectId:'b'},data=workspace([{id:'empty',contractIds:[]},other],[c]);
 const removed=api().remove(data,'empty');assert.equal(data.v2.projects[0],other);assert.equal(data.contracts[0],c);assert.equal(data.active,'b-file');assert.equal(removed.contracts.length,0);assert.equal(data.v2.removedMaterials.length,0);
});

test('deleting the last project can leave a valid empty workspace and persists a demo dismissal',()=>{
 const data=workspace([{id:'demo',onboardingDemo:true,contractIds:['demo-file']}],[{id:'demo-file',projectId:'demo'}]);api().remove(data,'demo');
 assert.equal(data.v2.projects.length,0);assert.equal(data.contracts.length,0);assert.equal(data.active,'');assert.equal(data.v2.onboardingDemoSeen,true);assert.equal(data.v2.onboardingDemoDismissed,true);
 const reloaded=plain(data);assert.equal(reloaded.v2.removedProjects.length,1);assert.equal(reloaded.v2.onboardingDemoDismissed,true);
});

test('deleting the last ordinary project without a seen marker keeps the workspace explicitly empty',async()=>{
 const data=workspace([{id:'ordinary',name:'演示项目 · 从风险到修改',contractIds:['file']}],[{id:'file',projectId:'ordinary'}]);
 api().remove(data,'ordinary');assert.equal(data.v2.onboardingDemoSeen,true);assert.equal(data.v2.onboardingDemoDismissed,undefined);
 const context=vm.createContext({}),demoSource=await readFile(new URL('../public/real-files/onboarding-demo.js',import.meta.url),'utf8');vm.runInContext(demoSource,context);
 const reloaded=plain(data);assert.equal(context.ContractReviewDemo.add(reloaded,()=>assert.fail('must not recreate the demo'),true),null);assert.equal(reloaded.v2.projects.length,0);assert.equal(reloaded.contracts.length,0);
});

test('fallback active contract prefers a surviving project material over an unrelated orphan',()=>{
 const data=workspace([{id:'a',contractIds:['a-file']},{id:'b',contractIds:['b-file']}],[{id:'orphan'},{id:'a-file',projectId:'a'},{id:'b-file',projectId:'b'}],'a-file');
 api().remove(data,'a');assert.equal(data.active,'b-file');assert.equal(data.contracts[0].id,'orphan');
});

test('missing IDs, invalid state and duplicate project IDs cannot mutate the workspace',()=>{
 const remove=api().remove;
 for(const id of [null,undefined,'','missing',7]){const data=workspace([{id:'a',contractIds:['a-file']}],[{id:'a-file',projectId:'a'}]),before=JSON.stringify(data);assert.equal(remove(data,id),null);assert.equal(JSON.stringify(data),before);}
 for(const data of [null,{}, {v2:{projects:[]}},workspace([{id:'a'},{id:'a'}],[]),{...workspace([{id:'a'}],[]),v2:{projects:[{id:'a'}],removedMaterials:{unrecognized:'keep this'}}}]){const before=JSON.stringify(data);assert.equal(remove(data,'a'),null);assert.equal(JSON.stringify(data),before);}
});

test('duplicate contract IDs do not cause unrelated records with a valid different owner to be deleted',()=>{
 const removedContract={id:'duplicate',projectId:'a',title:'A'},retainedContract={id:'duplicate',projectId:'b',title:'B'},data=workspace([{id:'a',contractIds:['duplicate']},{id:'b',contractIds:[]}],[removedContract,retainedContract],'duplicate');
 api().remove(data,'a');assert.equal(data.contracts.length,1);assert.equal(data.contracts[0],retainedContract);assert.equal(data.active,'duplicate');assert.equal(data.v2.removedMaterials[0].contract.title,'A');
});

test('archives are independent snapshots and repeated deletion does not duplicate recovery records',()=>{
 const c={id:'file',projectId:'a',versions:[{id:'v1'}]},data=workspace([{id:'a',name:'Original',contractIds:['file']}],[c]),remove=api().remove,archive=remove(data,'a');
 c.versions[0].id='later mutation';assert.equal(archive.contracts[0].versions[0].id,'v1');archive.contracts[0].versions[0].id='archive edited';assert.equal(data.v2.removedMaterials[0].contract.versions[0].id,'v1');const before=JSON.stringify(data);assert.equal(remove(data,'a'),null);assert.equal(JSON.stringify(data),before);
});

test('repeated deletes across shared owners preserve the shared file until its final owner is deleted',()=>{
 const c={id:'shared',projectId:'a'},data=workspace([{id:'a',contractIds:['shared']},{id:'b',contractIds:['shared']},{id:'c',contractIds:['shared']}],[c]),remove=api().remove;
 remove(data,'a');assert.equal(c.projectId,'b');remove(data,'b');assert.equal(c.projectId,'c');assert.equal(data.contracts.length,1);remove(data,'c');assert.equal(data.contracts.length,0);assert.equal(data.v2.removedProjects.length,3);assert.equal(data.v2.removedMaterials.length,1);assert.equal(data.active,'');
});
