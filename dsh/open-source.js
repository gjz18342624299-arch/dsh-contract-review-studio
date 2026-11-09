import {execFile} from 'node:child_process';
export function registerOpenSource(ctx){
 ctx.connection.fetch.register({path:'/api/contract-review-studio/open-source',methods:['POST'],requestBody:'buffered',async fetch(request){
  let url;
  try{
   const input=await request.json();
   if(typeof input.url!=='string'||input.url.length>4096)throw Error();
   url=new URL(input.url);
   if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error();
  }catch{return Response.json({error:'原文链接无效'},{status:400});}
  if(process.platform!=='win32')return Response.json({error:'当前桌面环境不支持此打开方式'},{status:501});
  try{
   await new Promise((resolve,reject)=>execFile('rundll32.exe',['url.dll,FileProtocolHandler',url.href],{windowsHide:true,timeout:10000},error=>error?reject(error):resolve()));
   return Response.json({ok:true});
  }catch{return Response.json({error:'无法启动默认浏览器'},{status:502});}
 }});
}
