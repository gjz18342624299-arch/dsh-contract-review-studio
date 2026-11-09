import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const MAX=30*1024*1024;
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y)};
export function wpsConfig(env=process.env){
 const appId=env.CONTRACT_WPS_APP_ID||'',secret=env.CONTRACT_WPS_APP_SECRET||'',base=env.CONTRACT_WPS_PUBLIC_URL||'',sdk=env.CONTRACT_WPS_SDK_URL||'';
 const missing=[];if(!appId)missing.push('WPS AppID');if(!secret)missing.push('WPS AppSecret');
 for(const [label,value] of [['公网HTTPS回调地址',base],['官方SDK HTTPS地址',sdk]]){try{if(new URL(value).protocol!=='https:')throw Error()}catch{missing.push(label)}}
 return {appId,secret,base:base.replace(/\/$/,''),sdk,missing,ready:!missing.length};
}
export function verifyWps(headers,uri,body,cfg,now=Date.now()){
 if(!cfg.ready)return false;const date=headers.date||'',stamp=Date.parse(date.replace(/ CST$/,' +0800'));if(!Number.isFinite(stamp)||Math.abs(now-stamp)>300000)return false;
 const md5=createHash('md5').update(body.length?body:uri).digest('hex');if(!equal(md5,headers['content-md5']))return false;
 const sig=createHash('sha1').update(cfg.secret+md5+(headers['content-type']||'')+date).digest('hex');
 return equal(headers.authorization,`WPS-2:${cfg.appId}:${sig}`)&&headers['x-app-id']===cfg.appId;
}
export function signToken(cfg,claims){const p=Buffer.from(JSON.stringify({...claims,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return p+'.'+createHmac('sha256',cfg.secret).update(p).digest('base64url')}
export function readToken(cfg,token){const [p,s,...extra]=(token||'').split('.');if(extra.length||!p||!s||!equal(s,createHmac('sha256',cfg.secret).update(p).digest('base64url')))throw Error('凭证无效');const c=JSON.parse(Buffer.from(p,'base64url'));if(c.exp<=Date.now()/1000)throw Error('凭证过期');return c}
export async function createWpsStore(directory){
 const root=resolve(directory);await mkdir(root,{recursive:true});const queues=new Map();
 const valid=id=>{if(!/^[a-zA-Z0-9][a-zA-Z0-9_]{0,46}$/.test(id))throw Error('文件ID无效');return id};
 const read=id=>readFile(join(root,valid(id)+'.json'),'utf8').then(JSON.parse);
 const atomic=async(path,bytes)=>{const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,path)};
 async function serial(id,fn){const prior=queues.get(id)||Promise.resolve();const next=prior.catch(()=>{}).then(fn);queues.set(id,next);try{return await next}finally{if(queues.get(id)===next)queues.delete(id)}}
 return {read,async create(name,bytes){if(!/\.docx$/i.test(name)||bytes.length>MAX||bytes.length<4||bytes[0]!==80||bytes[1]!==75)throw Error('请使用30MB以内DOCX文件');const id='f'+randomUUID().replaceAll('-',''),time=Math.floor(Date.now()/1000);const meta={id,name:name.replace(/[\\/|":*?<>]/g,'_').slice(0,240),version:1,size:bytes.length,create_time:time,modify_time:time,creator_id:'local_owner',modifier_id:'local_owner'};await atomic(join(root,id+'_1.docx'),bytes);await atomic(join(root,id+'.json'),JSON.stringify(meta));return meta},
 async bytes(id,version){valid(id);if(!Number.isInteger(version)||version<1)throw Error('版本无效');return readFile(join(root,id+'_'+version+'.docx'))},
 async commit(id,baseVersion,bytes,digest){return serial(id,async()=>{const m=await read(id);if(m.version!==baseVersion)throw Error('版本冲突，请重新打开文档');if(bytes.length>MAX||bytes[0]!==80||bytes[1]!==75)throw Error('文件格式无效');if(!digest||!equal(createHash('sha256').update(bytes).digest('hex'),digest.sha256))throw Error('文件摘要不匹配');const next={...m,version:m.version+1,size:bytes.length,modify_time:Math.floor(Date.now()/1000)};await atomic(join(root,id+'_'+next.version+'.docx'),bytes);await atomic(join(root,id+'.json'),JSON.stringify(next));return next})}};
}
export function registerWps(ctx){
 const cfg=wpsConfig();let storePromise;
 const store=()=>storePromise??=createWpsStore(join(process.env.DSH_HOME||join(process.env.APPDATA||'.','dsh-desktop/harness'),'contract-review-studio','wps-files'));
 const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json;charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data))};
 const body=async req=>{let n=0;const chunks=[];for await(const c of req){n+=c.length;if(n>MAX)throw Error('文件超过30MB');chunks.push(c)}return Buffer.concat(chunks)};
 const staged=new Map();
 for(const endpoint of ['status','session'])ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/contract-review-studio/wps/'+endpoint,async handler(req,res){try{
 const reject=ctx.connection.requestRejection(req);if(reject!==undefined)return reply(res,reject,{error:'请在DSH内打开'});
 const path=new URL(req.url,'http://local').pathname;
 if(path.endsWith('/status')&&req.method==='GET')return reply(res,200,{ready:cfg.ready,missing:cfg.missing});
 if(!cfg.ready)return reply(res,409,{error:'WPS尚未配置',missing:cfg.missing});
 if(path.endsWith('/session')&&req.method==='POST'){
 const input=JSON.parse((await body(req)).toString());let m;
 if(input.fileId)m=await(await store()).read(input.fileId);else m=await(await store()).create(String(input.name||''),Buffer.from(input.base64||'','base64'));
 return reply(res,200,{appId:cfg.appId,fileId:m.id,version:m.version,token:signToken(cfg,{fileId:m.id,scope:'editor'}),sdkUrl:cfg.sdk});}
 return reply(res,404,{error:'接口不存在'});
 }catch{return reply(res,400,{error:'WPS文件操作失败，请检查文件或后端配置'})}}}));
 ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/contract-wps',async handler(req,res){try{
 if(!cfg.ready)return reply(res,503,{code:503,message:'WPS未配置'});
 const url=new URL(req.url,'http://local'),parts=url.pathname.split('/').filter(Boolean);
 // Signed download/upload URLs are scoped to a file, version and operation.
 if(parts[1]==='blob'){
 const token=readToken(cfg,url.searchParams.get('ticket')),id=parts[2];if(token.fileId!==id)throw Error('文件不匹配');
 if(req.method==='GET'&&token.scope==='download'){const bytes=await(await store()).bytes(id,token.version);res.writeHead(200,{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','cache-control':'no-store'});return res.end(bytes)}
 if(req.method==='PUT'&&token.scope==='upload'){const stage=staged.get(token.uploadId);if(!stage||stage.fileId!==id||stage.expires<Date.now())throw Error('上传过期');const bytes=await body(req);if(bytes.length!==stage.request.size||createHash('sha256').update(bytes).digest('hex')!==stage.request.digest.sha256)throw Error('摘要不匹配');stage.bytes=bytes;return reply(res,200,{ok:true})}throw Error('权限不足');}
 const raw=await body(req);if(!verifyWps(req.headers,req.url,raw,cfg))return reply(res,401,{code:401,message:'签名校验失败'});
 const claims=readToken(cfg,req.headers['x-weboffice-token']);if(claims.scope!=='editor')throw Error('权限不足');
 const relative=url.pathname.slice('/contract-wps'.length),match=/^\/v3\/3rd\/files\/([a-zA-Z0-9_]+)(.*)$/.exec(relative);
 if(relative==='/v3/3rd/users'&&req.method==='GET')return reply(res,200,{code:0,data:url.searchParams.getAll('user_ids').filter(id=>id==='local_owner').map(id=>({id,name:'本地工作台用户'}))});
 if(!match)return reply(res,404,{code:404,message:'接口不存在'});
 const [,id,suffix]=match;if(claims.fileId!==id)throw Error('文件不匹配');const db=await store(),m=await db.read(id);let data;
 if(req.method==='GET'&&suffix==='')data=m;
 else if(req.method==='GET'&&suffix==='/permission')data={user_id:'local_owner',read:1,update:1,download:1,copy:1,print:1,comment:1,rename:0,history:0};
 else if(req.method==='GET'&&suffix==='/download')data={url:cfg.base+'/contract-wps/blob/'+id+'?ticket='+signToken(cfg,{scope:'download',fileId:id,version:m.version})};
 else if(req.method==='GET'&&suffix==='/upload/prepare')data={digest_types:['sha256']};
 else if(req.method==='POST'&&suffix==='/upload/address'){
 for(const [key,value] of staged)if(value.expires<Date.now())staged.delete(key);
 if(staged.size>=20)throw Error('保存队列繁忙');const request=JSON.parse(raw);if(!Number.isInteger(request.size)||request.size<4||request.size>MAX||!/^[a-f0-9]{64}$/.test(request.digest?.sha256||''))throw Error('上传参数无效');
 const uploadId=randomUUID();staged.set(uploadId,{fileId:id,baseVersion:m.version,request,expires:Date.now()+600000});data={method:'PUT',url:cfg.base+'/contract-wps/blob/'+id+'?ticket='+signToken(cfg,{scope:'upload',fileId:id,uploadId}),send_back_params:{uploadId}};
 }else if(req.method==='POST'&&suffix==='/upload/complete'){
 const input=JSON.parse(raw),key=input.send_back_params?.uploadId,s=staged.get(key);if(!s||s.fileId!==id||s.expires<Date.now()||!s.bytes||input.response?.status_code!==200)throw Error('上传未完成');data=await db.commit(id,s.baseVersion,s.bytes,s.request.digest);staged.delete(key);
 }else return reply(res,404,{code:404,message:'接口未开放'});
 reply(res,200,{code:0,data});
 }catch{return reply(res,400,{code:400,message:'回调凭证、文件或保存状态无效'})}}}));
}
