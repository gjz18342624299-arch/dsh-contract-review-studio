/* Synthetic onboarding data and local-only review actions. */
(function (root) {
  'use strict';
  const projectId = 'onboarding-demo-project-v1';
  const contractId = 'onboarding-demo-contract-v1';
  const copy = value => JSON.parse(JSON.stringify(value));
  function create(sampleFactory) {
    const contract = sampleFactory(contractId, '演示合同 · 网站设计服务（虚构）');
    Object.assign(contract, {
      onboardingDemo: true, projectId, kind: 'service', sample: true,
      partyA: '示例甲方有限公司（虚构）', partyB: '示例乙方有限公司（虚构）',
      templateId: null, ruleIds: [], annotations: [], checks: [],
      decisions: {}, overrides: {}, needsReview: false, updated: '演示材料',
      snapshot: { name: '预设演示检查清单', version: 1, reviewMode: 'demo', rules: [] }
    });
    contract.risks.forEach(risk => {
      risk.quote = contract.clauses[risk.clause].text;
      risk.original = risk.quote;
      risk.draft = risk.suggestion;
      risk.basis = '预设演示关注点 · 非模型审查或已核验法律结论';
    });
    contract.versions = [{ id: 'onboarding-original-v1', name: '演示原稿', time: '演示材料', clauses: copy(contract.clauses), decisions: {}, overrides: {} }];
    const project = { id: projectId, onboardingDemo: true, name: '演示项目 · 从风险到修改',
      description: '虚构合同与预设风险。体验定位原文、采纳修改、撤回和导出。',
      created: '演示材料', contractIds: [contractId], fields: {}, confirmed: {}, reviewed: true, completed: false };
    return { project, contract };
  }
  function add(data, sampleFactory, automatic = false) {
    if (!data.v2 || !Array.isArray(data.v2.projects) || !Array.isArray(data.contracts)) return null;
    if (automatic && (data.v2.onboardingDemoSeen || data.v2.projects.length || data.contracts.length)) return null;
    const existing = data.v2.projects.find(p => p.id === projectId);
    if (existing) return existing.onboardingDemo ? existing : null;
    if (data.contracts.some(c => c.id === contractId)) return null;
    const demo = create(sampleFactory);
    data.v2.projects.unshift(demo.project);
    data.contracts.push(demo.contract);
    data.v2.onboardingDemoSeen = true;
    if (!data.active) data.active = demo.contract.id;
    return demo.project;
  }
  function decide(contract, riskId, status, text) {
    if (!contract?.onboardingDemo || !['accepted', 'kept', 'open'].includes(status)) throw Error('仅支持演示合同的本地处理');
    const risk = contract.risks.find(item => item.id === riskId);
    if (!risk) throw Error('演示风险不存在');
    if (status === 'open') delete contract.decisions[riskId];
    else contract.decisions[riskId] = { status, ...(status === 'accepted' ? { text: text || risk.suggestion } : {}) };
    contract.updated = new Date().toLocaleString('zh-CN');
  }
  root.ContractReviewDemo = Object.freeze({ projectId, contractId, create, add, decide });
})(globalThis);
