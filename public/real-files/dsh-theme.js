/* App-owned same-origin theme adapter; this is not a DSH SDK contract. */
(() => {
  'use strict';
  const root = document.body;
  root.classList.add('business-app');
  const tokens = new Set([
    '--dsw-font-family','--dsw-alias-bg-base','--dsw-alias-bg-layer-1','--dsw-alias-bg-layer-2','--dsw-alias-bg-layer-3',
    '--dsw-alias-label-primary','--dsw-alias-label-secondary','--dsw-alias-label-tertiary',
    '--dsw-alias-border-l3','--dsw-alias-border-l4','--dsw-alias-button-primary-fill',
    '--dsw-alias-label-primary-foreground','--dsw-alias-state-business-primary','--dsw-alias-link',
    '--dsw-alias-interactive-bg-hover','--dsw-alias-interactive-bg-active','--dsw-radius-xs','--dsw-radius-sm','--dsw-radius-md',
    '--dsw-radius-lg','--dsw-radius-xl','--dsw-radius-panel'
  ]);
  let hostTheme = false;
  const media = matchMedia('(prefers-color-scheme: dark)');
  function fallbackTheme() {
    if (hostTheme) return;
    const explicit = root.hasAttribute('data-ds-dark-theme') ? 'dark' : document.documentElement.dataset.theme;
    root.dataset.appTheme = explicit === 'dark' || (!explicit && media.matches) ? 'dark' : 'light';
  }
  fallbackTheme();
  media.addEventListener('change', fallbackTheme);
  new MutationObserver(fallbackTheme).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  new MutationObserver(fallbackTheme).observe(root,{attributes:true,attributeFilter:['data-ds-dark-theme']});
  window.addEventListener('message', event => {
    const data = event.data;
    if (window.parent === window || event.source !== window.parent || event.origin !== location.origin ||
      data?.type !== 'contract-workbench-theme' || data.version !== 1 ||
      !['light','dark'].includes(data.theme) || !data.tokens || typeof data.tokens !== 'object' || Array.isArray(data.tokens)) return;
    hostTheme = true;
    root.dataset.appTheme = data.theme;
    for (const name of tokens) {
      const value = data.tokens[name];
      const valid = typeof value === 'string' && value.length < 500 && !/[;{}<>]|url\s*\(/i.test(value) &&
        (name === '--dsw-font-family' || CSS.supports(name.includes('radius') ? 'border-radius' : 'color',value));
      if (valid) root.style.setProperty(name,value);
      else root.style.removeProperty(name);
    }
  });
  if (window.parent !== window) window.parent.postMessage({type:'contract-workbench-theme-ready',version:1},location.origin);

  // Move existing local navigation only. Never remount the document/editor on resize or theme changes.
  let projectGuide=null;
  function refineProjectList(page) {
    page.classList.add('business-project-page');
    const create=page.querySelector('.v2-head [data-v2="new-project"]');
    if(create&&create.textContent!=='＋ 新建项目')create.textContent='＋ 新建项目';
    const guide = page.querySelector('#onboarding-demo')||projectGuide;
    if (guide) {
      projectGuide=guide;
      const introduction = page.querySelector('#project-intro');
      const actions = page.querySelector('.v2-head .v2-actions');
      if (actions && guide.parentElement !== actions) {
        guide.textContent='使用引导';actions.prepend(guide);
        introduction?.remove();
      }
    }
    const grid=page.querySelector('.v2-grid');
    if (!grid) return;
    grid.classList.add('business-project-list');
    if (!grid.querySelector('.business-list-heading') && grid.querySelector('[data-v2="open-project"]')) {
      const heading=document.createElement('div');heading.className='business-list-heading';heading.setAttribute('aria-hidden','true');
      for (const text of ['项目名称','材料','状态','待处理意见','最近更新','操作']) {
        const cell=document.createElement('span');cell.textContent=text;heading.append(cell);
      }
      grid.prepend(heading);
    }
    for (const card of grid.querySelectorAll(':scope>.v2-card')) {
      if (card.classList.contains('business-project-row')) continue;
      const open=card.querySelector('[data-v2="open-project"]');
      if (!open) continue;
      const top=card.querySelector(':scope>.v2-row.v2-between');
      const icon=top?.querySelector('.v2-icon'),status=top?.querySelector('.v2-badge');
      const name=card.querySelector(':scope>h3'),description=card.querySelector(':scope>p');
      const materials=card.querySelector(':scope>.v2-gap');
      const foot=card.querySelector('.v2-card-foot'),meta=foot?.querySelector('.v2-sub');
      const actions=foot?.querySelector('.v2-actions');
      if (!name || !materials || !status || !actions) continue;
      name.title=name.textContent;if(description)description.title=description.textContent;
      const identity=document.createElement('div');identity.className='business-project-identity';
      const text=document.createElement('div');text.className='business-project-name';text.append(name);if(description)text.append(description);
      if(icon)identity.append(icon);identity.append(text);
      const detail=(meta?.textContent||'').split('·').map(value=>value.trim());
      const updated=document.createElement('time');updated.className='business-project-updated';updated.textContent=detail.shift()||'—';
      const pending=document.createElement('span');pending.className='business-project-pending';pending.textContent=detail.join(' · ').replace(/项意见待处理/,'项')||'—';
      pending.setAttribute('aria-label','待处理意见：'+pending.textContent);updated.setAttribute('aria-label','最近更新：'+updated.textContent);
      materials.classList.add('business-project-materials');status.classList.add('business-project-status');
      actions.classList.add('business-project-actions');open.textContent='打开项目';
      const remove=actions.querySelector('[data-project-delete]');
      if(remove){remove.textContent='删除';remove.setAttribute('aria-label','删除项目：'+name.textContent);}
      card.classList.add('business-project-row');
      card.replaceChildren(identity,materials,status,pending,updated,actions);
    }
  }
  function enhance() {
    const shell = root.querySelector('.shell'), topbar = shell?.querySelector('.topbar'), rail = shell?.querySelector('.rail');
    if (!shell || !topbar || !rail) return;
    rail.classList.add('workspace-rail','business-sidebar');
    rail.setAttribute('aria-label','合同工作台局部导航');
    const main = shell.querySelector('.main');
    let heading = rail.querySelector(':scope > .business-sidebar-heading');
    if (!heading) {
      heading=document.createElement('div');heading.className='business-sidebar-heading';
      const full=document.createElement('span');full.className='business-sidebar-full-title';full.textContent='合同审核工作台';
      const compact=document.createElement('span');compact.className='business-sidebar-short-title';compact.textContent='合同';compact.setAttribute('aria-hidden','true');
      heading.append(full,compact);rail.prepend(heading);
    }
    if (rail.parentElement !== shell) shell.insertBefore(rail,main);
    main.querySelector(':scope > .business-header')?.remove();
    const steps = main.querySelector(':scope > .v2-stepbar');
    if (steps) {
      if (steps.nextElementSibling !== topbar) topbar.before(steps);
      steps.setAttribute('aria-label','合同审核步骤');
      for(const button of steps.querySelectorAll('[data-v2="stage"]')) {
        if(button.classList.contains('active'))button.setAttribute('aria-current','step');
        else button.removeAttribute('aria-current');
      }
    }
    root.dataset.businessView = shell.querySelector('.workspace') ? 'document' : topbar.querySelector('.journey-pickers') ? 'workflow' : 'overview';
    for (const nav of rail.querySelectorAll('.nav')) {
      nav.setAttribute('aria-label',nav.textContent.trim());
      nav.title=nav.textContent.trim();
      if (nav.classList.contains('active')) nav.setAttribute('aria-current','page');
      else nav.removeAttribute('aria-current');
    }
    const settings = root.querySelector('#workbench-settings');
    if (settings) {
      if (settings.parentElement !== rail) rail.append(settings);
      if (!settings.querySelector('span')) {const text=document.createElement('span');text.textContent='工作台设置';settings.append(text);}
    }
    for (const button of root.querySelectorAll('[data-project-delete],#confirm-remove-project,#confirm-remove-demo-project')) button.classList.add('business-destructive');
    const projects=root.querySelector('#v2-project-search')?.closest('.v2-page');
    if (projects) refineProjectList(projects);
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {queued=false;enhance();});
  }).observe(document.getElementById('app'),{childList:true,subtree:true});
  enhance();
})();
