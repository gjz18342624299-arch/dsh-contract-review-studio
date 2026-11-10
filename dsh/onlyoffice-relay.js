// This trusted page never evaluates editor-supplied code. The official plugin
// bootstrap and its editor-supplied runtime execute only in runtime.html, whose
// response and iframe both apply sandbox allow-scripts without same-origin.
export function pluginRelayPage(editorOrigin, pluginGuid) {
  const editor = new URL(editorOrigin);
  if (!['http:', 'https:'].includes(editor.protocol) || editor.username || editor.password) throw Error('Invalid editor origin');
  const settings = JSON.stringify({editorOrigin: editor.origin, pluginGuid}).replaceAll('<', '\\u003c');
  return `<!doctype html><meta charset="utf-8"><script>
  (function(){
    'use strict';
    const settings=${settings};
    const params=new URLSearchParams(location.search);
    const channel=params.get('channel'),key=params.get('key');
    let mainOrigin=params.get('parentOrigin');
    if(!/^[a-f0-9]{48}$/.test(channel||'')||!key||!mainOrigin)return;
    if(mainOrigin!=='dsh-desktop://harness'){
      try{const url=new URL(mainOrigin);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return;mainOrigin=url.origin;}catch{return;}
    }
    const editorWindow=window.parent,mainWindow=window.parent.parent;
    const runtime=document.createElement('iframe');
    runtime.setAttribute('sandbox','allow-scripts');
    runtime.style.cssText='width:1px;height:1px;border:0;position:absolute;left:-100px';
    runtime.title='Isolated ONLYOFFICE plugin runtime';
    const childUrl=new URL('runtime.html',location.href);
    childUrl.search=location.search;
    childUrl.searchParams.set('relayOrigin',location.origin);
    function scoped(data,source){return data&&typeof data==='object'&&data.source===source&&data.channel===channel&&data.key===key;}
    function sdkMessage(data){
      if(typeof data!=='string')return false;
      try{const value=JSON.parse(data);return value&&typeof value==='object'&&value.guid===settings.pluginGuid&&typeof value.type==='string';}catch{return false;}
    }
    addEventListener('message',function(event){
      const data=event.data;
      if(event.source===runtime.contentWindow&&event.origin==='null'){
        if(scoped(data,'dsh-onlyoffice-plugin')){
          mainWindow.postMessage(data,mainOrigin==='dsh-desktop://harness'?'*':mainOrigin);
        }else if(sdkMessage(data)){
          editorWindow.postMessage(data,settings.editorOrigin);
        }
        return;
      }
      if(event.source===editorWindow&&event.origin===settings.editorOrigin&&sdkMessage(data)){
        runtime.contentWindow.postMessage(data,'*');
        return;
      }
      const mainOriginMatches=event.origin===mainOrigin||(mainOrigin==='dsh-desktop://harness'&&event.origin==='null');
      if(event.source===mainWindow&&mainOriginMatches&&scoped(data,'dsh-onlyoffice-host')){
        runtime.contentWindow.postMessage(data,'*');
      }
    });
    runtime.src=childUrl.href;
    document.documentElement.append(runtime);
    document.documentElement.setAttribute('data-dsh-relay','ready');
  })();
  </script>`;
}

export const pluginRelayCSP = "default-src 'none'; script-src 'unsafe-inline'; frame-src 'self'; style-src 'unsafe-inline'";
export const pluginRuntimeCSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src http: https:; style-src 'unsafe-inline'; img-src data:";
