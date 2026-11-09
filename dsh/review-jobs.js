import {readPayload} from './ai.js';
import {mergeBatchResults} from './review-merge.js';
import {REVIEW_LIMITS,planReview,splitTask,taskPayload,abortable,backoff,coverageFor} from './review-plan.js';

export function registerReviewJobs(ctx,reviewRoute,{deadlineMs=REVIEW_LIMITS.deadline,retryBaseMs=500}={}){
 const jobs=new Map(),reply=(d,status=200)=>Response.json(d,{status,headers:{'cache-control':'no-store'}});
 ctx.connection.fetch.register({path:'/api/contract-review-studio/review-start',methods:['POST'],requestBody:'buffered',async fetch(request){
  try{
   const input=await readPayload(request);
   if(input.action==='draft')return reply({error:'改稿请使用直接审查接口。'},400);
   // Keep the full context, but avoid spending one response budget on four
   // potentially long opinions when the Chanyun template has many rules.
   const initialRulesPerBatch=input.action==='review'&&input.modelSelection?.provider==='chanyun'&&input.rules.length>=12?2:REVIEW_LIMITS.rules;
   for(const [id,j] of jobs)if(Date.now()-j.created>3600000){j.controller.abort();jobs.delete(id);}
   if([...jobs.values()].filter(j=>j.state==='running').length>=2)return reply({error:'已有审查任务运行，请稍后再试。'},429);
   const id=crypto.randomUUID();let controller=new AbortController();
   const job={state:'running',created:Date.now(),controller,completed:0,total:0,calls:0,succeeded:0,failed:0,retryRounds:0};jobs.set(id,job);
   const onFailure=()=>{if(job.state==='running'){job.snapshot?.();delete job.snapshot;job.state='failed';job.error='审查任务异常结束，未完成检查不能视为通过。';}};
   const execute=async(seedResults=[],pendingTasks=planReview(input,{rulesPerBatch:initialRulesPerBatch}))=>{
    const queue=pendingTasks,results=[...seedResults],started=Date.now();let cursor=0,stopReason=null;
    job.completed=seedResults.length;job.succeeded=seedResults.filter(e=>e.ok).length;job.failed=0;
    job.total=seedResults.length+queue.length;job.canRetry=false;
    delete job.error;delete job.timedOut;
    const isLargeChanyunReview=input.action==='review'&&input.modelSelection?.provider==='chanyun'&&input.rules.length>=12;
    const useRuleLines=input.reviewFormat==='rule-lines'||(isLargeChanyunReview
     &&input.rules.every(rule=>rule.id?.trim()&&rule.id.length<=200)&&new Set(input.rules.map(rule=>rule.id)).size===input.rules.length);
    const concurrency=isLargeChanyunReview?4:REVIEW_LIMITS.concurrency;
    job.snapshot=()=>{const done=new Set(results.map(e=>e.task.id));const partial=[...results,...queue.filter(t=>!t.superseded&&!done.has(t.id)).map(task=>({ok:false,task,result:{errorCode:'CANCELLED',error:'本检查已取消'}}))];const {merged}=mergeBatchResults(input,partial);merged.coverage=coverageFor(input,partial,{calls:job.calls,reason:'CANCELLED'});merged.warnings.push('审查已取消；仅保留已成功检查，未完成部分不能视为通过。');job.result=merged;job.coverage=merged.coverage;};
    const timer=setTimeout(()=>{job.timedOut=true;stopReason='DEADLINE';controller.abort();},Math.min(deadlineMs,REVIEW_LIMITS.deadline));
    const progress=()=>{job.progress=`${input.action==='review'?'分析与改稿':'生成修改建议'}：已处理 ${job.completed} / ${job.total} 批（成功 ${job.succeeded}，失败 ${job.failed}），调用 ${job.calls} / 200 · 最多 ${concurrency} 批并行`;const completedNow=job.completed-seedResults.length;job.etaSeconds=completedNow?Math.ceil((Date.now()-started)/1000/completedNow*(job.total-job.completed)):null;};progress();
    const failure=(task,code,error)=>({ok:false,task,result:{errorCode:code,error}});
    const invoke=async task=>{
     for(let attempt=0;attempt<3;attempt++){
      if(controller.signal.aborted)return failure(task,job.timedOut?'DEADLINE':'CANCELLED','本次等待已停止');
      if(job.calls>=REVIEW_LIMITS.calls){stopReason='CALL_LIMIT';return failure(task,'CALL_LIMIT','达到200次总调用上限');}
      job.calls++;progress();
      let response,result;
      try{
       const payload=taskPayload(input,task);
       if(useRuleLines&&!task.jsonFallback)payload.reviewFormat='rule-lines';
       if(task.jsonFallback){delete payload.reviewFormat;const compact='\n本次仅检查给定的一条规则；直接返回紧凑 JSON 结果，不输出分析过程。detail、suggestion各不超过80字；没有风险则返回空issues。';payload.instructions=(input.instructions||'')+((input.instructions||'').length+compact.length<=4000?compact:'');}
       response=await abortable(reviewRoute.fetch(new Request('http://local/review',{method:'POST',body:JSON.stringify(payload),signal:controller.signal})),controller.signal);
       try{result=await abortable(response.json(),controller.signal);}catch{result={errorCode:'INVALID_OUTPUT',error:'返回结果不是有效JSON'};}
      }catch{if(controller.signal.aborted)return failure(task,job.timedOut?'DEADLINE':'CANCELLED','本次等待已停止');if(attempt<2){await backoff(Math.min(4000,retryBaseMs*2**attempt),controller.signal);continue;}return failure(task,'NETWORK_ERROR','本批连接中断，已重试3次');}
      if([429,503].includes(response.status)&&attempt<2){await backoff(Math.min(4000,retryBaseMs*2**attempt),controller.signal);continue;}
      if(!response.ok&&[500,502,504].includes(response.status)&&!['OUTPUT_TRUNCATED','INVALID_OUTPUT','UPSTREAM_AUTH','INVALID_REQUEST'].includes(result?.errorCode)&&attempt<2){await backoff(Math.min(4000,retryBaseMs*2**attempt),controller.signal);continue;}
      if([429,503].includes(response.status))result={...result,errorCode:'UPSTREAM_TRANSIENT'};
      else if(!response.ok&&!result?.errorCode)result={...result,errorCode:'UPSTREAM_ERROR'};
      const valid=result&&typeof result==='object'&&!result.errorCode&&(input.action==='review'?Array.isArray(result.issues):Array.isArray(result.patches))
       &&(!useRuleLines||task.jsonFallback||(Array.isArray(result.completedRuleIds)&&result.completedRuleIds.length>0
        &&result.completedRuleIds.every(id=>task.items.some(rule=>rule.id===id))));
      if(valid&&task.jsonFallback&&useRuleLines)result.completedRuleIds=task.items.map(rule=>rule.id);
      return {ok:response.ok&&valid,task,result:valid||result?.errorCode?result:{errorCode:'INVALID_OUTPUT',error:result?.error||'审核结果结构无效'}};
     }
    };
    const worker=async()=>{
     while(cursor<queue.length&&!controller.signal.aborted){
      const task=queue[cursor++];let entry;
      try{entry=await invoke(task);}catch{entry=failure(task,job.timedOut?'DEADLINE':'CANCELLED','本次等待已停止');}
      if(entry.ok&&useRuleLines){
       const completed=new Set(entry.result.completedRuleIds);
       const remaining=task.items.filter(rule=>!completed.has(rule.id));
       if(remaining.length){
        task.superseded=true;
        entry.task={...task,id:task.id+'.0',items:task.items.filter(rule=>completed.has(rule.id)),superseded:false};
        queue.push({...task,id:task.id+'.1',items:remaining,superseded:false});
        job.total++;
       }
      }
      const emptyTruncation=entry.result?.errorCode==='OUTPUT_TRUNCATED'&&entry.result.diagnostics?.outputCharacters===0;
      if(!entry.ok&&['OUTPUT_TRUNCATED','INVALID_OUTPUT'].includes(entry.result?.errorCode)&&!controller.signal.aborted&&job.calls<REVIEW_LIMITS.calls){
       // A rule-lines response can exhaust its reasoning budget without writing
       // even one line. In that case shrinking rule count alone repeats the same
       // long context; shrink the text, retaining overlap and every source character.
       const children=splitTask(task,{preferText:emptyTruncation});if(children.length){
        task.superseded=true;queue.push(...children);job.total+=children.length-1;progress();continue;
       }
       if(input.action==='review'&&task.items.length===1&&!task.jsonFallback){task.superseded=true;queue.push({...task,id:task.id+'.json',superseded:false,jsonFallback:true});progress();continue;}
      }
      results.push(entry);job.completed++;if(entry.ok)job.succeeded++;else job.failed++;progress();
     }
    };
    try{await Promise.all(Array.from({length:concurrency},worker));}finally{clearTimeout(timer);}
    for(;cursor<queue.length;cursor++){results.push(failure(queue[cursor],stopReason||'CANCELLED','本检查未执行'));job.completed++;job.failed++;}
    // Stable tree ordering prevents response timing from choosing conflict winners.
    results.sort((a,b)=>a.task.id.localeCompare(b.task.id,undefined,{numeric:true}));
    const {merged,succeeded}=mergeBatchResults(input,results);
    merged.at=new Date().toISOString();
    merged.coverage=coverageFor(input,results,{calls:job.calls,reason:stopReason||(job.state==='cancelled'?'CANCELLED':null)});
    merged.timing={seconds:Math.round((Date.now()-started)/1000),batches:results.length,calls:job.calls,concurrency};
    if(job.timedOut)merged.warnings.push('本次审查达到20分钟等待上限，已保留成功检查，未完成部分不能视为通过。');
    if(stopReason==='CALL_LIMIT')merged.warnings.push('已达到200次调用上限；保留成功检查，剩余检查未完成。');
    job.result=merged;job.coverage=merged.coverage;delete job.snapshot;progress();
    if(job.state!=='cancelled')job.state=merged.coverage.status==='complete'?'complete':succeeded?'partial':'failed';
    if(!succeeded)job.error='未取得成功审核结果；未完成检查不能视为通过。';
    const failed=results.filter(e=>!e.ok);
    job.canRetry=failed.length>0&&job.calls<REVIEW_LIMITS.calls&&job.retryRounds<3&&failed.some(e=>!['UPSTREAM_AUTH','INVALID_REQUEST'].includes(e.result?.errorCode));
    job.retry=()=>{
     if(!job.canRetry||job.state==='running')return false;
     controller=new AbortController();job.controller=controller;job.state='running';job.retryRounds++;job.canRetry=false;
     // Keep completed checks and their evidence. Only the exact failed rule and
     // source ranges are run again, rather than submitting the whole contract.
     const pending=failed.map(e=>({...e.task,superseded:false}));
     void execute(results.filter(e=>e.ok),pending).catch(onFailure);return true;
    };
   };
   void execute().catch(onFailure);
   return reply({jobId:id},202);
  }catch(e){return reply({error:e.message||'合同审查请求无效'},e.status||400);}
 }});
 ctx.connection.fetch.register({path:'/api/contract-review-studio/review-job',methods:['GET','POST'],requestBody:'buffered',async fetch(request){const j=jobs.get(new URL(request.url).searchParams.get('id'));if(!j)return reply({error:'任务已过期或后台已重启，请重新提交。'},404);if(request.method==='POST'){const raw=await request.text();let command;try{command=raw?JSON.parse(raw):{};}catch{return reply({error:'任务操作格式无效'},400);}if(command.action==='retry'){if(!j.retry?.())return reply({error:'当前没有可补查的失败批次，或已达到重试/调用上限。'},409);}else if(j.state==='running'){j.state='cancelled';j.controller.abort();j.snapshot?.();}}const {controller,snapshot,retry,...publicJob}=j;return reply(publicJob);}});
}

