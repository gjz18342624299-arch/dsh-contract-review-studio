import {createHash,randomUUID} from 'node:crypto';
import {readPayload} from './ai.js';
import {abortable} from './review-plan.js';

const EXECUTABLE_OPERATIONS=new Set(['replace','append','formatBold']);
function executableDraft(draft,expected){
 if(!draft||!expected.has(draft.issueId)||draft.executable===false||typeof draft.text!=='string'||!draft.text.trim()||!EXECUTABLE_OPERATIONS.has(draft.operation))return false;
 if(draft.operation==='replace')return typeof draft.original==='string'&&!!draft.original.trim()&&typeof draft.replacement==='string'&&!!draft.replacement.trim()&&draft.original!==draft.replacement;
 if(draft.operation==='formatBold')return typeof draft.formatOriginal==='string'&&!!draft.formatOriginal.trim();
 return true;
}

// The HTTP request only starts a task. Its abort signal must never become the
// model request signal: desktop gateways can close the start request after 30s.
export function registerDraftJobs(ctx,reviewRoute,{maxConcurrent=4,maxStored=32,ttlMs=15*60*1000,timeoutMs=200000,now=()=>Date.now()}={}){
 const jobs=new Map(),requestIds=new Map();
 const reply=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
 const forget=id=>{const job=jobs.get(id);if(job?.requestId)requestIds.delete(job.requestId);jobs.delete(id);};
 const cleanup=()=>{const at=now();for(const [id,job]of jobs)if(job.state!=='running'&&at-(job.finishedAt??job.created)>=ttlMs)forget(id);};
 const publicJob=job=>({jobId:job.id,state:job.state,seconds:Math.max(0,Math.floor(((job.finishedAt??now())-job.created)/1000)),requested:job.requested,prepared:job.prepared,unresolved:job.unresolved,...(job.result?{result:job.result}:{}),...(job.error?{error:job.error,errorCode:job.errorCode}:{}),...(job.httpStatus?{httpStatus:job.httpStatus}:{}),...(job.diagnostics?{diagnostics:job.diagnostics}:{})});
 const run=async(job,input)=>{
  if(job.state!=='running'||job.controller.signal.aborted)return;
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;job.controller.abort();},timeoutMs);
  try{
   const response=await abortable(reviewRoute.fetch(new Request('http://local/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:job.controller.signal})),job.controller.signal);
   const result=await abortable(response.json(),job.controller.signal);
   if(job.state!=='running')return;
   job.httpStatus=response.status;job.diagnostics=result?.diagnostics;
   if(!response.ok){job.state='failed';job.error=String(result?.error||'本次改稿未完成，请重试准备改稿。');job.errorCode=result?.errorCode||'UPSTREAM_ERROR';job.result=result;return;}
   const expected=new Set(input.issues.filter(issue=>issue.status!=='ignored').map(issue=>issue.id));
   const drafts=(Array.isArray(result?.drafts)?result.drafts:[]).filter(draft=>executableDraft(draft,expected));
   const byId=new Map(drafts.map(draft=>[draft.issueId,draft]));
   const unresolvedDrafts=(Array.isArray(result?.unresolvedDrafts)?result.unresolvedDrafts:[]).filter(draft=>expected.has(draft.issueId)&&!byId.has(draft.issueId));
   const reasons=new Map((Array.isArray(result?.unresolvedReasons)?result.unresolvedReasons:[]).filter(reason=>expected.has(reason.issueId)&&!byId.has(reason.issueId)).map(reason=>[reason.issueId,reason]));
   for(const issueId of expected)if(!byId.has(issueId)&&!reasons.has(issueId)){const unresolved=unresolvedDrafts.find(draft=>draft.issueId===issueId);reasons.set(issueId,{issueId,code:'DRAFT_UNRESOLVED',reason:unresolved?.reason||'模型尚未返回该问题的可执行改稿。'});}
   job.prepared=byId.size;job.unresolved=job.requested-job.prepared;
   job.result={...result,drafts:[...byId.values()],unresolvedDrafts,unresolvedReasons:[...reasons.values()]};
   if(!job.prepared){job.state='failed';job.errorCode='DRAFT_UNRESOLVED';job.error='本次未取得可执行改稿：'+[...reasons.values()].map(reason=>reason.reason).join('；');return;}
   job.state=job.unresolved?'partial':'complete';
  }catch(error){
   if(job.state==='cancelled')return;
   job.state='failed';job.errorCode=timedOut?'CALL_TIMEOUT':job.controller.signal.aborted?'CANCELLED':'UPSTREAM_ERROR';
   job.error=timedOut?'本次改稿超过等待上限，请重试准备改稿。':job.controller.signal.aborted?'改稿准备已取消。':'改稿服务连接中断，请重试准备改稿。';
  }finally{clearTimeout(timer);if(job.state!=='running')job.finishedAt=now();}
 };
 ctx.connection.fetch.register({path:'/api/contract-review-studio/draft-start',methods:['POST'],requestBody:'buffered',async fetch(request){
  try{
   const input=await readPayload(request);
   if(input.action!=='draft')return reply({error:'此接口仅用于准备改稿。'},400);
   if(input.text.length>60000)return reply({error:'改稿上下文最多60000字，请缩短范围。'},413);
   cleanup();
   const requestId=request.headers.get('x-draft-request-id')||'';
   if(requestId&&!/^[A-Za-z0-9_-]{1,160}$/.test(requestId))return reply({error:'改稿请求编号无效。'},400);
   const fingerprint=requestId?createHash('sha256').update(JSON.stringify(input)).digest('hex'):null;
   if(requestId&&requestIds.has(requestId)){
    const existing=jobs.get(requestIds.get(requestId));
    if(existing){if(existing.fingerprint!==fingerprint)return reply({error:'该改稿请求编号已用于不同内容，请使用新的请求编号。'},409);return reply({jobId:existing.id,state:existing.state},202);}
    requestIds.delete(requestId);
   }
   if([...jobs.values()].filter(job=>job.state==='running').length>=maxConcurrent)return reply({error:'已有4个改稿任务正在准备，请稍后重试。'},429);
   while(jobs.size>=maxStored){const oldest=[...jobs.values()].filter(job=>job.state!=='running').sort((a,b)=>(a.finishedAt??a.created)-(b.finishedAt??b.created))[0];if(!oldest)return reply({error:'改稿任务容量已满，请稍后重试。'},429);forget(oldest.id);}
   const job={id:randomUUID(),state:'running',created:now(),controller:new AbortController(),requested:input.issues.filter(issue=>issue.status!=='ignored').length,prepared:0,unresolved:input.issues.filter(issue=>issue.status!=='ignored').length,...(requestId?{requestId,fingerprint}:{})};
   jobs.set(job.id,job);if(requestId)requestIds.set(requestId,job.id);
   void Promise.resolve().then(()=>run(job,input));
   return reply({jobId:job.id,state:job.state},202);
  }catch(error){return reply({error:error.message||'改稿请求无效。'},error.status||400);}
 }});
 ctx.connection.fetch.register({path:'/api/contract-review-studio/draft-job',methods:['GET','POST'],requestBody:'buffered',async fetch(request){
  cleanup();const job=jobs.get(new URL(request.url).searchParams.get('id'));
  if(!job)return reply({error:'改稿任务已过期或后台已重启，请重新准备改稿。'},404);
  if(request.method==='POST'&&job.state==='running'){job.state='cancelled';job.finishedAt=now();job.controller.abort();job.error='改稿准备已取消。';job.errorCode='CANCELLED';}
  return reply(publicJob(job));
 }});
}
