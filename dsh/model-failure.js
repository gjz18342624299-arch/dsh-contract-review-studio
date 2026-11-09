// Return useful classes, never upstream response bodies, URLs or credentials.
export function modelFailure(reason){
 const message=String(reason?.failure?.message||''),code=String(reason?.failure?.code||''),status=message.match(/(?:HTTP|status|statusCode|code)[\s:="']*(\d{3})/i)?.[1]||message.match(/\b(400|401|403|404|408|413|422|429|500|502|503|504)\b/)?.[1];
 let hint=/quota|credit|balance|积分|余额/i.test(message)?'账号额度不足':/401|403|unauthor|authenticat|api.?key/i.test(message)?'模型服务授权失败':/context|too.long|too.large/i.test(message)?'输入超过模型上下文限制':/max.?tokens|token.*limit/i.test(message)?'模型输出参数超过服务限制':/model.*(not.found|invalid|unknown)|unknown.*model/i.test(message)?'模型名称或路由不被服务支持':/reasoning|thinking|unsupported.*param/i.test(message)?'模型推理参数不兼容':/rate.limit|429/i.test(message)?'模型服务请求频率受限':/timeout|timed.out|abort/i.test(message)?'模型服务等待超时':/empty|no.content/i.test(message)?'模型没有返回正文':'模型服务返回错误';
 if(reason?.kind==='max-tokens'||reason?.kind==='length')hint='模型输出被截断，请减少本次检查范围或切换模型';
 const safeCode=/^[A-Z][A-Z0-9_]{0,60}$/.test(code)?code:'';
 return hint+(status||safeCode?'（'+[status?'HTTP '+status:'',safeCode].filter(Boolean).join(' · ')+'）':'')+'，可在工作台设置中测试或切换模型后重试。';
}
