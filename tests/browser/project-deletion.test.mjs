import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_MODULE||'playwright-core');
const root=new URL('../../',import.meta.url);
const original=await readFile(new URL('public/index.html',root),'utf8');
const hook=`
openWpsEditor=async function(){const mount=document.querySelector('#wps-mount');if(mount&&!mount.querySelector('iframe'))mount.innerHTML='<iframe title="虚构项目测试 Word" src="about:blank"></iframe>';};
window.__projects={
 get state(){return JSON.parse(JSON.stringify(data));},get activeProject(){return activeProject;},get status(){return storageStatus;},
 async setup(shared=false){
  liveBusy=false;reviewContractId=null;manualRevisionPending=false;savedDraftPreparation=null;
  const make=(id,owner)=>{const c=sample(id,'虚构合同 '+id);Object.assign(c,{projectId:owner,kind:'service',sample:false,annotations:[{index:1,text:'虚构保留批注',time:'测试时间'}],checks:[{ruleId:'test-rule',result:'unable',detail:'虚构核对记录'}],ruleIds:[],templateId:null,onlyOfficeFileId:'synthetic-office-'+id,onlyOfficeKey:'synthetic-key-'+id,originalFile:{id:'synthetic-original-'+id,name:'虚构合同-'+id+'.docx',sha256:'synthetic-hash-'+id,size:4},sourceFile:'synthetic-'+id+'.docx',sourceFilename:'虚构来源-'+id+'.docx',latestCapture:'synthetic-capture-'+id});c.decisions={payment:{status:'accepted',text:'虚构已采纳条款',wpsWritten:true}};c.versions.push({id:'historical-'+id,name:'虚构历史版本',clauses:clone(c.clauses),decisions:clone(c.decisions),captureId:'historical-capture-'+id});return c;};
  const alpha=make('contract-alpha','project-alpha'),beta=make('contract-beta','project-beta');
  const project=(id,name,contractIds)=>({id,name,description:'仅供隔离浏览器测试的虚构项目',contractIds,created:'测试时间',fields:{[contractIds[0]+':partyA']:{value:'虚构人工核对甲方',originalValue:'虚构原始甲方'}},confirmed:{[contractIds[0]+':partyA']:true},fieldCorrections:{[contractIds[0]+':amount']:true},reviewed:true,completed:false});
  const a=project('project-alpha','虚构普通项目甲',[alpha.id]),b=project('project-beta','虚构普通项目乙',[beta.id]);
  const demo=ContractReviewDemo.create(sample);Object.assign(demo.contract,{onboardingWordVersion:2,originalFile:{id:'synthetic-original-demo',name:'虚构演示.docx',sha256:'synthetic-demo-hash',size:4}});
  data={contracts:[alpha,beta,demo.contract],active:beta.id,v2:{projects:[a,b,demo.project],templates:[],rules:[],realSourceVersion:1002,onboardingDemoSeen:true,onboardingDemoDismissed:false,modelSelection:{provider:'synthetic-provider',model:'synthetic-model'},customPreference:'retain me'}};
  if(shared){const contract=make('contract-shared',a.id);data.contracts.push(contract);a.contractIds.push(contract.id);b.contractIds.push(contract.id);data.active=contract.id;}
  for(const contract of data.contracts)await originalStore('readwrite',store=>store.put({id:contract.originalFile.id,name:contract.originalFile.name,bytes:new Uint8Array([80,75,3,4]).buffer}));
  activeProject=b.id;view='projects';await saveDurably();shell();
 },
 async onlyOrdinaryWithoutSeen(){
  const project=data.v2.projects.find(item=>item.id==='project-alpha'),contract=data.contracts.find(item=>item.id==='contract-alpha');
  data.v2.projects=[project];data.contracts=[contract];data.active=contract.id;activeProject=project.id;
  delete data.v2.onboardingDemoSeen;delete data.v2.onboardingDemoDismissed;view='projects';await saveDurably();shell();
 },
 busy(value){liveBusy=value;reviewContractId=value?'contract-beta':null;},
 async readOriginal(id){const record=await originalStore('readonly',store=>store.get(id));return record?{id:record.id,name:record.name,bytes:[...new Uint8Array(record.bytes)]}:null;}
};
`;
const anchor="view='projects';await saveDurably();shell();";
assert.ok(original.includes(anchor),'application initialization hook remains available');
const html=original.replace(anchor,hook+anchor);

