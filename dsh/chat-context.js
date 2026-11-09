import {ReviewError} from './ai.js';
export function chatContext(data){
 const files=data.attachments??[],history=data.history??[];
 if(!Array.isArray(files)||files.length>5||files.some(f=>!f||typeof f.name!=='string'||!f.name.trim()||f.name.length>240||typeof f.text!=='string'||!f.text.trim()||f.text.length>20000)||files.reduce((n,f)=>n+f.text.length,0)>20000)throw new ReviewError('问答附件格式无效或正文合计超过20000字。');
 if(!Array.isArray(history)||history.length>8||history.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.text!=='string'||m.text.length>2000))throw new ReviewError('问答历史格式无效。');
 return {referenceFiles:files.map(f=>({name:f.name,text:f.text})),priorConversation:history.map(m=>({role:m.role,text:m.text}))};
}
