  function getRawStreamingTps(sp) {
    if (!sp) return null;
    return sp.streamingTps != null ? sp.streamingTps : (sp.tps != null ? sp.tps : null);
  }

  function getEffectiveTps(sp, prevSp = state.prevSpeed) {
    if (!sp) return null;
    const currRaw = getRawStreamingTps(sp);
    if (currRaw == null || !Number.isFinite(currRaw)) return null;
    const prevRaw = getRawStreamingTps(prevSp);
    if (prevRaw != null && Number.isFinite(prevRaw)) {
      return Number((0.6 * currRaw + 0.4 * prevRaw).toFixed(1));
    }
    return currRaw;
  }

  function formatTps(val) {
    if (val == null) return '—';
    const n = Number(val);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (n >= 1000) return String(Math.round(n));
    return n.toPrecision(3);
  }

  function getPanelSpeedTooltipText(sp, prevSp) {
    const currRaw = getRawStreamingTps(sp);
    const prevRaw = getRawStreamingTps(prevSp);
    const line1 = `本轮：${currRaw != null ? `${formatTps(currRaw)} tok/s` : '—'}`;
    const line2 = `上轮：${prevRaw != null ? `${formatTps(prevRaw)} tok/s` : '—'}`;
    return `${line1}\n${line2}`;
  }

  function syncSpeedBadgeText() {
    const sp = state.latest?.speed;
    const speedAmount = el('speed-amount');
    const overflowSpeedVal = el('overflow-speed-val');
    if (!speedAmount) return;
    const isCompact = state.layoutMode === 'compact';
    const effectiveTps = getEffectiveTps(sp, state.prevSpeed);
    if (effectiveTps != null) {
      const formatted = formatTps(effectiveTps);
      speedAmount.textContent = isCompact ? formatted : `${formatted} tok/s`;
      if (overflowSpeedVal) overflowSpeedVal.textContent = `${formatted} tok/s`;
    } else if (state.requestBusy) {
      speedAmount.textContent = isCompact ? '…' : '计算中…';
      if (overflowSpeedVal) overflowSpeedVal.textContent = '计算中…';
    } else {
      speedAmount.textContent = isCompact ? '--' : '-- tok/s';
      if (overflowSpeedVal) overflowSpeedVal.textContent = '-- tok/s';
    }
  }

  // 渲染上下文与全局状态
  function render() {
    host.hidden = !state.route;
    if (!state.route) {
      hideContextTooltip();
      return;
    }
    ensureHostDocked();

    const d = state.latest, session = state.scan?.session;
    const stale = state.requestError || state.requestAt && Date.now() - state.requestAt > 20000;
    const incomplete = session?.unknownFiles > 0;
    const danger = d?.exceeded || d?.error;

    let pct = null;
    if (d?.exceeded) {
      pct = 100;
    } else if (d?.percent != null && !danger && !stale) {
      pct = Math.min(100, Math.max(0, d.percent));
    } else if (d?.actual != null && d?.budget && !danger && !stale) {
      pct = Math.min(100, Math.max(0, (d.actual / d.budget) * 100));
    }

    const barColor = danger ? '#ff4d4f' : pct != null && pct >= 90 ? '#ff4d4f' : pct != null && pct >= 75 || stale || incomplete ? '#faad14' : '#69c0ff';
    const tone = danger ? '#ff9292' : stale || incomplete || d?.estimated ? '#f2c46d' : '#b7c1ff';
    host.style.setProperty('--tone', tone);
    host.style.setProperty('--bar-color', barColor);

    const barFill = el('bar-fill');
    if (barFill) barFill.style.width = pct != null ? `${pct}%` : (d?.exceeded ? '100%' : '0%');

    updateRingAndBubble(d, session, pct, danger, stale, incomplete);

    const status = d?.exceeded ? '服务端已拒绝：输入超限。本地估算不可靠，不能据此判断剩余空间。' : d?.error ? '最近请求失败。没有有效的新用量统计，请查看原始错误。' : stale ? '最近请求统计读取异常或延迟，不能判断剩余空间。' : state.scanError ? '全会话扫描未完成：' + state.scanError : incomplete ? `存在 ${session.unknownFiles} 个附件含未知内容；会话总量仍未计全，不能据此保证不会超限。` : d?.estimated ? '只有客户端估算，附件等内容可能未计全；当前请求真实占用未知。' : '请求用量与会话累计分别统计；会话 token 数始终为本地估算。';
    el('status').textContent = status;

    const corpus = session ? `会话${range(session.total)}${incomplete ? '＋未知' : ''}` : state.scanBusy ? '会话扫描中…' : '会话待扫描';

    if (d?.exceeded) {
      el('amount').textContent = '服务端超限';
      setHoverExtra(' · 100% 已溢出');
    } else if (d?.error) {
      el('amount').textContent = '请求失败';
      setHoverExtra('');
    } else if (stale) {
      el('amount').textContent = '统计延迟';
      setHoverExtra(` · ${corpus}`);
    } else if (d?.actual != null) {
      const pctStr = pct != null ? ` (${pct.toFixed(0)}%)` : '';
      el('amount').textContent = `${short(d.actual)}${pctStr}`;
      const budgetStr = d?.budget ? ` / ${short(d.budget)}` : '';
      setHoverExtra(`${budgetStr} · ${corpus}`);
    } else {
      el('amount').textContent = '真实量未知';
      setHoverExtra(` · ${corpus}`);
    }

    el('badge-tokens').title = 'Token 用量一览（点击展开详情）';

    // 渲染输出速度 (统一使用 tok/s)
    const sp = d?.speed;
    const speedBadge = el('badge-speed');
    const speedHoverExtra = el('speed-hover-extra');
    syncSpeedBadgeText();
    if (speedBadge) {
      if (sp?.tps != null) {
        if (speedHoverExtra) {
          speedHoverExtra.textContent = `${sp.duration ? ` · ${sp.duration}s` : ''}${sp.outputTokens ? ` · ${short(sp.outputTokens)} tok` : ''}`;
        }
        const effectiveTps = getEffectiveTps(sp, state.prevSpeed);
        speedBadge.title = `最新纯流式输出速度：${formatTps(effectiveTps)} tok/s\n耗时：流式 ${sp.streamingSec || '—'}s + 首字 ${sp.ttft || '—'}s (总计 ${sp.duration || '—'}s)\n本次产出：${formatTokenKM(sp.outputTokens)} tokens`;
      } else if (state.requestBusy) {
        if (speedHoverExtra) speedHoverExtra.textContent = '';
        speedBadge.title = '正在等待模型返回或计算生成指标…';
      } else {
        if (speedHoverExtra) speedHoverExtra.textContent = ' · 待生成';
        speedBadge.title = '模型输出速度与耗时 (tok/s)';
      }
    }

    if (el('key-summary')) {
      const keyBar = el('key-bar-fill');
      const keyBadge = el('key-badge');
      const keyUsed = el('key-used');
      const keyLimit = el('key-limit');
      const keyRemaining = el('key-remaining');
      const keyTakeaway = el('key-takeaway');

      if (keyBar) keyBar.style.width = pct != null ? `${pct}%` : (d?.exceeded ? '100%' : '0%');

      if (d?.exceeded) {
        if (keyBadge) { keyBadge.textContent = '已超限'; keyBadge.className = 'key-pill pill-danger'; }
        if (keyUsed) keyUsed.textContent = d.serviceLimit ? `>${short(d.serviceLimit)}` : '超限';
        if (keyLimit) keyLimit.textContent = d.serviceLimit ? short(d.serviceLimit) : (d.budget ? short(d.budget) : '1M');
        if (keyRemaining) keyRemaining.textContent = '0 (已溢出)';
        if (keyTakeaway) keyTakeaway.textContent = `✖ 已超出服务端最大限制${d.serviceLimit ? `（${fmt(d.serviceLimit)} tokens）` : ''}，当前对话已被拒绝。需精简或新建会话。`;
      } else if (d?.error) {
        if (keyBadge) { keyBadge.textContent = '异常'; keyBadge.className = 'key-pill pill-danger'; }
        if (keyUsed) keyUsed.textContent = '—';
        if (keyLimit) keyLimit.textContent = d?.budget ? short(d.budget) : '—';
        if (keyRemaining) keyRemaining.textContent = '—';
        if (keyTakeaway) keyTakeaway.textContent = '✖ 最近请求遇到错误，未产生有效的最新统计结果。';
      } else if (d?.actual != null && pct != null) {
        const limitVal = d.budget || 256000;
        const remainVal = Math.max(0, limitVal - d.actual);
        const remainPct = Math.max(0, 100 - pct);

        if (keyBadge) {
          if (pct >= 90) { keyBadge.textContent = '紧张'; keyBadge.className = 'key-pill pill-danger'; }
          else if (pct >= 75) { keyBadge.textContent = '偏高'; keyBadge.className = 'key-pill pill-warn'; }
          else { keyBadge.textContent = '正常'; keyBadge.className = 'key-pill pill-good'; }
        }
        if (keyUsed) keyUsed.textContent = `${short(d.actual)} (${pct.toFixed(1)}%)`;
        if (keyLimit) keyLimit.textContent = short(limitVal);
        if (keyRemaining) keyRemaining.textContent = `${short(remainVal)} (${remainPct.toFixed(1)}%)`;
        if (keyTakeaway) {
          if (pct >= 90) {
            keyTakeaway.textContent = `⚠ 上下文已消耗 ${pct.toFixed(1)}%，仅剩约 ${short(remainVal)} tokens，接近预算上限！建议清理冗余上下文。`;
          } else if (pct >= 75) {
            keyTakeaway.textContent = `⚡ 已使用 ${pct.toFixed(1)}%，剩余可用空间约 ${short(remainVal)} tokens，注意大文件或长输出。`;
          } else {
            keyTakeaway.textContent = `✔ 当前用量健康（${pct.toFixed(1)}%），剩余可用空间充足（约 ${short(remainVal)} tokens），可正常继续对话。`;
          }
        }
      } else {
        if (keyBadge) { keyBadge.textContent = d?.estimated ? '估算' : '读取中'; keyBadge.className = 'key-pill pill-muted'; }
        if (keyUsed) keyUsed.textContent = d?.estimate ? `约 ${short(d.estimate)}` : (session ? short(session.total.low) : '—');
        if (keyLimit) keyLimit.textContent = d?.budget ? short(d.budget) : '—';
        if (keyRemaining) keyRemaining.textContent = '待确认';
        if (keyTakeaway) keyTakeaway.textContent = 'ℹ 当前主要依赖本地估算或待服务端返回实际统计，暂不计算精确剩余空间。';
      }
    }

    if (el('speed-summary')) {
      const spBadge = el('speed-badge');
      const spVal = el('speed-val');
      const spDur = el('speed-duration');
      const spTtft = el('speed-ttft');
      const spTokens = el('speed-tokens');
      const spTakeaway = el('speed-takeaway');

      const effectiveTps = getEffectiveTps(sp);

      if (effectiveTps != null) {
        if (spBadge) {
          const isFlash = /flash/i.test(d?.model || '');
          const tUltra = isFlash ? 400 : 200;
          const tFast  = isFlash ? 200 : 100;
          const tGood  = isFlash ? 100 : 50;

          if (effectiveTps >= tUltra) {
            spBadge.textContent = '极速';
            spBadge.className = 'key-pill pill-good';
          } else if (effectiveTps >= tFast) {
            spBadge.textContent = '流畅';
            spBadge.className = 'key-pill pill-good';
          } else if (effectiveTps >= tGood) {
            spBadge.textContent = '良好';
            spBadge.className = 'key-pill pill-warn';
          } else {
            spBadge.textContent = '偏慢';
            spBadge.className = 'key-pill pill-danger';
          }
        }
        const panelSpeedTip = getPanelSpeedTooltipText(sp, state.prevSpeed);
        if (spVal) {
          spVal.textContent = `${formatTps(effectiveTps)} tok/s`;
          spVal.title = panelSpeedTip;
        }
        if (spBadge) spBadge.title = panelSpeedTip;
        if (spDur) spDur.textContent = sp.duration ? `${sp.duration}s` : '—';
        if (spTtft) spTtft.textContent = sp.ttft ? `${sp.ttft}s` : '—';
        if (spTokens) {
          if (d?.input && d.input > 0 && d?.cached != null) {
            const cacheRate = (d.cached / d.input) * 100;
            spTokens.textContent = cacheRate <= 0 ? '0%' : (cacheRate >= 99.95 ? '100%' : `${cacheRate.toFixed(1)}%`);
            spTokens.title = `缓存命中：${formatTokenKM(d.cached)} tokens\n总输入：${formatTokenKM(d.input)} tokens`;
          } else if (d?.input != null) {
            spTokens.textContent = '0%';
            spTokens.title = `缓存命中：0 tokens\n总输入：${formatTokenKM(d.input)} tokens`;
          } else {
            spTokens.textContent = '—';
          }
        }
        if (spTakeaway) {
          const isFlash = /flash/i.test(d?.model || '');
          const modelStr = d?.model ? `（${d.model}）` : '';
          const streamInfo = sp.streamingTps ? `，纯流式传输达 ${formatTps(sp.streamingTps)} tok/s` : '';
          spTakeaway.textContent = `✔ 纯流式输出${effectiveTps >= (isFlash ? 200 : 100) ? '流畅' : '平稳'}（${formatTps(effectiveTps)} tok/s${streamInfo}），总耗时 ${sp.duration}s 内生成 ${fmt(sp.outputTokens)} tokens${modelStr}。`;
        }
      } else {
        if (spBadge) { spBadge.textContent = state.requestBusy ? '计算中' : '待生成'; spBadge.className = 'key-pill pill-muted'; }
        if (spVal) spVal.textContent = '—';
        if (spDur) spDur.textContent = '—';
        if (spTtft) spTtft.textContent = '—';
        if (spTokens) spTokens.textContent = '—';
        if (spTakeaway) spTakeaway.textContent = 'ℹ 等待当前或下一次模型输出完成，将自动计算精确输出速度 (tok/s)、首字延迟与总耗时。';
      }
    }

    el('model').textContent = d?.model?.startsWith('MODEL_PLACEHOLDER') ? '模型标识：' + d.model : d?.model || '未返回模型信息';
    el('request-status').textContent = d?.exceeded ? '输入超限（已失败）' : d?.error ? '已失败' : d?.status === 'reported' ? '已返回实际统计' : d?.status === 'estimated' ? '只有本地估算' : '等待统计，未确认执行状态';
    el('actual').textContent = d?.actual != null ? token(d.actual) : d?.exceeded ? `>${fmt(d.serviceLimit || 0)}（实际总数未返回）` : '真实用量未知';
    if (d?.exceeded && !d.serviceLimit) el('actual').textContent = '已超限；实际数值未知';
    el('estimate').textContent = d?.estimate ? `约 ${fmt(d.estimate)} · ${d.exceeded ? '已证实低估' : '仅供参考'}` : '未提供';
    el('budget').textContent = token(d?.budget);
    el('service-limit').textContent = d?.serviceLimit ? `${fmt(d.serviceLimit)}（仅该次错误证据）` : '本次没有服务端限制证据';
    el('percent').textContent = d?.percent != null && !danger && !stale ? `${d.percent.toFixed(1)}%（非 1M 总容量）` : '不提供安全余量百分比';
    el('session-total').textContent = session ? range(session.total) + (incomplete ? ' ＋ 未知内容' : '') : state.scanError ? '扫描未完成' : '扫描中…';
    el('characters').textContent = session ? fmt(session.total.chars) : '—';
    for (const name of ['user', 'assistant', 'thinking', 'tools', 'summaries']) el(name).textContent = session ? range(session.groups[name]) : '—';
    el('system').textContent = session ? range({ low: (session.groups.system?.low || 0) + (session.groups.definitions?.low || 0), high: (session.groups.system?.high || 0) + (session.groups.definitions?.high || 0) }) : '—';
    el('attachment-total').textContent = session ? range(session.attachmentTotal) + (incomplete ? ' ＋ 未知' : '') : '—';
    el('steps').textContent = session ? `${fmt(session.steps)} 条；${session.userMessages} 条用户消息／${session.assistantMessages} 条回复` : '尚未完成全量读取';
    el('coverage').textContent = session ? `${session.attachments.length} 个附件条目（${session.attachments.filter(f => f.source === 'user').length} 个上传、${session.attachments.filter(f => f.source === 'assistant').length} 个模型/工具输出）；${session.attachments.filter(f => f.chars > 0).length} 个已读到文本，${session.unknownFiles} 个含未计内容。${state.scanBusy ? ' 正在重新扫描…' : ''}${state.scanError ? ' 最近重扫失败，当前为旧结果：' + state.scanError : ''}` : state.scanError || '正在扫描整段归档，不依赖页面已加载的聊天条数。';
    el('updated').textContent = `请求统计 ${state.requestAt ? new Date(state.requestAt).toLocaleTimeString() : '未读取'} · 全量扫描 ${state.scan ? new Date(state.scan.scannedAt).toLocaleTimeString() : '未完成'}`;
    el('refresh').disabled = state.scanBusy;
  }

  async function requestPoll(generation, id) {
    state.requestBusy = true;
    const controller = new AbortController(); state.controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const csrf = window.__APP_CONFIG__?.csrfToken; if (!csrf) throw new Error('后台尚未就绪');
      const offset = Math.max(0, state.count - 10);
      const response = await fetch('/exa.language_server_pb.LanguageServerService/GetCascadeTrajectoryGeneratorMetadata', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': csrf }, body: JSON.stringify({ cascadeId: id, generatorMetadataOffset: offset, includeMessages: false }), signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); if (generation !== state.generation || state.disposed) return;
      const rows = data.generatorMetadata || [];
      state.count = rows.length ? offset + rows.length : 0;
      state.speedHistory = state.speedHistory || [];
      for (let i = 0; i < rows.length; i++) {
        const value = summarize(rows[i]);
        if (value) {
          state.latest = withStepError(value, rows[i]);
          if (value.speed?.streamingTps != null || value.speed?.tps != null) {
            const sp = value.speed;
            const spKey = `${sp.outputTokens}_${sp.duration}_${sp.streamingSec}_${sp.ttft}`;
            const existingIdx = state.speedHistory.findIndex(s => s._spKey === spKey);
            if (existingIdx !== -1) {
              state.speedHistory[existingIdx] = { ...sp, _spKey: spKey };
            } else {
              state.speedHistory.push({ ...sp, _spKey: spKey });
            }
          }
        }
      }
      if (state.speedHistory.length > 0) {
        state.currSpeed = state.speedHistory[state.speedHistory.length - 1];
        state.prevSpeed = state.speedHistory.length > 1 ? state.speedHistory[state.speedHistory.length - 2] : null;
      }
      state.requestAt = Date.now(); state.requestError = '';
    } catch (e) { if (generation === state.generation && !state.disposed) state.requestError = e.name === 'AbortError' ? '读取超时' : e.message; }
    finally { clearTimeout(timeout); state.controllers.delete(controller); if (generation === state.generation && !state.disposed) { state.requestBusy = false; state.requestNext = Date.now() + (document.hidden ? 15000 : 3000); render(); } }
  }

  async function scan(generation, id, force = false) {
    state.scanBusy = true; render();
    try {
      let result;
      if (window.contextMeterAPI?.scan) result = await window.contextMeterAPI.scan(id, force);
      else if (window.__AGContextMeterLive) {
        const live = window.__AGContextMeterLive, controller = new AbortController(); state.controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 180000);
        try { const response = await fetch(`http://127.0.0.1:${live.port}/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AG-Context-Token': live.token }, body: JSON.stringify({ id, force }), signal: controller.signal }); if (!response.ok) throw new Error(`扫描接口 HTTP ${response.status}`); result = await response.json(); }
        finally { clearTimeout(timeout); state.controllers.delete(controller); }
      } else throw new Error('完整重启 Antigravity 后启用附件扫描');
      if (generation !== state.generation || state.disposed) return;
      if (!result?.ok) throw new Error(result?.error || '扫描未返回有效结果');
      state.scan = result.data; state.scanError = '';
      if (result.data.scannedAt >= state.requestAt && result.data.latest) { state.latest = result.data.latest; state.requestAt = result.data.scannedAt; }
      state.latest = withStepError(state.latest);
      renderFiles(result.data.session);
    } catch (e) { if (generation === state.generation && !state.disposed) state.scanError = e.message; }
    finally { if (generation === state.generation && !state.disposed) { state.scanBusy = false; state.scanNext = Date.now() + (document.hidden ? 60000 : 20000); render(); } }
  }

  let lastHistorySync = 0;
  function tick() {
    const id = route();
    if (id !== state.route) {
      for (const controller of state.controllers) controller.abort(); state.controllers.clear(); state.generation++;
      Object.assign(state, { route: id, count: 0, latest: null, requestAt: 0, requestError: '', requestBusy: false, requestNext: 0, scanBusy: false, scanNext: 0, scanError: '', scan: null, prevSpeed: null, currSpeed: null, speedHistory: [] }); toggle(false); hideContextTooltip(); renderFiles(null); render();
      void syncTokenHistoryFromHost(true);
    }
    if (id && !state.requestBusy && Date.now() >= state.requestNext) void requestPoll(state.generation, id);
    if (id && !state.scanBusy && Date.now() >= state.scanNext) void scan(state.generation, id);
    if (Date.now() - lastHistorySync > 15000) {
      lastHistorySync = Date.now();
      void syncTokenHistoryFromHost(false);
    }
  }

  const timer = setInterval(tick, 500);
  globalThis.__AGContextMeter = {
    version: '2.6.0',
    theme: () => resolveTheme(),
    setTheme: mode => { currentThemeMode = mode; try { localStorage.setItem('ag_theme_mode', mode); } catch {}; applyTheme(); },
    getCustomColors: () => ({ ...customColors }),
    setCustomColor,
    resetCustomColors,
    resetHeatmapLevels,
    getHeatPreset: () => heatPreset,
    setHeatPreset,
    getHeatPalette: () => getEffectiveHeatmapScale(),
    getActivePickerSlot: () => activePickerSlot,
    openColorPicker,
    closeColorPicker,
    applyPickerHex,
    setTokenHistoryForTest: payload => applyTokenHistoryPayload(payload),
    getTimelineWindow: () => {
      const w = computeTimelineWindow();
      return {
        firstUseDate: w.firstStr,
        winStart: formatLocalYmd(w.winStart),
        winEnd: formatLocalYmd(w.winEnd),
        totalDays: w.totalDays,
        canPrev: w.canPrev,
        canNext: w.canNext
      };
    },
    repositionPanelsForTest: () => positionFloatingPanels(),
    getLayoutMode: () => state.layoutMode,
    setAvailableWidthForTest: width => {
      const next = computeNextLayoutMode(width, state.layoutMode);
      applyLayoutMode(next);
      return state.layoutMode;
    },
    snapshot: () => ({ route: state.route, count: state.count, latest: state.latest, scan: state.scan, requestError: state.requestError, scanError: state.scanError, scanBusy: state.scanBusy, layoutMode: state.layoutMode }),
    dispose() {
      state.disposed = true;
      for (const controller of state.controllers) controller.abort();
      clearInterval(timer);
      if (layoutRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(layoutRaf);
      syncHostStackingElevation(false);
      try { themeObserver?.disconnect(); } catch {}
      try { resizeObserver?.disconnect(); } catch {}
      try { hostDomObserver?.disconnect(); } catch {}
      try {
        window.removeEventListener?.('resize', onWindowResize);
        window.removeEventListener?.('focus', onWindowFocus);
        window.removeEventListener?.('blur', onWindowBlur);
        window.removeEventListener?.('mousemove', onPointerMove);
        window.removeEventListener?.('mouseup', onPointerUp);
        navigator?.windowControlsOverlay?.removeEventListener?.('geometrychange', onWindowResize);
      } catch {}
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
      try { document.getElementById('ag-wco-spacer')?.remove?.(); } catch {}
      try { document.getElementById('ag-topbar-host-fix')?.remove?.(); } catch {}
      host.remove();
    }
  };
  tick();
})();
