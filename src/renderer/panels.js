  // =========================================================================
  // 模块 3: 面板、气泡与溢出菜单交互
  // =========================================================================
  function withStepError(value, metadata) {
    const error = state.scan?.session?.currentError;
    if (!error || value?.error) return value;
    const lastStep = Math.max(-1, ...(metadata?.stepIndices || []), metadata?.chatModel?.chatStartMetadata?.startStepIndex ?? -1);
    if (lastStep > error.index) return value;
    const failure = summarize({ chatModel: { retryInfos: [{ error: error.text }] } });
    return { ...(value || {}), ...failure, model: value?.model || '', used: null, estimate: null, actual: null, percent: null };
  }

  function isAnyPanelOpen() {
    return !el('panel').hidden || !el('panel-tokens').hidden;
  }

  function showPanel(target) {
    const pContext = el('panel');
    const pTokens = el('panel-tokens');
    const pOverflow = el('overflow-menu');
    const bContext = el('badge');
    const bSpeed = el('badge-speed');
    const bTokens = el('badge-tokens');
    const bOverflow = el('badge-overflow');

    if (pOverflow) pOverflow.hidden = true;
    bOverflow?.setAttribute('aria-expanded', 'false');

    if (target === 'tokens') {
      hideContextTooltip();
      closeColorPicker();
      pContext.hidden = true;
      pTokens.hidden = false;
      bContext.setAttribute('aria-expanded', 'false');
      bSpeed?.setAttribute('aria-expanded', 'false');
      bTokens.setAttribute('aria-expanded', 'true');
      syncHostStackingElevation(true);
      positionFloatingPanels();
      void syncTokenHistoryFromHost();
      renderActiveHeatView(true);
    } else if (target === 'context') {
      hideContextTooltip();
      closeColorPicker();
      pTokens.hidden = true;
      pContext.hidden = false;
      bContext.setAttribute('aria-expanded', 'true');
      bSpeed?.setAttribute('aria-expanded', 'true');
      bTokens.setAttribute('aria-expanded', 'false');
      syncHostStackingElevation(true);
      positionFloatingPanels();
    } else {
      pContext.hidden = true;
      pTokens.hidden = true;
      bContext.setAttribute('aria-expanded', 'false');
      bSpeed?.setAttribute('aria-expanded', 'false');
      bTokens.setAttribute('aria-expanded', 'false');
      closeColorPicker();
      hidePopover();
      syncHostStackingElevation(false);
    }
  }

  function toggle(open, tab = 'context') {
    if (!open) {
      showPanel('none');
    } else {
      showPanel(tab === 'tokens' ? 'tokens' : 'context');
    }
  }

  function toggleContext() {
    if (!el('panel').hidden) showPanel('none');
    else showPanel('context');
  }

  function toggleTokens() {
    if (!el('panel-tokens').hidden) showPanel('none');
    else showPanel('tokens');
  }

  function toggleOverflowMenu() {
    const pOverflow = el('overflow-menu');
    if (!pOverflow) return;
    const willOpen = pOverflow.hidden;
    showPanel('none');
    hideContextTooltip();
    pOverflow.hidden = !willOpen;
    el('badge-overflow')?.setAttribute('aria-expanded', String(willOpen));
    syncHostStackingElevation(willOpen);
    if (willOpen) positionFloatingPanels();
  }

  el('badge').addEventListener('click', toggleContext);
  el('badge-speed')?.addEventListener('click', toggleContext);
  el('badge-tokens').addEventListener('click', toggleTokens);
  el('badge-overflow')?.addEventListener('click', toggleOverflowMenu);
  el('overflow-speed-btn')?.addEventListener('click', () => showPanel('context'));
  el('overflow-tokens-btn')?.addEventListener('click', () => showPanel('tokens'));
  el('close').addEventListener('click', () => showPanel('none'));
  el('close-tokens')?.addEventListener('click', () => showPanel('none'));

  // 上下文圆环悬停与键盘聚焦气泡（面板打开时不通过悬停误切，必须通过显式左键点击切换）
  el('badge').addEventListener('mouseenter', () => {
    if (!isAnyPanelOpen()) {
      showContextTooltip();
    }
  });
  el('badge').addEventListener('mouseleave', () => {
    hideContextTooltip();
  });
  el('badge').addEventListener('focus', () => {
    if (!isAnyPanelOpen()) showContextTooltip();
  });
  el('badge').addEventListener('blur', () => {
    hideContextTooltip();
  });

  el('theme-toggle')?.addEventListener('click', cycleTheme);
  el('theme-toggle-tokens')?.addEventListener('click', cycleTheme);
  el('badge').addEventListener('contextmenu', e => { e.preventDefault(); cycleTheme(); });
  el('badge-tokens').addEventListener('contextmenu', e => { e.preventDefault(); cycleTheme(); });
  el('badge-speed')?.addEventListener('contextmenu', e => { e.preventDefault(); cycleTheme(); });

  // 二级抽屉 1（面板 B 内）: 指标与背景颜色自定义抽屉折叠展开
  const btnColors = el('btn-toggle-colors');
  const colorDrawerBody = el('color-drawer-body');
  const colorDrawerArrow = el('color-drawer-arrow');
  btnColors?.addEventListener('click', () => {
    if (!colorDrawerBody) return;
    const isHidden = colorDrawerBody.style.display === 'none' || !colorDrawerBody.style.display;
    colorDrawerBody.style.display = isHidden ? 'block' : 'none';
    if (colorDrawerArrow) colorDrawerArrow.textContent = isHidden ? '▲' : '▼';
    btnColors.setAttribute('aria-expanded', String(isHidden));
  });

  // 二级抽屉 2（面板 B 内）: 底层技术抽屉折叠展开
  const btnDetails = el('btn-toggle-details');
  const drawerBody = el('drawer-body');
  const drawerArrow = el('drawer-arrow');
  btnDetails?.addEventListener('click', () => {
    if (!drawerBody) return;
    const isHidden = drawerBody.style.display === 'none' || !drawerBody.style.display;
    drawerBody.style.display = isHidden ? 'block' : 'none';
    if (drawerArrow) drawerArrow.textContent = isHidden ? '▲' : '▼';
    btnDetails.setAttribute('aria-expanded', String(isHidden));
  });

  // 二级抽屉 3（面板 A 内就近设置）: 热力图色阶与面板外观自定义抽屉折叠展开
  const btnTokenColors = el('btn-toggle-token-colors');
  const tokenColorDrawerBody = el('token-color-drawer-body');
  const tokenColorDrawerArrow = el('token-color-drawer-arrow');
  function toggleTokenColorsDrawer(forceOpen) {
    if (!tokenColorDrawerBody) return;
    const curHidden = tokenColorDrawerBody.style.display === 'none' || !tokenColorDrawerBody.style.display;
    const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : curHidden;
    tokenColorDrawerBody.style.display = nextOpen ? 'block' : 'none';
    if (tokenColorDrawerArrow) tokenColorDrawerArrow.textContent = nextOpen ? '▲' : '▼';
    btnTokenColors?.setAttribute('aria-expanded', String(nextOpen));
  }
  btnTokenColors?.addEventListener('click', () => toggleTokenColorsDrawer());
  el('heat-legend-scale')?.addEventListener('click', () => toggleTokenColorsDrawer(true));

  // 热力图视图切换（每天 / 每周 / 累计总量）
  function renderActiveHeatView(forceRebuild = false) {
    if (activeHeatView === 'weekly') {
      renderHeatmapWeekly();
    } else if (activeHeatView === 'cum') {
      renderHeatmapCum();
    } else {
      renderHeatmapGrid(forceRebuild);
    }
  }

  function switchHeatView(view) {
    activeHeatView = view;
    const tDaily = el('h-tab-daily');
    const tWeekly = el('h-tab-weekly');
    const tCum = el('h-tab-cum');
    const bDaily = el('h-daily-box');
    const bWeekly = el('h-weekly-box');
    const bCum = el('h-cum-box');

    tDaily.classList.remove('active');
    tWeekly.classList.remove('active');
    tCum.classList.remove('active');
    bDaily.style.display = 'none';
    bWeekly.style.display = 'none';
    bCum.style.display = 'none';
    hidePopover();

    if (view === 'weekly') {
      tWeekly.classList.add('active');
      bWeekly.style.display = 'flex';
      renderHeatmapWeekly();
    } else if (view === 'cum') {
      tCum.classList.add('active');
      bCum.style.display = 'block';
      renderHeatmapCum();
    } else {
      tDaily.classList.add('active');
      bDaily.style.display = 'block';
      renderHeatmapGrid(true);
    }
  }

  el('h-tab-daily')?.addEventListener('click', () => switchHeatView('daily'));
  el('h-tab-weekly')?.addEventListener('click', () => switchHeatView('weekly'));
  el('h-tab-cum')?.addEventListener('click', () => switchHeatView('cum'));

  el('h-page-prev')?.addEventListener('click', () => {
    heatPageOffset -= 1;
    renderActiveHeatView(true);
  });
  el('h-page-next')?.addEventListener('click', () => {
    if (heatPageOffset < 0) {
      heatPageOffset += 1;
      renderActiveHeatView(true);
    }
  });

  el('refresh').addEventListener('click', () => { if (state.route && !state.scanBusy) void scan(state.generation, state.route, true); });
  const outside = e => {
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    if (!path.includes(host)) {
      closeColorPicker();
      toggle(false);
      hideContextTooltip();
      const om = el('overflow-menu');
      if (om) om.hidden = true;
      syncHostStackingElevation(false);
    }
  };
  const escape = e => {
    if (e.key === 'Escape') {
      const pop = el('color-picker-popover');
      if (pop && !pop.hidden) {
        closeColorPicker();
        return;
      }
      toggle(false);
      hideContextTooltip();
      const om = el('overflow-menu');
      if (om) om.hidden = true;
      syncHostStackingElevation(false);
    }
  };
  document.addEventListener('click', outside);
  document.addEventListener('keydown', escape);