test('every project supports safe local deletion with complete archives and persistence',async t=>{
 const apiRequests=[],errors=[],checks=[];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);return;}
  if(url.pathname.includes('/real-files/')){
   const name=url.pathname.split('/').at(-1);
   if(/^[a-z0-9.-]+$/i.test(name))try{const bytes=await readFile(new URL('public/real-files/'+name,root));res.writeHead(200,{'content-type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'application/octet-stream'});res.end(bytes);return;}catch{}
  }
  apiRequests.push({method:req.method,path:url.pathname});
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ready:false,groups:[],connections:[],error:'synthetic browser fixture has no real service'}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const pageFor=async()=>{
  const context=await browser.newContext({viewport:{width:1550,height:1000}}),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);await page.waitForFunction(()=>window.__projects);return {page,context};
 };
 const snapshot=page=>page.evaluate(()=>({data:__projects.state,activeProject:__projects.activeProject}));
 const confirmDeletion=async(page,id)=>{
  await page.locator('[data-project-delete="'+id+'"]').click();await page.locator('#confirm-remove-project').click();
  await page.waitForFunction(target=>!__projects.state.v2.projects.some(project=>project.id===target),id);
  await page.waitForFunction(()=>__projects.status==='saved');
 };
 try{
  await t.test('ordinary and demo projects share the same UI; cancellation and deletion preserve other work',async()=>{
   const {page,context}=await pageFor();try{
    await page.evaluate(()=>__projects.setup());
    assert.deepEqual(await page.locator('[data-project-delete]').evaluateAll(buttons=>buttons.map(button=>button.dataset.projectDelete).sort()),['onboarding-demo-project-v1','project-alpha','project-beta']);
    assert.deepEqual(await page.locator('[data-project-delete]').allTextContents(),['删除项目','删除项目','删除项目']);
    assert.equal(await page.locator('[data-demo-delete-project]').count(),0,'demo uses the same deletion control as ordinary projects');
    const before=await snapshot(page),alpha=before.data.v2.projects.find(p=>p.id==='project-alpha'),alphaContract=before.data.contracts.find(c=>c.id==='contract-alpha');
    await page.locator('[data-project-delete="project-alpha"]').click();await page.locator('#confirm-remove-project').waitFor();
    assert.deepEqual(await snapshot(page),before,'opening confirmation does not change project data');
    await page.locator('.modal-foot [data-action="close"],.modal-foot [data-v2="close"]').first().click();
    assert.deepEqual(await snapshot(page),before,'cancelling leaves the complete workspace unchanged');
    await confirmDeletion(page,'project-alpha');
    const after=await snapshot(page),archive=after.data.v2.removedProjects.find(record=>record.project.id===alpha.id);
    assert.deepEqual(archive.project,alpha);assert.deepEqual(archive.contracts,[alphaContract]);assert.ok(!Number.isNaN(Date.parse(archive.removedAt)));
    assert.deepEqual(archive.removedContractIds,['contract-alpha']);assert.deepEqual(archive.retainedContractIds,[]);
    assert.deepEqual(after.data.v2.removedMaterials.find(record=>record.contract.id==='contract-alpha').contract,alphaContract,'material archive preserves body, risks, decisions, versions and Word identities');
    for(const id of ['project-beta','onboarding-demo-project-v1'])assert.deepEqual(after.data.v2.projects.find(p=>p.id===id),before.data.v2.projects.find(p=>p.id===id));
    for(const id of ['contract-beta','onboarding-demo-contract-v1'])assert.deepEqual(after.data.contracts.find(c=>c.id===id),before.data.contracts.find(c=>c.id===id));
    assert.equal(after.data.active,before.data.active);assert.equal(after.activeProject,before.activeProject);assert.equal(after.data.v2.customPreference,'retain me');
    assert.deepEqual(await page.evaluate(id=>__projects.readOriginal(id),alphaContract.originalFile.id),{id:alphaContract.originalFile.id,name:alphaContract.originalFile.name,bytes:[80,75,3,4]},'deletion retains original IndexedDB file bytes');
    checks.push('uniform ordinary/demo controls, cancel, complete archive, other work and original bytes preserved');

    await page.locator('[data-v2="open-project"][data-id="project-beta"]').click();
    assert.equal(await page.locator('.v2-head [data-project-delete="project-beta"]').count(),1,'project materials page also exposes deletion');
    await confirmDeletion(page,'project-beta');
    assert.deepEqual((await snapshot(page)).data.v2.projects.map(p=>p.id),['onboarding-demo-project-v1']);
    await confirmDeletion(page,'onboarding-demo-project-v1');
    const empty=await snapshot(page);assert.deepEqual(empty.data.v2.projects,[]);assert.deepEqual(empty.data.contracts,[]);assert.equal(empty.data.active,'');
    assert.equal(empty.data.v2.removedProjects.length,3);assert.equal(empty.data.v2.removedMaterials.length,3);assert.equal(empty.data.v2.onboardingDemoDismissed,true);
    await page.reload();await page.waitForFunction(()=>window.__projects&&document.querySelector('.v2-page'));
    const restored=await snapshot(page);assert.deepEqual(restored.data.v2.projects,[]);assert.deepEqual(restored.data.contracts,[]);assert.equal(restored.data.v2.removedProjects.length,3);assert.equal(await page.locator('[data-project-delete]').count(),0);
    checks.push('materials-page deletion and last-project persistence without demo resurrection');
   }finally{await context.close();}
  });
  await t.test('shared contracts stay live with a valid owner and a deletion-time archive snapshot',async()=>{
   const {page,context}=await pageFor();try{
    await page.evaluate(()=>__projects.setup(true));const before=await snapshot(page),shared=before.data.contracts.find(c=>c.id==='contract-shared');
    await confirmDeletion(page,'project-alpha');const after=await snapshot(page),retained=after.data.contracts.find(c=>c.id===shared.id),archive=after.data.v2.removedProjects.find(record=>record.project.id==='project-alpha');
    assert.deepEqual(retained,{...shared,projectId:'project-beta'},'shared record is retained and re-owned by its remaining project');
    assert.ok(after.data.v2.projects.some(project=>project.id===retained.projectId&&project.contractIds.includes(retained.id)));
    assert.equal(after.data.active,shared.id);assert.equal(after.activeProject,before.activeProject);
    assert.deepEqual(archive.contracts.find(c=>c.id===shared.id),shared,'archive retains the original owner and full deletion-time data');
    assert.ok(archive.retainedContractIds.includes(shared.id));assert.ok(!archive.removedContractIds.includes(shared.id));
    assert.ok(!after.data.v2.removedMaterials.some(record=>record.contract.id===shared.id),'retained shared material is not marked removed');
    assert.deepEqual(after.data.v2.projects.find(project=>project.id==='project-beta'),before.data.v2.projects.find(project=>project.id==='project-beta'));
    assert.ok(await page.evaluate(id=>__projects.readOriginal(id),shared.originalFile.id));checks.push('shared contract owner, active selection and complete pre-deletion snapshot retained');
   }finally{await context.close();}
  });
  await t.test('deleting the last ordinary project also keeps an unseen demo from reappearing on refresh',async()=>{
   const {page,context}=await pageFor();try{
    await page.evaluate(async()=>{await __projects.setup();await __projects.onlyOrdinaryWithoutSeen();});
    assert.deepEqual((await snapshot(page)).data.v2.projects.map(project=>project.id),['project-alpha']);
    await confirmDeletion(page,'project-alpha');assert.equal((await snapshot(page)).data.v2.onboardingDemoSeen,true);
    await page.reload();await page.waitForFunction(()=>window.__projects&&document.querySelector('.v2-page'));
    const restored=await snapshot(page);assert.deepEqual(restored.data.v2.projects,[]);assert.deepEqual(restored.data.contracts,[]);assert.equal(restored.data.v2.removedProjects.length,1);
    checks.push('last ordinary project remains deleted even without prior onboarding flags');
   }finally{await context.close();}
  });
  await t.test('an active review blocks deletion both before opening and before confirming',async()=>{
   const {page,context}=await pageFor();try{
    await page.evaluate(()=>__projects.setup());const before=await snapshot(page);
    await page.evaluate(()=>__projects.busy(true));await page.locator('[data-project-delete="project-alpha"]').click();
    assert.equal(await page.locator('#confirm-remove-project').count(),0);assert.deepEqual(await snapshot(page),before);
    await page.evaluate(()=>__projects.busy(false));await page.locator('[data-project-delete="project-alpha"]').click();await page.locator('#confirm-remove-project').waitFor();
    await page.evaluate(()=>__projects.busy(true));await page.locator('#confirm-remove-project').click();assert.deepEqual(await snapshot(page),before,'review started while the dialog was open still prevents deletion');
    await page.evaluate(()=>__projects.busy(false));await page.locator('.modal-foot [data-action="close"],.modal-foot [data-v2="close"]').first().click();checks.push('live review prevents opening or confirming deletion');
   }finally{await context.close();}
  });
  assert.deepEqual(errors,[]);assert.equal(apiRequests.some(request=>/\/(?:review|summary|draft)-(?:start|job)$|\/onlyoffice\/(?:session|start)$/.test(request.path)),false,'deletion never contacts a model or opens remote Word sessions');
  await writeFile(new URL('project-deletion-results.json',import.meta.url),JSON.stringify({passed:true,checks,pageErrors:errors,apiRequests},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
