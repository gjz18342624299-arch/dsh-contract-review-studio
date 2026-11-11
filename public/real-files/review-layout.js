/* Resize and hide the review pane without remounting the Word editor. */
(function () {
  'use strict';
  const key = 'contract-review-layout-v1';
  let preference = {width: 440, collapsed: false};
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && Number.isFinite(saved.width)) preference.width = Math.max(300, Math.min(900, saved.width));
    if (saved?.collapsed === true) preference.collapsed = true;
  } catch {}
  const persist = () => { try {localStorage.setItem(key, JSON.stringify(preference));} catch {} };
  window.addEventListener('click', event => {
    const button = event.target.closest('.mobile-switch [data-action="mobile"]');
    if (!button || !['doc', 'risk'].includes(button.dataset.tab)) return;
    const workspace = button.closest('#content')?.querySelector('.workspace[data-adjustable-review]');
    if (!workspace) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const next = button.dataset.tab;
    // The existing editor reuse path deliberately skips repainting the shell.
    // Switch only visibility, keeping its global view state and live iframe.
    if (typeof mobile !== 'undefined') mobile = next;
    workspace.classList.toggle('mobile-doc', next === 'doc');
    workspace.classList.toggle('mobile-risk', next === 'risk');
    for (const sibling of button.parentElement.querySelectorAll('[data-action="mobile"]')) {
      const active = sibling.dataset.tab === next;
      sibling.classList.toggle('active', active);
      sibling.setAttribute('aria-pressed', String(active));
    }
  }, true);
  function install(workspace) {
    if (workspace.dataset.adjustableReview) return;
    const pane = workspace.querySelector(':scope > .panel');
    const documentPane = workspace.querySelector(':scope > .document-side');
    if (!pane || !documentPane) return;
    workspace.dataset.adjustableReview = 'true';
    const divider = document.createElement('div');
    divider.className = 'review-divider';
    divider.tabIndex = 0;
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', 'vertical');
    divider.setAttribute('aria-label', '调整正文和审查栏宽度');
    divider.title = '拖动调整宽度；方向键微调，双击恢复';
    pane.before(divider);
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'review-pane-toggle';
    toggle.setAttribute('aria-label', '折叠整个审查栏');
    toggle.title = '折叠整个审查栏';
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>';
    const restore = document.createElement('button');
    restore.type = 'button'; restore.className = 'review-pane-restore';
    restore.setAttribute('aria-label', '展开审查栏');
    restore.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 5-7 7 7 7"/></svg><span>展开审查栏</span>';
    workspace.append(restore);
    const bounds = () => {
      const total = workspace.getBoundingClientRect().width;
      const min = Math.min(300, Math.max(180, total * .4));
      return {min, max: Math.max(min, total - Math.min(360, total * .42) - 10)};
    };
    function apply() {
      const {min, max} = bounds();
      const width = Math.round(Math.max(min, Math.min(max, preference.width)));
      workspace.style.setProperty('--review-pane-width', width + 'px');
      workspace.classList.toggle('review-pane-collapsed', preference.collapsed);
      divider.setAttribute('aria-valuemin', String(Math.round(min)));
      divider.setAttribute('aria-valuemax', String(Math.round(max)));
      divider.setAttribute('aria-valuenow', String(width));
      toggle.setAttribute('aria-expanded', String(!preference.collapsed));
      restore.setAttribute('aria-expanded', String(!preference.collapsed));
    }
    function attachToggle() {
      const tabs = pane.querySelector('.panel-tabs');
      if (tabs && toggle.parentElement !== tabs) tabs.append(toggle);
    }
    toggle.onclick = () => {preference.collapsed = true; apply(); persist(); restore.focus();};
    restore.onclick = () => {preference.collapsed = false; attachToggle(); apply(); persist(); toggle.focus();};
    divider.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const {min, max} = bounds();
      const width = Number(divider.getAttribute('aria-valuenow'));
      preference.width = event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowLeft' ? 20 : -20);
      apply(); persist();
    };
    divider.ondblclick = () => {preference.width = 440; apply(); persist();};
    let cancelDrag = null;
    divider.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); cancelDrag?.();
      const shield = document.createElement('div');
      shield.className = 'review-drag-shield'; document.body.append(shield);
      const move = e => {
        const {min, max} = bounds();
        preference.width = Math.max(min, Math.min(max, workspace.getBoundingClientRect().right - e.clientX - 5));
        apply();
      };
      cancelDrag = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        window.removeEventListener('blur', finish);
        shield.remove(); workspace.classList.remove('review-resizing'); cancelDrag = null;
      };
      const finish = () => {cancelDrag?.(); persist();};
      workspace.classList.add('review-resizing');
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
      window.addEventListener('blur', finish);
    };
    const resize = new ResizeObserver(apply); resize.observe(workspace);
    const observer = new MutationObserver(() => {
      if (!workspace.isConnected) {cancelDrag?.(); resize.disconnect(); observer.disconnect();}
      else attachToggle();
    });
    observer.observe(document.body, {childList: true, subtree: true});
    attachToggle(); apply();
  }
  const scan = () => document.querySelectorAll('.workspace').forEach(install);
  new MutationObserver(scan).observe(document.documentElement, {childList: true, subtree: true});
  scan();
})();
