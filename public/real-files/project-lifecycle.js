/* Project deletion changes local records only. Original files and remote Word files stay intact. */
(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const validId = id => typeof id === 'string' && id.length > 0;
  const references = (project, id) => Array.isArray(project?.contractIds) && project.contractIds.includes(id);

  function remove(data, id) {
    const state = data?.v2;
    if (!validId(id) || !Array.isArray(state?.projects) || !Array.isArray(data.contracts)) return null;
    if (state.removedProjects != null && !Array.isArray(state.removedProjects) || state.removedMaterials != null && !Array.isArray(state.removedMaterials)) return null;
    const matches = state.projects.filter(project => project?.id === id);
    // Duplicate project IDs make the intended owner ambiguous; leave the complete workspace unchanged.
    if (matches.length !== 1) return null;
    const project = matches[0], others = state.projects.filter(item => item !== project);
    const related = data.contracts.filter(contract => contract && (contract.projectId === id || validId(contract.id) && references(project, contract.id)));
    const removed = new Set(), reassigned = [];
    for (const contract of related) {
      const explicitOwner = others.find(item => validId(item?.id) && item.id === contract.projectId);
      const referencedOwner = validId(contract.id) ? others.find(item => validId(item?.id) && references(item, contract.id)) : null;
      const owner = explicitOwner || referencedOwner;
      if (!owner) removed.add(contract);
      else if (contract.projectId !== owner.id) reassigned.push({ contract, projectId: owner.id });
    }
    // Clone every affected record before mutating. Shared contract snapshots retain their original owner.
    const removedAt = new Date().toISOString();
    const archive = {
      project: copy(project), contracts: copy(related), removedAt,
      removedContractIds: related.filter(contract => removed.has(contract)).map(contract => contract.id).filter(validId),
      retainedContractIds: related.filter(contract => !removed.has(contract)).map(contract => contract.id).filter(validId)
    };
    const materialArchives = related.filter(contract => removed.has(contract)).map(contract => ({ contract: copy(contract), projectId: id, removedAt }));
    const contracts = data.contracts.filter(contract => !removed.has(contract));
    let active = data.active;
    if (!contracts.some(contract => contract?.id === active)) {
      const linked = others.flatMap(item => Array.isArray(item?.contractIds) ? item.contractIds : []).find(contractId => validId(contractId) && contracts.some(contract => contract?.id === contractId));
      active = linked || contracts.find(contract => validId(contract?.id))?.id || '';
    }

    state.removedProjects ||= [];
    state.removedMaterials ||= [];
    state.removedProjects.push(archive);
    state.removedMaterials.push(...materialArchives);
    for (const assignment of reassigned) assignment.contract.projectId = assignment.projectId;
    state.projects = others;
    data.contracts = contracts;
    data.active = active;
    // An explicit delete-to-empty choice must survive even if a prior ID/name conflict hid onboarding.
    if (others.length === 0) state.onboardingDemoSeen = true;
    if (project.onboardingDemo) {
      state.onboardingDemoSeen = true;
      state.onboardingDemoDismissed = true;
    }
    return archive;
  }

  root.ContractReviewProjects = Object.freeze({ remove });
})(globalThis);
