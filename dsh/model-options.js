// Only request effort levels explicitly advertised by the installed provider.
export async function efficientModelOptions(ctx,route,review=false,signal){
 if(typeof ctx.llm.resolveModelInfo!=='function')return {};
 try{const info=await ctx.llm.resolveModelInfo(route.provider,route.model,signal),supported=(info.reasoning?.efforts||[]).map(x=>x.id);const effort=['off','low'].find(level=>supported.includes(level));return effort?{reasoningEffort:effort}:{};}catch{return {};}
}
