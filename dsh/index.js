import {registerNativeContext} from './native-context.js';
import {registerOpenSource} from './open-source.js';
import {registerResearch} from './research.js';
import {registerOnlyOffice} from './onlyoffice.js';
import {registerWps} from './wps.js';
import {registerAI} from './runtime.js';
import {createReviewRoute} from './review-call.js';
import {registerDraftJobs} from './draft-jobs.js';
import Schema from '@deepseek-ai/schemastery';
import {readFileSync} from 'node:fs';
export const name='contract-review-studio';
export const inject=['webServer','connection','llm','agentDefaultModel'];
export const Config=Schema.object({});
const htmlPath=new URL('../public/index.html',import.meta.url);
export function apply(ctx){
 for(const file of ["wps-sdk.js","pdf.mjs","pdf.worker.mjs","jszip.min.js","docx-preview.min.js","xlsx.full.min.js","chat-excel-worker.js","SheetJS-LICENSE.txt"])ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/contract-review-studio/real-files/'+file,handler(req,res){const reject=ctx.connection.requestRejection(req);if(reject!==undefined){res.writeHead(reject);return res.end()}if(req.method!=='GET'){res.writeHead(405);return res.end()}res.writeHead(200,{'content-type':file.endsWith('.pdf')?'application/pdf':/\.(mjs|js)$/.test(file)?'text/javascript':'application/octet-stream','cache-control':'no-store'});res.end(readFileSync(new URL('../public/real-files/'+file,import.meta.url)));}}));
 registerResearch(ctx);
 registerNativeContext(ctx);
 registerOpenSource(ctx);
 registerOnlyOffice(ctx);
 registerAI(ctx);
 registerDraftJobs(ctx,createReviewRoute(ctx));
 registerWps(ctx);
 for(const suffix of ['index.html','status'])ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/contract-review-studio/'+suffix,handler(req,res){
 const rejection=typeof ctx.connection?.requestRejection==='function'?ctx.connection.requestRejection(req):503;
 if(rejection!==undefined){res.writeHead(rejection);res.end('请在DSH中打开工作台');return;}
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 res.writeHead(200,{'content-type':suffix==='status'?'application/json;charset=utf-8':'text/html;charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(suffix==='status'?JSON.stringify({ok:true,version:'0.10.0'}):readFileSync(htmlPath));
 }}));
}
