import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_CORE_MODULE||'playwright-core');
const root=new URL('../../',import.meta.url);
let html=await readFile(new URL('public/index.html',root),'utf8');
const layoutCSS=await readFile(new URL('public/real-files/review-layout.css',root),'utf8');
html=html.replace(/<style id="review-layout-style">[\s\S]*?<\/style>/,()=>'<style id="review-layout-style">'+layoutCSS+'</style>');
const hook=`
openWpsEditor=async function(){const m=document.querySelector('#wps-mount');if(m&&!m.querySelector('iframe'))m.innerHTML='<iframe title="虚构标签布局验证编辑器" src="about:blank"></iframe>';};
window.__reviewTabs={setup(){const c=sample('tabs-contract','虚构标签布局测试');Object.assign(c,{onboardingDemo:false,kind:'service',projectId:'tabs-project',checks:[],annotations:[],ruleIds:[],templateId:null});data.contracts=[c];data.active=c.id;data.v2.projects=[{id:'tabs-project',name:'虚构布局项目',contractIds:[c.id],fields:{},confirmed:{},created:'测试'}];activeProject='tabs-project';openDoc(c.id);}};
`;
html=html.replace("view='projects';await saveDurably();shell();",hook+"view='projects';await saveDurably();shell();");
test('three review tabs share equal widths while the collapse control keeps its own fixed column',async()=>{
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);return;}
  if(url.pathname.includes('/real-files/')){
   const name=url.pathname.split('/').at(-1);if(/^[a-z0-9.-]+$/i.test(name))try{const data=await readFile(new URL('public/real-files/'+name,root));res.writeHead(200,{'content-type':name.endsWith('.css')?'text/css':'text/javascript'});res.end(data);return;}catch{}
  }
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({groups:[],connections:[],ready:false}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1700,height:1000}}),errors=[],measurements=[];
 page.on('pageerror',error=>errors.push(error.message));
 const metrics=()=>page.evaluate(()=>{
  const tabs=document.querySelector('.panel-tabs'),buttons=[...tabs.querySelectorAll('.panel-tab')],toggle=tabs.querySelector('.review-pane-toggle'),rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
  return {panel:rect(document.querySelector('.panel')),bar:rect(tabs),tabs:buttons.map(rect),toggle:rect(toggle),toggleVisible:getComputedStyle(toggle).display!=='none'};
 });
 const equalTabs=async(label,toggleVisible=true)=>{
  const state=await metrics();measurements.push({label,...state});
  assert.equal(state.tabs.length,3);assert.ok(Math.max(...state.tabs.map(t=>t.width))-Math.min(...state.tabs.map(t=>t.width))<.1,label+': three tabs are equal');
  assert.equal(state.toggleVisible,toggleVisible);
  for(let i=1;i<3;i++)assert.ok(state.tabs[i-1].right<=state.tabs[i].left,label+': tabs do not overlap');
  if(toggleVisible){assert.equal(state.toggle.width,28,label+': collapse control has a fixed 28px column');assert.ok(state.tabs[2].right<=state.toggle.left,label+': third tab stays separate from collapse control');assert.ok(state.toggle.right<=state.bar.right,label+': toggle remains inside header');}
  assert.equal(await page.evaluate(()=>document.querySelector('#wps-mount iframe')===window.__tabsEditor&&window.__tabsEditor.contentWindow.__unsaved==='synthetic edit'),true,label+': editor remains mounted');
 };
 try{
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__reviewTabs);await page.evaluate(()=>__reviewTabs.setup());
  await page.locator('.review-divider').waitFor();await page.waitForSelector('#wps-mount iframe');
  await page.evaluate(()=>{window.__tabsEditor=document.querySelector('#wps-mount iframe');window.__tabsEditor.contentWindow.__unsaved='synthetic edit';});
  await equalTabs('default width');
  const divider=page.locator('.review-divider');await divider.focus();await page.keyboard.press('Home');await equalTabs('narrow review pane');
  await divider.focus();await page.keyboard.press('End');await equalTabs('wide review pane');
  await page.locator('.panel-tab[data-id="summary"]').click();await equalTabs('summary selected');
  await page.locator('.panel-tab[data-id="risks"]').click();await equalTabs('risks selected');
  await page.locator('.review-pane-toggle').click();assert.equal(await page.locator('.panel').isVisible(),false);await page.locator('.review-pane-restore').click();await equalTabs('after collapse and restore');
  await page.setViewportSize({width:720,height:1000});await equalTabs('compact view',false);
  await page.screenshot({path:fileURLToPath(new URL('review-tabs-compact.png',import.meta.url))});
  await page.setViewportSize({width:1700,height:1000});await divider.focus();await page.keyboard.press('Home');await page.screenshot({path:fileURLToPath(new URL('review-tabs-narrow.png',import.meta.url))});
  assert.deepEqual(errors,[]);await writeFile(new URL('review-tabs-results.json',import.meta.url),JSON.stringify({passed:true,measurements,pageErrors:errors},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
