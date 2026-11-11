/* Synthetic onboarding material. Editing uses the normal Word workflow. */
(function (root) {
  'use strict';
  const projectId = 'onboarding-demo-project-v1';
  const contractId = 'onboarding-demo-contract-v1';
  const documentName = '演示合同-网站设计服务（虚构）.docx';
  const documentBase64 = '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';
  const copy = value => JSON.parse(JSON.stringify(value));
  const preparations = new WeakMap();
  const unsaved = new WeakSet();
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
    contract.versions = [{ id: 'onboarding-original-v1', name: '演示原稿', time: '演示材料', clauses: copy(contract.clauses), decisions: {}, overrides: {}, textOnly: true }];
    const project = { id: projectId, onboardingDemo: true, name: '演示项目 · 从风险到修改',
      description: '自带虚构 Word 合同与预设风险。体验定位原文、采纳修改、保存和版本比较。',
      created: '演示材料', contractIds: [contractId], fields: {}, confirmed: {}, reviewed: true, completed: false };
    return { project, contract };
  }
  function add(data, sampleFactory, automatic = false) {
    if (!data.v2 || !Array.isArray(data.v2.projects) || !Array.isArray(data.contracts)) return null;
    if (data.v2.onboardingDemoDismissed || automatic && data.v2.onboardingDemoSeen) return null;
    const existing = data.v2.projects.find(p => p.id === projectId);
    if (existing) {
      if (!existing.onboardingDemo) return null;
      data.v2.onboardingDemoSeen = true;
      return existing;
    }
    if (data.contracts.some(c => c.id === contractId)) return null;
    const demo = create(sampleFactory);
    if (data.v2.projects.some(p => String(p.name || '').trim() === demo.project.name)) return null;
    // A bundled project joins the ordinary list once; existing active work keeps its place.
    data.v2.projects.push(demo.project);
    data.contracts.push(demo.contract);
    data.v2.onboardingDemoSeen = true;
    if (!data.active) data.active = demo.contract.id;
    return demo.project;
  }
  function remove(data, id) {
    if (id !== projectId || !Array.isArray(data.v2?.projects) || !Array.isArray(data.contracts)) return null;
    const project = data.v2.projects.find(p => p.id === id);
    if (!project?.onboardingDemo) return null;
    const otherProjects = data.v2.projects.filter(p => p !== project),ids = new Set(project.contractIds || []);
    const contracts = data.contracts.filter(c => ids.has(c.id) && (c.projectId === id || c.onboardingDemo && c.id === contractId && !c.projectId) && !otherProjects.some(p => (p.contractIds || []).includes(c.id)));
    const removedAt = new Date().toISOString(),removed = { project: copy(project), contracts: copy(contracts), removedAt };
    data.v2.removedProjects ||= [];
    data.v2.removedMaterials ||= [];
    data.v2.removedProjects.push(removed);
    for (const contract of contracts) data.v2.removedMaterials.push({ contract: copy(contract), projectId: id, removedAt });
    const removedIds = new Set(contracts.map(c => c.id));
    data.v2.projects = otherProjects;
    data.contracts = data.contracts.filter(c => !removedIds.has(c.id));
    if (removedIds.has(data.active)) data.active = data.contracts[0]?.id || '';
    data.v2.onboardingDemoSeen = true;
    data.v2.onboardingDemoDismissed = true;
    return removed;
  }
  function needsWord(contract) {
    return !!(contract?.onboardingDemo && (unsaved.has(contract) || (!contract.onlyOfficeFileId && !contract.wpsFileId && !(contract.onboardingWordVersion === 2 && contract.originalFile))));
  }
  async function prepare(contract, adapters) {
    if (!needsWord(contract)) return contract;
    if (preparations.has(contract)) return preparations.get(contract);
    const task = (async () => {
      if (unsaved.has(contract)) { await adapters.persist(); unsaved.delete(contract); return contract; }
      // Only the old, local-only demonstration is upgraded. User Word identities are never replaced.
      if (contract.onlyOfficeKey || contract.latestCapture || contract.originalFile || contract.sourceFile)
        throw Error('此演示已有来源或工作稿记录，请恢复已有文件后继续；未用自带合同覆盖。');
      const decisions = contract.decisions || {}, overrides = contract.overrides || {};
      const legacyChanges = Object.keys(overrides).length > 0 || Object.values(decisions).some(d => d.status === 'accepted');
      const before = legacyChanges ? copy({ id: 'onboarding-before-word-v2', name: '升级 Word 前的演示记录', time: new Date().toLocaleString('zh-CN'), clauses: contract.clauses, risks: contract.risks, decisions, overrides, textOnly: true }) : null;
      const bytes = legacyChanges ? await adapters.migratedBytes(contract, documentBase64) : adapters.decode(documentBase64);
      const originalFile = await adapters.store(bytes, documentName);
      // Legacy accepted changes form a real Word baseline. Keep their full history for comparison.
      const session = legacyChanges ? await adapters.session(bytes, documentName) : null;
      if (legacyChanges && (!session?.fileId || !session?.key)) throw Error('演示 Word 会话未返回完整标识，原有演示记录未改变。');
      if (adapters.isPresent && !adapters.isPresent(contract)) throw Error('演示项目已移除，已停止打开 Word。');
      contract.originalFile = originalFile;
      contract.onboardingWordVersion = 2;
      if (session) {
        contract.onlyOfficeFileId = session.fileId;
        contract.onlyOfficeKey = session.key;
        contract.onboardingWordMigrated = true;
        contract.versions ||= [];
        if (!contract.versions.some(v => v.id === before.id)) contract.versions.push(before);
        for (const decision of Object.values(decisions)) if (decision.status === 'accepted') decision.wpsWritten = true;
      }
      unsaved.add(contract);await adapters.persist();unsaved.delete(contract);
      return contract;
    })();
    preparations.set(contract, task);
    try { return await task; }
    finally { preparations.delete(contract); }
  }
  root.ContractReviewDemo = Object.freeze({ projectId, contractId, documentName, documentBase64, create, add, remove, needsWord, prepare });
})(globalThis);
