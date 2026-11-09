// Deterministic merge: keep evidence even when automatic edits cannot safely merge.
export function mergeBatchResults(input, results) {
 const merged={issues:[],patches:[],warnings:[],legalVerified:false},ranges=[];
 let succeeded=0,appended=false;
 // Iterate by batch index, not completion order, so parallel timing cannot change winners.
 for(let batch=0;batch<results.length;batch++){
  const entry=results[batch];
  if(!entry?.ok){merged.warnings.push(`第${batch+1}批未完成：${entry?.result?.error||'未执行'}`);continue;}
  succeeded++;const result=entry.result;
  Object.assign(merged,{provider:result.provider,model:result.model,at:result.at});
  for(const warning of result.warnings||[])merged.warnings.push(`第${batch+1}批：${warning}`);
  const issueIds=new Map();
  if(input.action==='review')for(const [n,issue] of (result.issues||[]).entries()){
   const id=`batch-${batch}-${n}`;
   // Do not deduplicate by title/quote: distinct rules can produce identical headings.
   // Every issue and its evidence survives even when its automatic patch conflicts.
   const scope=entry.task?{kind:'segment',index:entry.task.index,total:entry.task.total,start:entry.task.start,end:entry.task.end}:undefined;
    const partialScope=scope&&(scope.start!==0||scope.end!==input.text.length);
    // Missing evidence in a local excerpt never proves absence in the contract.
    const localOnly=partialScope&&!issue.quote;
    merged.issues.push({...issue,id,...(scope?{reviewScope:scope}:{}),...(localOnly?{title:`[局部待核对] ${issue.title}`,detail:`仅此文本片段未发现相关约定；不能据此判断全文缺失。原局部分析：${issue.detail}`,suggestion:`请先人工核对全文其他段落。${issue.suggestion}`,fullTextAbsenceVerified:false}:{} )});
   if(!issueIds.has(issue.id))issueIds.set(issue.id,id);else issueIds.set(issue.id,null);
  }
  for(const [n,patch] of (result.patches||[]).entries()){
   const issueId=input.action==='review'?issueIds.get(patch.issueId):patch.issueId;
   const warn=reason=>merged.warnings.push(`第${batch+1}批第${n+1}项修改未自动合并：${reason}；请人工核对，审核问题已保留。`);
   if(!issueId||(input.action==='revise'&&!input.issues.some(i=>i.id===issueId&&i.status!=='ignored'))){warn('问题标识无效或不唯一');continue;}
   if(typeof patch.original!=='string'||typeof patch.replacement!=='string'||patch.original===patch.replacement){warn('修改内容无效');continue;}
   // The UI uses find(issueId), so multiple alternatives for one issue are ambiguous.
   if(merged.patches.some(p=>p.issueId===issueId)){warn('同一问题已有修改建议');continue;}
   if(!patch.original){if(entry.task&&(entry.task.start!==0||entry.task.end!==input.text.length)){warn('局部缺失不能证明全文缺失，不自动追加条款');continue;}if(appended){warn('已有追加条款');continue;}appended=true;}
   else {
    const start=input.text.indexOf(patch.original),end=start+patch.original.length;
    if(start<0||input.text.indexOf(patch.original,start+1)!==-1){warn('原文无法唯一定位');continue;}
    if(ranges.some(([a,b])=>start<b&&end>a)){warn('与已保留修改范围重叠');continue;}
    ranges.push([start,end]);
   }
   merged.patches.push({...patch,id:`batch-${batch}-patch-${n}`,issueId,status:'pending'});
  }
 }
 return {merged,succeeded};
}
