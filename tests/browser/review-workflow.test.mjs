import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_MODULE||'playwright-core');
const root=new URL('../../',import.meta.url);
const original=await readFile(new URL('public/index.html',root),'utf8');
const hook=`
openWpsEditor=async function(){const m=document.querySelector('#wps-mount');if(m&&!m.querySelector('iframe'))m.innerHTML='<iframe title="测试 Word 编辑器" src="about:blank"></iframe>';};
window.__workflow={
 get data(){return data},get current(){return current()},get running(){return liveBusy},start:(project=false)=>doRun(project),
 setup(){const demo=data.contracts[0],c=sample('workflow-contract','虚构合同流程测试');Object.assign(c,{kind:'service',onboardingDemo:false,projectId:'workflow-project',risks:[],checks:[],ruleIds:[],templateId:null,reviewContextConfirmed:true,reviewMode:'general',partyA:'示例甲方',partyB:'示例乙方'});data.contracts=[c];data.active=c.id;data.v2.projects=[{id:'workflow-project',name:'虚构流程测试',contractIds:[c.id],fields:{},confirmed:{},created:'测试',reviewed:false,completed:false}];activeProject='workflow-project';currentDocumentSnapshot=async()=>({text:c.clauses.map(x=>x.text).join('\\n\\n'),source:'original'});durableVersion=async()=>({id:'test-version',name:'测试版本',time:now(),clauses:clone(c.clauses)});automaticLegalMaterials=async()=>({materials:[],warnings:[]});view='elements';shell();},
 elements(){view='elements';shell()},review(){openDoc(data.active)},summary(){panel='summary';renderPanel()}
};`;
const html=original.replace("view='projects';await saveDurably();shell();",hook+"view='projects';await saveDurably();shell();");
test('element confirmation, asynchronous review states, resizable pane and editor preservation',async()=>{
 let requests=0,mode='success';
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const json=data=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/')return res.end(html);
  if(url.pathname.endsWith('/onlyoffice/status'))return json({ready:false});
  if(url.pathname.endsWith('/review-start')){requests++;return json({jobId:'workflow-job'});}
  if(url.pathname.endsWith('/review-job'))return json(mode==='failed'?{state:'failed',error:'模拟模型连接失败',canRetry:false}:{state:'complete',result:{issues:[],patches:[],provider:'test',model:'mock-model',at:new Date().toISOString(),coverage:{status:'complete',checksSucceeded:1,checksFailed:0}}});
  if(url.pathname.endsWith('/research'))return json({connections:[]});
  if(url.pathname.endsWith('/summary-start'))return json({jobId:'summary-job'});
  if(url.pathname.endsWith('/summary-job'))return json({state:'complete',result:{answer:'虚构摘要测试',model:'mock'}});
  if(url.pathname.includes('/real-files/')){
   try{const name=url.pathname.split('/').at(-1);const data=await readFile(new URL('public/real-files/'+name,root));res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'application/octet-stream'});return res.end(data);}catch{}
  }
  res.writeHead(404);res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context=await browser.newContext({viewport:{width:1550,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(origin);await page.waitForFunction(()=>window.__workflow);
  await page.evaluate(()=>window.__workflow.setup());
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),true);
  await page.evaluate(()=>window.__workflow.start());assert.equal(requests,0,'direct start cannot skip element confirmation');
  await page.locator('[data-field-review-cell]').first().locator('[data-v2="field"]').click();
  assert.match(await page.locator('.modal-head h2').textContent(),/核对提取值/);
  assert.equal(await page.locator('#v2-field-value').inputValue(),'示例甲方','source dialog uses the contract ID and field key separately');
  await page.locator('.modal-head [data-action="close"],.modal-head [data-v2="close"]').first().click();
  await page.locator('[data-field-review-cell]').first().locator('[data-field-review="yes"]').click();
  assert.match(await page.locator('[data-field-review-count]').textContent(),/1 \/ 5/);
  await page.locator('[data-field-review-cell]').first().locator('[data-field-review="yes"]').click();
  assert.match(await page.locator('[data-field-review-count]').textContent(),/0 \/ 5/,'clicking an already confirmed field cancels its confirmation');
  await page.locator('[data-field-review-cell]').first().locator('[data-field-review="yes"]').click();
  await page.locator('[data-field-review-cell]').nth(1).locator('[data-field-review="no"]').click();
  await page.locator('[data-field-review-all]').click();
  assert.equal(await page.locator('[data-field-review-cell][data-key="number"] input').inputValue(),'');
  assert.match(await page.locator('[data-field-review-cell][data-key="number"] .field-review-state').textContent(),/已核对 · 原文未载明/,'bulk confirmation explicitly covers an absent optional reference');
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),true,'bulk confirmation preserves an explicit correction request');
  const valuesBeforeCancel=await page.locator('[data-field-review-cell] input').evaluateAll(inputs=>inputs.map(input=>input.value));
  await page.locator('[data-field-review-clear]').click();
  assert.match(await page.locator('[data-field-review-count]').textContent(),/0 \/ 5/);
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),true,'cancel all restores the requirement to confirm before reviewing');
  assert.deepEqual(await page.locator('[data-field-review-cell] input').evaluateAll(inputs=>inputs.map(input=>input.value)),valuesBeforeCancel,'cancel all preserves entered values');
  assert.equal(await page.locator('[data-field-review-cell]').nth(1).locator('[data-field-review="no"]').getAttribute('aria-pressed'),'true','cancel all preserves explicit correction flags');
  assert.equal(await page.locator('p.field-review-state').count(),0,'duplicate visible confirmation lines are removed');
  const statusSize=await page.locator('.field-review-state').first().evaluate(element=>({width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}));
  assert.deepEqual(statusSize,{width:1,height:1},'screen-reader status does not occupy a visual row');
  await page.locator('[data-field-review-all]').click();
  const edit=page.locator('[data-field-review-cell]').nth(1).locator('input');
  await edit.fill('更正后的示例乙方');await edit.press('Tab');
  await page.locator('[data-field-review-cell]').nth(1).locator('[data-field-review="yes"]').click();
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),false);
  const first=page.locator('[data-field-review-cell]').first().locator('input');await first.fill('更正后的示例甲方');
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),true,'editing a confirmed value immediately invalidates confirmation');
  assert.equal(await page.locator('[data-field-review-all]').isDisabled(),false,'editing a confirmed value also re-enables bulk confirmation');
  await first.press('Tab');await page.locator('[data-field-review-cell]').first().locator('[data-field-review="yes"]').click();
  const sourceCell=page.locator('[data-field-review-cell]').first();
  await sourceCell.locator('[data-field-review="no"]').click();await sourceCell.locator('[data-v2="field"]').click();
  await page.locator('#v2-field-value').fill('原文核对后的示例甲方');await page.locator('[data-v2="save-field"]').click();
  assert.equal(await sourceCell.locator('[data-field-review="no"]').getAttribute('aria-pressed'),'false','saving and confirming in the source dialog resolves its correction flag');
  assert.equal(await sourceCell.locator('[data-field-review="yes"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.evaluate(()=>window.__workflow.data.v2.projects[0].fieldOriginalValues['workflow-contract:partyA']),'示例甲方','editing and source-dialog confirmation preserve the original extracted value');
  assert.match(await sourceCell.locator('small').textContent(),/原提取值 示例甲方/);
  assert.equal(await page.locator('[data-field-review-all]').isDisabled(),true,'fully confirmed table offers cancellation instead of repeating bulk confirmation');
  const editedValue=await sourceCell.locator('input').inputValue();await page.locator('[data-field-review-clear]').click();
  assert.equal(await sourceCell.locator('input').inputValue(),editedValue,'cancel all also preserves manually corrected values');
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),true);
  await page.locator('[data-field-review-all]').click();
  await page.locator('[data-field-review-start]').click();
  await page.waitForFunction(()=>window.__workflow.running);
  await page.waitForSelector('.review-task-spinner');
  assert.equal(await page.locator('.risk-list [data-v2="run-current"]').count(),0,'running review has no duplicate start action');
  await page.waitForFunction(()=>!window.__workflow.running);
  assert.equal(requests,1);assert.match(await page.locator('.risk-list').textContent(),/本轮审查已完成/);
  await page.evaluate(()=>{const frame=document.querySelector('#wps-mount iframe');window.__editorIdentity=frame;frame.contentWindow.__documentIdentity='unsaved-synthetic-change';});
  const divider=page.locator('.review-divider');await divider.waitFor();
  const before=Number(await divider.getAttribute('aria-valuenow'));
  const box=await divider.boundingBox();await page.mouse.move(box.x+5,box.y+80);await page.mouse.down();await page.mouse.move(box.x-120,box.y+80,{steps:8});await page.mouse.up();
  assert.ok(Number(await divider.getAttribute('aria-valuenow'))>before+80,'drag over an iframe changes pane width');
  await page.locator('.review-pane-toggle').click();assert.equal(await page.locator('.panel').isVisible(),false);
  await page.locator('.review-pane-restore').click();assert.equal(await page.locator('.panel').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.querySelector('#wps-mount iframe')===window.__editorIdentity&&window.__editorIdentity.contentWindow.__documentIdentity==='unsaved-synthetic-change'),true,'resize and collapse preserve the live editor instance');
  await divider.focus();const width=Number(await divider.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowRight');assert.equal(Number(await divider.getAttribute('aria-valuenow')),width-20);
  await page.locator('.review-pane-toggle').click();
  await page.setViewportSize({width:720,height:1000});
  assert.equal(await page.locator('.panel').isVisible(),true,'compact risk view stays usable even when desktop preference was collapsed');
  assert.equal(await page.locator('.review-pane-toggle').isVisible(),false,'compact layout uses its existing document and risk switch');
  assert.equal(await page.locator('.review-divider').isVisible(),false);
  await page.locator('.mobile-switch [data-action="mobile"][data-tab="doc"]').click();
  assert.equal(await page.locator('.document-side').isVisible(),true);assert.equal(await page.locator('.panel').isVisible(),false);
  await page.locator('.mobile-switch [data-action="mobile"][data-tab="risk"]').click();assert.equal(await page.locator('.panel').isVisible(),true);
  assert.equal(await page.evaluate(()=>document.querySelector('#wps-mount iframe')===window.__editorIdentity&&window.__editorIdentity.contentWindow.__documentIdentity==='unsaved-synthetic-change'),true,'compact pane switching also preserves the live editor');
  await page.setViewportSize({width:1550,height:1000});
  await page.locator('.review-pane-restore').click();assert.equal(await page.locator('.panel').isVisible(),true);
  mode='failed';await page.locator('.risk-list [data-v2="run-current"]').click();await page.waitForFunction(()=>window.__workflow.running);await page.waitForFunction(()=>!window.__workflow.running);
  assert.match(await page.locator('.risk-list').textContent(),/本次审查未完成/);assert.match(await page.locator('.risk-list').textContent(),/模拟模型连接失败/);
  await page.locator('[data-v2="close"],[data-action="close"]').first().click();
  await page.evaluate(()=>window.__workflow.summary());assert.match(await page.locator('#clarity-summary').textContent(),/生成摘要/);
  assert.equal(requests,2,'summary tab does not start a review');
  await page.evaluate(()=>{
   __workflow.setup();const second=JSON.parse(JSON.stringify(__workflow.current));second.id='workflow-contract-2';second.title='同项目第二份虚构合同';
   __workflow.data.contracts.push(second);__workflow.data.v2.projects[0].contractIds.push(second.id);__workflow.elements();
  });
  for(let i=0;i<5;i++)await page.locator('[data-field-review-cell][data-contract="workflow-contract"] [data-field-review="yes"]').nth(i).click();
  assert.equal(await page.locator('[data-field-review-start]').isDisabled(),false,'current contract can be ready while another contract is unconfirmed');
  await page.evaluate(()=>window.__workflow.start(true));
  assert.equal(requests,2,'project review cannot bypass unconfirmed fields on another contract');
  assert.equal(await page.locator('[data-field-review-cell][data-contract="workflow-contract-2"] [data-field-review="yes"][aria-pressed="true"]').count(),0);
  await page.evaluate(()=>window.__workflow.elements());await page.screenshot({path:fileURLToPath(new URL('review-flow-elements.png',import.meta.url)),fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
