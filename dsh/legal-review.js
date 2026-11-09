import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {mcpRequest} from './research.js';

const SEARCH_SIZE=5;
const MAX_ISSUES=100;
const clean=value=>String(value??'').trim();

function materialItems(value){
 if(Array.isArray(value))return value;
 if(!value||typeof value!=='object')return null;
 const list=value.items||value.results||value.result||value.data;
 if(Array.isArray(list))return list;
 if(list&&typeof list==='object')return materialItems(list);
 return value.title||value.law_title||value.lawTitle?[value]:null;
}

export function normalizeLegalMaterials(result,source,tool,at=new Date().toISOString(),limit=SEARCH_SIZE){
 if(result?.isError)throw Error('法律检索服务返回错误，未取得有效依据');
 let items=materialItems(result?.structuredContent);
 if(!items){
  items=[];
  for(const block of result?.content||[]){
   if(block.type!=='text')continue;
   try{const parsed=materialItems(JSON.parse(block.text));if(parsed)items.push(...parsed);}catch{}
  }
  if(!items.length)throw Error('检索返回未识别为法规条目，请手动核对');
 }
 const unique=new Map();
 for(const item of items){
  if(!item||typeof (item.article||item.content||item.article_content)!=='string')continue;
  const body=clean(item.article||item.content||item.article_content);if(!body)continue;
  let url='';
  try{const parsed=new URL(item.url||(typeof item.citation==='string'?item.citation:item.citation?.url));if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)url=parsed.href;}catch{}
  const title=clean(item.title||item.heading||item.lawTitle||item.law_title||'法律检索材料').slice(0,300);
  const article=clean(item.article_label||item.articleNumber||item.article_number).slice(0,120);
  // Query result positions are not identities: the same law may be the first
  // item in one query and the fifth in another.
  const id='law-'+createHash('sha256').update(JSON.stringify([title,article,body.replace(/\s+/g,' '),url.split('?')[0]])).digest('hex').slice(0,24);
  if(unique.has(id))continue;
  unique.set(id,{id,title,article,content:body.slice(0,3500),truncated:body.length>3500,url,
   timeliness:clean(item.timeliness||item.validityStatusText||'未提供').slice(0,100),source,tool,at,legalVerified:false});
  if(unique.size>=Math.max(1,Math.min(20,limit)))break;
 }
 return [...unique.values()];
}

async function researchConfig(serviceId){
 const root=process.env.DSH_HOME||join(process.env.APPDATA||'.','dsh-desktop/harness');
 let connections;try{connections=JSON.parse(await readFile(join(root,'contract-review-studio','research-connections.json'),'utf8'));}catch{throw Error('检索服务配置不可用');}
 const config=connections.find(item=>item.id===serviceId);if(!config)throw Error('请选择已配置的法律检索服务');return config;
}

export function legalSearchTool(catalog){
 const tools=catalog?.tools||[];
 return ['search_law_articles','search_article','search_law_article','search_law','search_laws'].map(name=>tools.find(tool=>tool.name===name)).find(Boolean)
  ||tools.find(tool=>tool.annotations?.readOnlyHint===true&&['query_text','text','query','question'].some(key=>tool.inputSchema?.properties?.[key]));
}

export function legalSearchArguments(tool,query){
 const fields=tool.inputSchema?.properties||{};
 const key=['query_text','text','question','query'].find(name=>fields[name]);
 if(!key)throw Error('该检索工具没有可识别的查询字段，请使用手动检索');
 const args={[key]:query};
 if(fields.output_format)args.output_format='json';
 if(fields.size)args.size=SEARCH_SIZE;
 if(fields.timeliness)args.timeliness='现行有效';
 if((tool.inputSchema?.required||[]).some(name=>!(name in args)))throw Error('该检索工具需要额外必填条件，请使用手动检索');
 return args;
}

async function createLegalSearcher(serviceId,signal){
 const transport=(url,options)=>fetch(url,{...options,...(signal?{signal:AbortSignal.any([signal,options.signal].filter(Boolean))}:{})});
 const config=await researchConfig(serviceId);
 const catalog=await mcpRequest(config,'tools/list',{},transport);
 const tool=legalSearchTool(catalog);if(!tool)throw Error('服务未提供可安全自动调用的只读法规检索工具');
 return async query=>{
  const args=legalSearchArguments(tool,query);
  const result=await mcpRequest(config,'tools/call',{name:tool.name,arguments:args},transport);
  const materials=normalizeLegalMaterials(result,config.name,tool.name);
  return {materials,warnings:materials.some(item=>item.timeliness!=='现行有效')?['部分材料未标明现行有效，请人工核对效力和适用时间']:[],source:config.name,tool:tool.name};
 };
}

export async function legalSearch(serviceId,query){
 const search=await createLegalSearcher(serviceId),result=await search(clean(query).slice(0,2000));
 if(!result.materials.length)throw Error('没有检索到可供分析的法律材料');
 return result;
}

export function issueLegalQuery(issue,contractType=''){
 const title=clean(issue.title||issue.name).slice(0,200);
 const reason=clean(issue.detail||issue.why||issue.requirement).slice(0,400);
 return [clean(contractType).slice(0,100),title,reason].filter(Boolean).join('；').slice(0,700);
}

