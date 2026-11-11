window.__ModuleLoader__.load({id:'dsh-contract-review-studio',factory(require){
 const React=require('react'),h=React.createElement;
 const origin=window.location.origin;
 function apply(ctx){
  const service=ctx.get('desktopWorkbenches');
  const native=typeof service.ensureSession==='function'&&typeof service.ownsSession==='function';
  let pending=false;
  function Panel({conversation}){
   const [chatTitle,setChatTitle]=React.useState('');
   const sessionInfo=React.useRef(null);
   const [creatingChat,setCreatingChat]=React.useState(false),[chatError,setChatError]=React.useState('');
   const [chatMode,setChatMode]=React.useState(null),[bounds,setBounds]=React.useState(null);
   const [state,setState]=React.useState('正在连接工作台…'),frame=React.useRef(null);
   React.useEffect(()=>{
    let alive=true;
    fetch('/api/contract-review-studio/status').then(r=>{if(!r.ok)throw Error();if(alive)setState('ready');}).catch(()=>{if(alive)setState('工作台后台尚未加载，请重启 Harness。');});
    async function receive(event){
     const child=frame.current?.contentWindow;
     if(!child||event.source!==child||event.origin!==origin||event.data?.type!=='contract-native-chat')return;
     const {requestId,context}=event.data;
     const reply=error=>child.postMessage({type:'contract-native-chat-result',requestId,error},origin);
     if(!native||pending||!service.isActive?.()){reply('当前无法打开 DSH 原生会话');return;}
     if(!context||typeof context.key!=='string'||typeof context.title!=='string'||JSON.stringify(context).length>100000){reply('工作台上下文无效或过长');return;}
     if(!frame.current?.contentDocument?.querySelector('meta[name="contract-native-layout"][content="2"]')){reply('当前工作台页面还是旧版，请重启 Harness 后重新打开。');return;}
     pending=true;
     try{
      const key='contract-review:native-session:v2:'+context.key;
      const response=await fetch('/api/contract-review-studio/native-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(context)});
      if(response.status===404)throw Error('DSH 后台尚未加载新版会话接口，请从应用菜单重启 Harness。');
      const prepared=await response.json().catch(()=>null);
      if(!response.ok||typeof prepared?.folder!=='string')throw Error(prepared?.error||'无法准备会话资料');
      let saved;try{saved=JSON.parse(localStorage.getItem(key)||'null');}catch{}
      const reuse=saved?.folder===prepared.folder&&service.ownsSession(saved.id);
      const folder=prepared.folder;
      if(!service.isActive())throw Error('工作台已切换');
      const id=await service.ensureSession({folder,...(reuse?{sessionId:saved.id}:{})});
      if(!service.ownsSession(id)||service.currentSession()!==id)throw Error('DSH 未打开目标会话');
      localStorage.setItem(key,JSON.stringify({id,folder}));
      sessionInfo.current={key,folder,id,context};setChatError('');
      setChatTitle(context.project||context.title);
      setChatMode(context.key==='template'?'template':'review');
      reply();
     }catch(error){reply(error.message||'打开原生会话失败');}
     finally{pending=false;}
    }
    window.addEventListener('message',receive);
    return()=>{alive=false;window.removeEventListener('message',receive);};
   },[]);
   React.useEffect(()=>{
    if(!chatMode){setBounds(null);return;}
    function align(){
     const iframe=frame.current;
     const slot=iframe?.contentDocument?.querySelector('[data-native-chat-slot="'+chatMode+'"]');
     const rect=slot?.getBoundingClientRect();
     const next=rect?.width&&rect.height?{left:rect.left,top:rect.top,width:rect.width,height:rect.height}:null;
     setBounds(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
    }
    align();const timer=setInterval(align,120);
    return()=>clearInterval(timer);
   },[chatMode]);
   function closeChat(){
    frame.current?.contentWindow?.postMessage({type:'contract-native-chat-close',mode:chatMode},origin);
    setChatMode(null);
   }
   async function newChat(){
    const info=sessionInfo.current;if(!info||pending||creatingChat)return;
    pending=true;setCreatingChat(true);setChatError('');
    try{
     if(!service.isActive())throw Error('工作台已切换，请重新打开对话');
     const response=await fetch('/api/contract-review-studio/native-context',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(info.context)});
     if(!response.ok)throw Error('准备新对话资料失败，请重试');
     const prepared=await response.json();if(typeof prepared.folder!=='string')throw Error('新对话资料无效');
     const id=await service.ensureSession({folder:prepared.folder});
     if(id===info.id)throw Error('宿主未创建独立对话，请更新后重试');
     if(!service.ownsSession(id)||service.currentSession()!==id)throw Error('新对话未成功打开');
     sessionInfo.current={...info,id,folder:prepared.folder};
     localStorage.setItem(info.key,JSON.stringify({id,folder:prepared.folder}));
    }catch(error){setChatError(error.message||'创建新对话失败');}
    finally{pending=false;setCreatingChat(false);}
   }
   if(state!=='ready')return h('section',{role:'status',style:{padding:32}},state);
   return h('div',{style:{position:'relative',display:'flex',flex:1,minHeight:0,minWidth:0,width:'100%',overflow:'hidden'}},
    h('iframe',{key:'workbench',ref:frame,title:'合同审查工作台',src:'/api/contract-review-studio/index.html',sandbox:'allow-scripts allow-same-origin allow-downloads',style:{flex:1,minWidth:0,height:'100%',border:0,display:'block'}}),
    chatMode&&conversation?h('aside',{
     key:'conversation','aria-label':'DSH 原生会话',style:{
      position:'absolute',display:bounds?'flex':'none',...bounds,flexDirection:'column',
      boxSizing:'border-box',padding:'12px',gap:'10px',overflow:'hidden',
      background:'var(--dsw-alias-bg-layer-2, #f4f7fa)'
     }
    },
     h('header',{style:{
      display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',
      padding:'12px 14px',border:'1px solid #dbe4ed',borderRadius:'10px',
      background:'var(--dsw-alias-bg-layer-1, #fff)'
     }},
      h('div',{style:{minWidth:0}},
       h('strong',{style:{fontSize:'14px'}},chatMode==='template'?'AI 模板助手':'合同对话'),
       h('div',{title:chatTitle,style:{marginTop:'4px',fontSize:'12px',opacity:.72,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}},
        chatMode==='template'?'整理企业审查要求':chatTitle)),
      h('button',{type:'button',onClick:newChat,disabled:creatingChat,'aria-label':'新建 AI 对话',title:'开启独立对话，保留原有聊天和已保存模板',style:{marginLeft:'auto',flexShrink:0,padding:'5px 10px',border:'1px solid #dbe4ed',borderRadius:'6px',background:'transparent',color:'inherit',cursor:'pointer'}},creatingChat?'正在新建…':'＋ 新对话'),
      h('button',{type:'button',onClick:closeChat,'aria-label':'关闭 AI 对话',style:{
       flexShrink:0,padding:'5px 10px',border:'1px solid #dbe4ed',borderRadius:'6px',
       background:'transparent',color:'inherit',cursor:'pointer',fontSize:'12px'
      }},'关闭')),
     chatError?h('div',{role:'alert',style:{fontSize:'12px',color:'#a32323'}},chatError):null,
     chatMode==='template'?h('div',{role:'note',style:{padding:'12px 14px',borderRadius:'10px',background:'var(--dsw-alias-bg-layer-1, #fff)',fontSize:'12px',lineHeight:1.8}},h('strong',null,'直接告诉 AI，你希望怎么审合同'),h('div',null,'可以描述要求、粘贴审查清单，或说明要调整的模板和审查点。AI 会先展示模板并询问是否保存；你回复“保存”后，会新建模板到工作台。'),h('div',{style:{marginTop:'6px',opacity:.8}},'例如：“帮我创建采购合同模板，我方是买方；付款前必须验收，预付款不超过30%。”'),h('div',{style:{marginTop:'4px',opacity:.8}},'修改时可以说：“把付款和验收拆成两条，并将验收设为高风险。”')):null,
     h('div',{style:{
      display:'flex',flexDirection:'column',flex:1,minHeight:0,minWidth:0,overflow:'hidden',
      border:'1px solid #dbe4ed',borderRadius:'10px',background:'var(--dsw-alias-bg-layer-1, #fff)'
     }},conversation)):null);
  }
  ctx.effect(()=>service.register({repository:'https://github.com/gjz18342624299-arch/dsh-contract-review-studio',title:'合同审查工作台 · 本地方案版',description:'合同审查、风险处理和版本比较',version:'0.10.5',customFrame:true,...(native?{embedded:true,layout:{businessSide:'right',businessWidth:0.7}}:{})},Panel));
 }
 return {apply,inject:['desktopWorkbenches']};
}});
