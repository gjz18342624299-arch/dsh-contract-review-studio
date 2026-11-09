import {BlockAssembler,createUserMessage} from '@deepseek-ai/dsh-llm';
import {readPayload,buildPrompt,normalizeOutput,normalizeRuleLines,ReviewError} from './ai.js';
import {resolveRoute} from './models.js';
import {modelFailure} from './model-failure.js';
export function createReviewRoute(ctx){return {path:'/api/contract-review-studio/review',methods:['POST'],requestBody:'buffered',async fetch(request){
 const controller=new AbortController();let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},180000),started=Date.now();const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});
 const diagnostics={model:null,inputCharacters:0,rules:0,outputCharacters:0,finishReason:null,maxTokens:8192};
 try{
  if(request.signal.aborted)controller.abort();
  const data=await readPayload(request);if(data.text.length>60000)throw new ReviewError(data.action==='draft'?'改稿请求的合同上下文最多60000字，请缩短范围。':'单次模型调用最多60000字，请通过自动分段审查入口提交。',413);
  const route=await resolveRoute(ctx,data.modelSelection);diagnostics.model=route.provider+'/'+route.model;diagnostics.inputCharacters=data.text.length;diagnostics.rules=data.rules.length;
  let info;try{info=await ctx.llm.resolveModelInfo?.(route.provider,route.model,controller.signal);}catch{}
  const supported=(info?.reasoning?.efforts||[]).map(effort=>effort.id);
  const effort=['off','low'].find(level=>supported.includes(level));
  const options=effort?{reasoningEffort:effort}:{};
  diagnostics.reasoningEffort=effort||'provider-default';
  // Respect declared output limits. Never blindly increase an unknown provider's limit.
  const cap=Number(info?.maxOutputTokens||info?.defaultMaxTokens);diagnostics.maxTokens=Number.isFinite(cap)&&cap>0?Math.max(1,Math.min(16384,cap)):8192;
  const prompt=buildPrompt(data),assembler=new BlockAssembler();let finished=false;
  for await(const chunk of ctx.llm.stream({...route,purpose:'contract-review-studio',...options,maxTokens:diagnostics.maxTokens,system:prompt.system,messages:[createUserMessage({content:[{type:'text',text:prompt.text}],source:{kind:'contract-review-studio'}})],signal:controller.signal})){
   if(controller.signal.aborted)throw Error('ABORTED');if(finished)continue;assembler.push(chunk);
   if(chunk.type==='finish'){const reason=chunk.reason;diagnostics.finishReason=reason?.kind||'unknown';diagnostics.outputCharacters=assembler.blocks().filter(b=>b.type==='text').map(b=>b.text).join('').length;
    const truncated=['max-tokens','length'].includes(reason?.kind);
    finished=reason?.kind==='stop'||((data.reviewFormat==='rule-lines'||data.action==='draft')&&truncated);if(!finished){const failure=String(reason?.failure?.message||'');const code=truncated?'OUTPUT_TRUNCATED':/429|503|rate.limit|overload/i.test(failure)?'UPSTREAM_TRANSIENT':/401|403|unauthor|api.?key/i.test(failure)?'UPSTREAM_AUTH':'UPSTREAM_ERROR';throw new ReviewError(modelFailure(reason),code==='UPSTREAM_TRANSIENT'?503:502,code);}}
  }
  if(!finished)throw new ReviewError('模型连接提前结束，未取得完整结果。',502,'INVALID_OUTPUT');
  const raw=assembler.blocks().filter(b=>b.type==='text').map(b=>b.text).join('');diagnostics.outputCharacters=raw.length;
  const result=data.reviewFormat==='rule-lines'?normalizeRuleLines(raw,data):normalizeOutput(raw,data);
  if(data.reviewFormat==='rule-lines'&&!result.completedRuleIds.length){
   const truncated=['max-tokens','length'].includes(diagnostics.finishReason);
   throw new ReviewError(truncated?'模型输出被截断，未取得完整检查结果。':'模型未返回有效的逐规则检查结果。',502,truncated?'OUTPUT_TRUNCATED':'INVALID_OUTPUT');
  }
  if(data.action==='draft'&&!result.drafts.length){
   diagnostics.seconds=Math.round((Date.now()-started)/100)/10;
   diagnostics.errorCode='DRAFT_UNRESOLVED';
   // A completed model response with no validated operation is a retryable
   // draft result, not an executable draft. Preserve per-issue reasons so the
   // background draft job can retry only these issues with a smaller batch.
   return Response.json({...result,draftStatus:'unresolved',errorCode:'DRAFT_UNRESOLVED',error:'本批尚未取得可执行改稿，请按具体原因重试未完成问题。',provider:route.provider,model:route.model,at:new Date().toISOString(),legalVerified:false,diagnostics},{headers:{'cache-control':'no-store'}});
  }
  diagnostics.seconds=Math.round((Date.now()-started)/100)/10;
  return Response.json({...result,provider:route.provider,model:route.model,at:new Date().toISOString(),legalVerified:false,diagnostics},{headers:{'cache-control':'no-store'}});
 }catch(e){diagnostics.seconds=Math.round((Date.now()-started)/100)/10;const errorCode=controller.signal.aborted?(timedOut?'CALL_TIMEOUT':'CANCELLED'):e instanceof ReviewError?e.code:'UPSTREAM_ERROR';
  // Only operational metrics, no contract text, model content, endpoints or credentials.
  ctx.logger?.warn?.('contract-review-call '+JSON.stringify({...diagnostics,errorCode}));
  return Response.json({error:controller.signal.aborted?(timedOut?'本批模型调用超过3分钟，已停止等待，可重试本批。':'审查调用已取消，本检查未完成。'):e instanceof ReviewError?e.message:'模型连接异常，本检查未完成。',errorCode,diagnostics},{status:timedOut?504:e instanceof ReviewError?e.status:502});
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
 }};}