export function legalSearchCircuitError(failure){
 const message=clean(failure?.message||failure||'检索失败'),code=String(failure?.code||'');
 if(code==='900001'||/\b900001\b|积分不足|额度(?:已)?(?:耗尽|用尽|不足)|insufficient[_ -]quota|quota (?:exhausted|depleted)/i.test(message))return {error:message,errorCode:'PROVIDER_QUOTA_EXHAUSTED',...(code==='900001'||/\b900001\b/.test(message)?{providerCode:'900001'}:{})};
 if(code==='900002'||/\b900002\b|HTTP\s*(?:401|403)\b|unauthori[sz]ed|invalid[ _-]?(?:access[ _-]?)?token|token.*(?:invalid|expired)|授权(?:失效|失败|无效)/i.test(message))return {error:message,errorCode:'PROVIDER_AUTH_REJECTED',...(code==='900002'||/\b900002\b/.test(message)?{providerCode:'900002'}:{})};
 return null;
}

export async function searchLegalIssues(issues,{contractType='',search,signal,concurrency=2,onProgress,initialCircuit=null}={}){
 if(!Array.isArray(issues)||issues.length>MAX_ISSUES||issues.some(issue=>!issue||typeof issue.id!=='string'||!issue.id||issue.id.length>200||!clean(issue.title||issue.name)))throw Error('风险点检索请求无效（最多100项，每项需要编号和标题）');
 if(new Set(issues.map(issue=>issue.id)).size!==issues.length)throw Error('风险点编号重复');
 const groups=new Map();
 for(const issue of issues){
  const query=issueLegalQuery(issue,contractType),key=query.replace(/[\s\p{P}]+/gu,'').toLowerCase();
  if(!groups.has(key))groups.set(key,{query,issues:[]});groups.get(key).issues.push(issue);
 }
 const tasks=[...groups.values()],materials=new Map(),issueSearches=Object.create(null),warnings=[];let cursor=0,completed=0,queryCount=0,skippedQueryCount=0,circuit=initialCircuit;
 const abort=()=>{if(signal?.aborted)throw signal.reason||new DOMException('检索已取消','AbortError');};
 await Promise.all(Array.from({length:Math.min(Math.max(1,concurrency),tasks.length)},async()=>{
  while(cursor<tasks.length){
   abort();const task=tasks[cursor++];let result,status='complete',error,errorCode,providerCode,submitted=false;
   // The circuit is shared by both workers. Requests already in flight may
   // finish, but the next queued risk must not consume more depleted quota.
   if(circuit){
    status='skipped';error='已停止自动检索，未提交本风险点查询：'+circuit.error;
    errorCode=circuit.errorCode;providerCode=circuit.providerCode;result={materials:[],warnings:[]};skippedQueryCount++;
   }else{
    submitted=true;queryCount++;
    try{result=await search(task.query);abort();if(!result.materials?.length)status='empty';}
    catch(failure){
     abort();status='failed';error=failure.message||'检索失败';result={materials:[],warnings:[]};
     const fatal=legalSearchCircuitError(failure);
     if(fatal){circuit??=fatal;errorCode=fatal.errorCode;providerCode=fatal.providerCode;}
    }
   }
   const ids=[];
   for(const material of result.materials||[]){materials.set(material.id,material);ids.push(material.id);}
   for(const issue of task.issues){
    issueSearches[issue.id]={issueId:issue.id,title:issue.title||issue.name,query:task.query,state:status,submitted,materialIds:[...new Set(ids)],source:result.source,tool:result.tool,at:new Date().toISOString(),...(error?{error}:{}),...(errorCode?{errorCode}:{}),...(providerCode?{providerCode}:{})};
   }
   warnings.push(...(result.warnings||[]));if(error&&submitted)warnings.push('“'+task.issues[0].title+'”检索失败：'+error);
   completed++;onProgress?.({completed,total:tasks.length,queryCount,skippedQueryCount,...(circuit?{stoppedReason:circuit.error}:{})});
  }
 }));
 if(circuit)warnings.push(circuit.error+'；已停止后续自动查询，'+skippedQueryCount+' 个风险查询未提交。');
 return {materials:[...materials.values()],issueSearches,warnings:[...new Set(warnings)],queryCount,plannedQueryCount:tasks.length,skippedQueryCount,
  complete:Object.values(issueSearches).every(item=>item.state==='complete'),scope:'per-issue',...(circuit?{circuitBreaker:{open:true,...circuit}}:{})};
}

export async function legalSearchForIssues(serviceId,issues,options={}){
 if(!Array.isArray(issues))throw Error('风险点检索请求无效');
 if(!issues.length)return {materials:[],issueSearches:{},warnings:[],queryCount:0,complete:true,scope:'per-issue'};
 let search;
 try{search=await createLegalSearcher(serviceId,options.signal);}
 catch(failure){
  const circuit=legalSearchCircuitError(failure);if(!circuit)throw failure;
  return searchLegalIssues(issues,{...options,initialCircuit:circuit,search:async()=>{throw failure;}});
 }
 return searchLegalIssues(issues,{...options,search});
}

export function normalizeRecommendations(raw,templates){let d;try{d=JSON.parse(raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'));}catch{throw Error('模型没有返回有效模板推荐');}if(!d||!Array.isArray(d.recommendations)||d.recommendations.length>3)throw Error('模板推荐格式无效');return {recommendations:d.recommendations.map(r=>{const t=templates.find(t=>t.id===r?.templateId);if(!t||!Array.isArray(r.ruleIds)||r.ruleIds.length>500||r.ruleIds.some(id=>!t.rules.some(x=>x.id===id)))throw Error('模型推荐了不存在的模板或检查项');return {templateId:t.id,ruleIds:[...new Set(r.ruleIds)],reason:String(r.reason||'').slice(0,200),confidence:['high','medium','low'].includes(r.confidence)?r.confidence:'low'};}),questions:Array.isArray(d.questions)?d.questions.filter(x=>typeof x==='string').slice(0,3).map(x=>x.slice(0,100)):[]};}
