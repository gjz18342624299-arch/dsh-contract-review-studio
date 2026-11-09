import { ReviewError } from './ai.js'
import { normalizeRecommendations } from './legal-review.js'

// Full-coverage chunks, not a prefix/sample: a material clause may be at the end.
export function recommendationChunks(text, size = 20000) {
  const chunks = []
  for (let start = 0; start < text.length; start += size) chunks.push(text.slice(start, start + size))
  return chunks
}
export function validateRecommendationInput(input) {
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 60000) throw new ReviewError('推荐支持最多60000字的完整合同，请拆分后重试。')
  if (!Array.isArray(input.templates) || !input.templates.length || input.templates.length > 80 || input.templates.some(t => !t || typeof t.id !== 'string' || t.id.length > 200 || typeof t.name !== 'string' || t.name.length > 300 || !Array.isArray(t.rules) || t.rules.length > 500 || t.rules.some(r => !r || typeof r.id !== 'string' || r.id.length > 200 || typeof r.title !== 'string'))) throw new ReviewError('候选模板格式无效（最多80个模板，每模板500项）。')
}
export async function runTemplateRecommendation(input, call, signal) {
  const controller = new AbortController(), abort = () => controller.abort()
  signal?.addEventListener('abort',abort,{once:true})
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort,540000)
  try { return await recommend(input,call,controller.signal) }
  finally { clearTimeout(timer); signal?.removeEventListener('abort',abort) }
}
async function recommend(input, call, signal) {
  validateRecommendationInput(input)
  const chunks = recommendationChunks(input.text)
  // Short aliases prevent long UUIDs from exhausting the output token budget.
  const templates = input.templates.map((t, i) => ({id: 't' + i, name:t.name, type:String(t.type || '').slice(0,100), role:String(t.role || '').slice(0,100), rules:t.rules.map((r,j)=>({id:'r'+j,title:r.title.slice(0,200),guidance:String(r.guidance||'').slice(0,120)}))}))
  let calls = 0
  async function ask(contract, candidates, templatesOnly) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new ReviewError('模板推荐已取消。',499)
      calls++
      try {
        const result = await call({...input,text:JSON.stringify({contract,templates:candidates}),templates:undefined,templatesOnly,compactRecommendation:true,question:attempt?'上次输出截断或格式无效。重试只返回JSON，reason最多30字，questions返回空数组，不要解释。':'只返回紧凑JSON，不复述合同；reason最多80字，questions最多3个、每个最多60字。'},signal)
        return normalizeRecommendations(result.answer,candidates)
      } catch (error) {
        // Exactly one retry, only for incomplete/model-format responses; never retry cancellation.
        if (signal?.aborted || attempt || !(error.status === 502 || /模板推荐|模型推荐/.test(error.message))) throw error
      }
    }
  }
  const ranked = new Map(), questions = new Set()
  for (const contract of chunks) {
    const result = await ask(contract,templates.map(t=>({...t,rules:[]})),true)
    for (const r of result.recommendations) {
      const score = {high:3,medium:2,low:1}[r.confidence]
      const old = ranked.get(r.templateId)
      if (old) old.score += score
      else ranked.set(r.templateId,{...r,score})
    }
    for (const q of result.questions) questions.add(q)
  }
  const selected = [...ranked.values()].sort((a,b)=>b.score-a.score).slice(0,3)
  for (const r of selected) {
    const t = templates.find(t=>t.id===r.templateId), ids = new Set()
    for (let start=0; start<t.rules.length; start+=40) {
      const candidate = {...t,rules:t.rules.slice(start,start+40)}
      for (const contract of chunks) {
        const result=await ask(contract,[candidate],false)
        for (const match of result.recommendations) for (const id of match.ruleIds) ids.add(id)
        for (const q of result.questions) questions.add(q)
      }
    }
    r.ruleIds=[...ids].map(id=>input.templates[Number(t.id.slice(1))].rules[Number(id.slice(1))].id)
    r.templateId=input.templates[Number(t.id.slice(1))].id
    delete r.score
  }
  return {recommendations:selected,questions:[...questions].slice(0,10),coverage:{characters:input.text.length,chunks:chunks.length,complete:true},calls}
}
