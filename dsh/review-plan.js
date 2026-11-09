// Shared by general and template review. Offsets are JS string offsets (end exclusive).
export const REVIEW_LIMITS = Object.freeze({rules:4, segment:12000, overlap:300, minSegment:3000, depth:4, calls:200, concurrency:2, deadline:1200000});
export function segmentText(text, size=REVIEW_LIMITS.segment, overlap=REVIEW_LIMITS.overlap, offset=0) {
 const segments=[];
 for(let start=0;start<text.length;){const end=Math.min(text.length,start+size);segments.push({start:offset+start,end:offset+end});if(end===text.length)break;start=end-overlap;}
 return segments;
}
export function planReview(input,{rulesPerBatch=REVIEW_LIMITS.rules}={}){
 const batchSize=Number.isInteger(rulesPerBatch)&&rulesPerBatch>=1&&rulesPerBatch<=REVIEW_LIMITS.rules?rulesPerBatch:REVIEW_LIMITS.rules;
 const items=(input.action==='review'?input.rules:input.issues).filter(i=>input.action==='review'?i.enabled!==false:i.status!=='ignored');
 const segments=segmentText(input.text), tasks=[];
 for(const [index,segment] of segments.entries())for(let i=0;i<items.length;i+=batchSize)tasks.push({id:`s${index}-r${i}`,items:items.slice(i,i+batchSize),...segment,index,total:segments.length,depth:0});
 return tasks;
}
export function splitTask(task,{preferText=false}={}){
 if(task.depth>=REVIEW_LIMITS.depth)return [];
 const child=(extra,n)=>({...task,depth:task.depth+1,...extra,id:`${task.id}.${n}`});
 const length=task.end-task.start;
 if(task.items.length>1&&(!preferText||length<=REVIEW_LIMITS.minSegment)){const mid=Math.ceil(task.items.length/2);return [child({items:task.items.slice(0,mid),depth:task.depth},0),child({items:task.items.slice(mid),depth:task.depth},1)];}
 if(length<=REVIEW_LIMITS.minSegment)return [];
 const size=Math.max(REVIEW_LIMITS.minSegment,Math.ceil((length+REVIEW_LIMITS.overlap)/2));
 // At most two halves, retaining exactly the requested overlap and every character.
 const cut=task.start+size;
 return [child({end:cut},0),child({start:cut-REVIEW_LIMITS.overlap},1)];
}
export function taskPayload(input,task){
 return {...input,text:input.text.slice(task.start,task.end),...(input.action==='review'?{rules:task.items}:{issues:task.items}),reviewScope:task.start===0&&task.end===input.text.length?undefined:{kind:'segment',index:task.index,total:task.total,start:task.start,end:task.end}};
}
export function abortable(promise,signal){
 if(signal.aborted)return Promise.reject(new Error('ABORTED'));
 return new Promise((resolve,reject)=>{const stop=()=>reject(new Error('ABORTED'));signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',stop));});
}
export async function backoff(ms,signal){
 let timer;try{await abortable(new Promise(resolve=>{timer=setTimeout(resolve,ms);}),signal);}finally{clearTimeout(timer);}
}
export function coverageFor(input,entries,{calls=0,reason=null}={}){
 const successful=entries.filter(e=>e.ok),failed=entries.filter(e=>!e.ok),intervals=[];
 for(const e of successful)intervals.push([e.task.start,e.task.end]);intervals.sort((a,b)=>a[0]-b[0]);
 const ranges=[];for(const [a,b] of intervals){const last=ranges.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else ranges.push([a,b]);}
 const segmented=input.text.length>REVIEW_LIMITS.segment||entries.some(e=>e.task.depth>0&&e.task.end-e.task.start<input.text.length);
 return {status:failed.length||reason?'partial':'complete',mode:segmented?'segmented':'local',textLength:input.text.length,checkedCharacters:ranges.reduce((n,[a,b])=>n+b-a,0),ranges:ranges.map(([start,end])=>({start,end})),checksSucceeded:successful.length,checksFailed:failed.length,calls,fullTextRelationsVerified:false,scopeNote:segmented?'已完成仅指所列分段规则检查；全文跨段关联、条款缺失及一致性未核验，请人工核对。':'模型已针对完整输入执行所列规则检查；不代表人工核验、法律依据验证或法律合规结论。',reason,checks:entries.map(e=>({id:e.task.id,start:e.task.start,end:e.task.end,ruleIds:e.task.items.map(i=>i.id||i.title),ruleTitles:e.task.items.map(i=>i.title||i.id),status:e.ok?'complete':'partial',errorCode:e.ok?undefined:e.result?.errorCode,error:e.ok?undefined:String(e.result?.error||'本检查未完成').slice(0,500)}))};
}
