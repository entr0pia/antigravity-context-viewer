'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { fileURLToPath } = require('url');
const { spawn, spawnSync } = require('child_process');
const { analyzeSteps, summarize, add, empty, measure } = require('./meter-core');

let cachedPython = undefined;
function resolvePython() {
  if (cachedPython !== undefined) return cachedPython;
  const home = os.homedir();
  const candidates = [];
  if (process.env.AG_METER_PYTHON) candidates.push(process.env.AG_METER_PYTHON);
  candidates.push(
    path.join(home, '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3')
  );
  if (process.platform === 'win32') {
    const localPrograms = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Python');
    if (fs.existsSync(localPrograms)) {
      for (const dir of fs.readdirSync(localPrograms).sort().reverse()) {
        candidates.push(path.join(localPrograms, dir, 'python.exe'));
      }
    }
  }
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).size > 0) {
        cachedPython = p;
        return cachedPython;
      }
    } catch {}
  }
  for (const cmd of process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python']) {
    try {
      const check = spawnSync(cmd, ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
      if (check.status === 0 && check.stdout.trim()) {
        cachedPython = check.stdout.trim().split(/\r?\n/)[0];
        return cachedPython;
      }
    } catch {}
  }
  cachedPython = null;
  return null;
}

const filesCache = new Map();
const MAX_FILES_CACHE = 500;
function setFilesCache(key, value) {
  if (filesCache.size >= MAX_FILES_CACHE) {
    const firstKey = filesCache.keys().next().value;
    if (firstKey !== undefined) filesCache.delete(firstKey);
  }
  filesCache.set(key, value);
}
const conversations = new Map();
let pythonQueue = Promise.resolve();
function request(origin, method, body, token) {
  const url = method ? `${origin}/exa.language_server_pb.LanguageServerService/${method}` : origin + '/';
  return new Promise((resolve, reject) => {
    const req = https.request(url, { rejectUnauthorized: false, method: method ? 'POST' : 'GET', headers: method ? { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': token } : {} }, response => {
      let chunks = [], size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 96 * 1024 * 1024) { req.destroy(new Error('本地响应过大，扫描不完整')); return; } chunks.push(chunk); });
      response.on('end', () => { const text = Buffer.concat(chunks).toString(); if (response.statusCode !== 200) reject(new Error(`本机接口 HTTP ${response.statusCode}`)); else { try { resolve(method ? JSON.parse(text) : text); } catch (e) { reject(e); } } });
    });
    req.setTimeout(20000, () => req.destroy(new Error('本机接口读取超时'))); req.on('error', reject); req.end(method ? JSON.stringify(body) : undefined);
  });
}
function pythonScan(items) {
  const task = pythonQueue.then(() => runPythonScan(items));
  pythonQueue = task.catch(() => {});
  return task;
}
function runPythonScan(items) {
  return new Promise((resolve, reject) => {
    const py = resolvePython();
    if (!py) return reject(new Error('本地 Python 解析环境不可用'));
    const source = fs.readFileSync(path.join(__dirname, 'attachment_scan.py'), 'utf8');
    const child = spawn(py, ['-I', '-c', source, '--json-lines'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', timedOut = false;
    const completed = [];
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120000);
    child.stdout.on('data', chunk => { output += chunk; let at; while ((at = output.indexOf('\n')) >= 0) { const line = output.slice(0, at).trim(); output = output.slice(at + 1); if (line) { try { completed.push(JSON.parse(line)); } catch {} } } }); child.stderr.on('data', chunk => { if (errors.length < 1000) errors += chunk; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); const reason = timedOut ? '扫描超时，未完成部分不计为零' : code !== 0 ? '解析进程失败：' + errors.slice(0, 160) : '附件没有返回解析结果'; const done = new Set(completed.map(v => v.key)); for (const item of items) if (!done.has(item.key)) completed.push({ key: item.key, ...empty(), status: 'unknown', unknownParts: [reason] }); resolve(completed); });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify(items));
  });
}
function getImageDimensions(buf) {
  try {
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf.length >= 10 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4D) {
      return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) };
    }
    if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] === 0xFF && [0xC0, 0xC1, 0xC2, 0xC3].includes(buf[offset + 1])) {
          return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
        } else if (buf[offset] === 0xFF) {
          const len = buf.readUInt16BE(offset + 2);
          offset += 2 + len;
        } else {
          offset++;
        }
      }
    }
  } catch {}
  return { width: null, height: null };
}

function calcImageTokens(w, h) {
  if (!w || !h) return [258, 1120];
  if (w <= 384 && h <= 384) return [258, 258];
  const tiles = Math.ceil(w / 768) * Math.ceil(h / 768);
  const tok = tiles * 258;
  return [tok, Math.max(tok, (w > 384 || h > 384) ? 1120 : 258)];
}

async function scanFiles(media) {
  const results = new Map(), work = [];
  for (const item of media) {
    try {
      if (item.inlineData) {
        const mime = String(item.mime || '').toLowerCase();
        const rawInline = String(item.inlineData);
        const inlineCacheKey = `inline|${mime}|${rawInline.length}|${rawInline.slice(0, 48)}|${rawInline.slice(-32)}`;
        if (filesCache.has(inlineCacheKey)) {
          results.set(item.uri, filesCache.get(inlineCacheKey));
          continue;
        }
        const buf = Buffer.from(rawInline, 'base64');
        let parsedInline;
        if (mime.startsWith('image/')) {
          const dims = getImageDimensions(buf);
          const [low, high] = calcImageTokens(dims.width, dims.height);
          parsedInline = {
            status: 'parsed',
            width: dims.width,
            height: dims.height,
            chars: 0,
            dimensions: dims.width ? `${dims.width}×${dims.height}` : null,
            bytes: buf.length,
            low,
            high,
            unknownParts: []
          };
        } else if (mime.startsWith('text/') || mime === 'application/json' || mime === 'text/csv') {
          const text = buf.toString('utf8');
          const m = measure(text);
          parsedInline = {
            status: 'parsed',
            chars: text.length,
            bytes: buf.length,
            low: m.low,
            high: m.high,
            unknownParts: []
          };
        } else {
          const est = Math.ceil(buf.length / 4);
          parsedInline = {
            status: 'parsed',
            chars: buf.length,
            bytes: buf.length,
            low: Math.ceil(est * 0.7),
            high: Math.ceil(est * 1.4),
            unknownParts: []
          };
        }
        setFilesCache(inlineCacheKey, parsedInline);
        results.set(item.uri, parsedInline);
        continue;
      }
      if (!item.uri || /^https?:/i.test(item.uri)) throw new Error('无可用本地附件，内容未知');
      const targetPath = item.uri.startsWith('file:') ? fileURLToPath(item.uri) : item.uri;
      if (!fs.existsSync(targetPath)) throw new Error('附件文件不存在或已移动');
      const target = fs.realpathSync(targetPath);
      const stat = fs.statSync(target);
      if (!stat.isFile()) throw new Error('附件不是普通文件');
      const key = `${target.toLowerCase()}|${stat.size}|${stat.mtimeMs}`;
      if (filesCache.has(key)) results.set(item.uri, filesCache.get(key));
      else work.push({ key: item.uri, path: target, cacheKey: key });
    } catch (e) { results.set(item.uri, { ...empty(), status: 'unknown', unknownParts: [item.reason || e.message] }); }
  }
  if (work.length) {
    try {
      const parsed = await pythonScan(work.map(({ key, path }) => ({ key, path })));
      for (const result of parsed) { const job = work.find(w => w.key === result.key); if (job) { setFilesCache(job.cacheKey, result); results.set(job.key, result); } }
    } catch (e) { for (const job of work) results.set(job.key, { ...empty(), status: 'unknown', unknownParts: [e.message] }); }
  }
  return media.map(item => ({ ...item, ...(results.get(item.uri) || { ...empty(), status: 'unknown', unknownParts: ['未返回附件统计'] }), uri: undefined, key: undefined }));
}
async function collect(origin, id, options = {}) {
  if (!/^https:\/\/127\.0\.0\.1:\d+$/.test(origin) || !/^[a-f\d-]{36}$/i.test(id)) throw new Error('无效本机会话');
  const key = `${origin}/${id}`;
  const previous = conversations.get(key);
  if (previous?.pending) return previous.pending;
  if (options.force) filesCache.clear();
  if (!options.force && previous?.result && Date.now() - previous.at < 12000) return previous.result;
  const task = (async () => {
    const html = await request(origin);
    const token = JSON.parse(html.match(/window.__APP_CONFIG__ = (.*?);/)[1]).csrfToken;
    const call = (method, body) => request(origin, method, body, token);
    const full = await call('GetCascadeTrajectory', { cascadeId: id, trajectoryVerbosity: 3 });
    const trajectory = full.trajectory;
    if (!trajectory) throw new Error('未取得会话历史，无法完整统计');
    const steps = trajectory.steps || [];
    const expected = Number(full.numTotalSteps ?? steps.length);
    while (steps.length < expected) {
      const page = await call('GetCascadeTrajectorySteps', { cascadeId: id, stepOffset: steps.length, trajectoryVerbosity: 3 });
      if (!page.steps?.length) throw new Error(`历史仅取得 ${steps.length}/${expected} 步，扫描未完成`);
      steps.push(...page.steps);
    }
    const session = analyzeSteps(steps);
    const attachments = await scanFiles(session.media);
    const attachmentTotal = empty();
    for (const a of attachments) { const n = a.references || 1; add(attachmentTotal, Object.fromEntries(['chars', 'bytes', 'low', 'high'].map(k => [k, (a[k] || 0) * n]))); }
    const total = add({ ...session.total }, attachmentTotal);
    let latest = null;
    const count = Number(full.numTotalGeneratorMetadata ?? trajectory.generatorMetadata?.length ?? 0);
    const tail = await call('GetCascadeTrajectoryGeneratorMetadata', { cascadeId: id, generatorMetadataOffset: Math.max(0, count - 3), includeMessages: false });
    let latestModel = null;
    for (const m of (tail.generatorMetadata || []).slice().reverse()) { latest = summarize(m); if (latest) { latestModel = m.chatModel; break; } }
    const system = latestModel ? measure((latestModel.promptSections || []).map(p => p.content || '').join('\n') || latestModel.systemPrompt || '') : empty();
    const definitions = latestModel ? measure(JSON.stringify(latestModel.tools || [])) : empty();
    session.groups.system = system; session.groups.definitions = definitions;
    add(total, system); add(total, definitions);
    if (session.currentError) {
      const fromStep = summarize({ chatModel: { retryInfos: [{ error: session.currentError.text }] } });
      if (fromStep?.error) latest = { ...(latest || {}), error: fromStep.error, exceeded: fromStep.exceeded, serviceLimit: fromStep.serviceLimit || latest?.serviceLimit || null, status: fromStep.status, actual: null, percent: null, estimated: true };
    }
    const unknownFiles = attachments.filter(a => a.status !== 'parsed').length;
    const result = { version: '2.2.0', conversation: id, latest, session: { ...session, media: undefined, attachmentTotal, total, attachments, unknownFiles, complete: unknownFiles === 0, scope: '全量可读取历史 + 上传附件 + 当前系统提示与工具定义；不将每轮重复输入累加；非服务端分词结果' }, scannedAt: Date.now(), errors: [] };
    conversations.set(key, { result, at: Date.now() });
    return result;
  })();
  conversations.set(key, { ...previous, pending: task });
  try { return await task; } catch (e) { conversations.delete(key); throw e; }
}

const fsp = fs.promises;
const TOKEN_HISTORY_TTL_MS = 45000;
let cachedTokenHistory = null;
let cachedTokenHistoryAt = 0;
let pendingTokenHistory = null;
let cachedArchiveState = { path: '', mtimeMs: 0, size: 0, data: null };
let cachedConvDirState = { path: '', mtimeMs: 0, pbCount: 0, earliestDate: null };
let memoryFileIndex = new Map();

function formatLocalDateKey(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseTranscriptText(content) {
  const daily = {};
  let earliestDate = null;
  let fileDateKey = null;
  let start = 0;
  const len = content.length;
  while (start < len) {
    let end = content.indexOf('\n', start);
    if (end === -1) end = len;
    const line = content.slice(start, end);
    start = end + 1;
    if (!line) continue;

    let dateKey = null;
    const createdIdx = line.indexOf('"created_at":"');
    if (createdIdx !== -1) {
      const valStart = createdIdx + 14;
      const valEnd = line.indexOf('"', valStart);
      if (valEnd > valStart) {
        const d = new Date(line.slice(valStart, valEnd));
        if (!Number.isNaN(d.getTime())) {
          dateKey = formatLocalDateKey(d);
          fileDateKey = dateKey;
          if (!earliestDate || dateKey < earliestDate) earliestDate = dateKey;
        }
      }
    }

    if (line.includes('"input_tokens":') || line.includes('"output_tokens":') || line.includes('"cache_read_tokens":')) {
      const inp = Number((line.match(/"input_tokens":(\d+)/) || [])[1] || 0);
      const outp = Number((line.match(/"output_tokens":(\d+)/) || [])[1] || 0);
      const cap = Number((line.match(/"cache_read_tokens":(\d+)/) || [])[1] || 0);
      const tot = inp + outp + cap;
      const targetKey = dateKey || fileDateKey;
      if (tot > 0 && targetKey) {
        let rec = daily[targetKey];
        if (!rec) {
          rec = { total: 0, input: 0, output: 0, cache: 0, steps: 0 };
          daily[targetKey] = rec;
        }
        rec.total += tot;
        rec.input += inp;
        rec.output += outp;
        rec.cache += cap;
        rec.steps += 1;
      }
    }
  }
  return { earliestDate, daily };
}

function getAgPaths() {
  const home = process.env.USERPROFILE || os.homedir();
  const agDir = path.join(home, '.gemini', 'antigravity');
  return {
    agDir,
    brainDir: path.join(agDir, 'brain'),
    convDir: path.join(agDir, 'conversations'),
    archivePath: path.join(agDir, 'token_usage_archive_v1.json')
  };
}

function normalizeArchiveObj(raw) {
  const archive = { firstUseDate: null, dailyMap: {}, maxConversations: 0, fileIndex: {} };
  if (raw && typeof raw === 'object') {
    if (typeof raw.firstUseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.firstUseDate)) {
      archive.firstUseDate = raw.firstUseDate;
    }
    if (raw.dailyMap && typeof raw.dailyMap === 'object') {
      archive.dailyMap = raw.dailyMap;
    }
    if (typeof raw.maxConversations === 'number') {
      archive.maxConversations = raw.maxConversations;
    }
    if (raw.fileIndex && typeof raw.fileIndex === 'object') {
      archive.fileIndex = raw.fileIndex;
    }
  }
  return archive;
}

function hydrateMemoryFileIndex(archiveFileIndex) {
  if (!archiveFileIndex || typeof archiveFileIndex !== 'object') return;
  for (const [k, v] of Object.entries(archiveFileIndex)) {
    if (!memoryFileIndex.has(k) && v && typeof v === 'object' && typeof v.size === 'number' && typeof v.mtimeMs === 'number') {
      memoryFileIndex.set(k, v);
    }
  }
}

function mergeDailyTotals(target, srcDaily) {
  if (!srcDaily || typeof srcDaily !== 'object') return;
  for (const [dKey, rec] of Object.entries(srcDaily)) {
    if (!rec || !rec.total) continue;
    let dst = target[dKey];
    if (!dst) {
      dst = { total: 0, input: 0, output: 0, cache: 0, steps: 0 };
      target[dKey] = dst;
    }
    dst.total += rec.total || 0;
    dst.input += rec.input || 0;
    dst.output += rec.output || 0;
    dst.cache += rec.cache || 0;
    dst.steps += rec.steps || 0;
  }
}

function buildTokenHistoryResult(archive, pbCount, pbEarliestDate, scannedDaily, scannedEarliestDate, transcriptCount, nextFileIndex, fileIndexChanged) {
  let earliestDate = archive.firstUseDate || null;
  const registerDate = (dateStr) => {
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      if (!earliestDate || dateStr < earliestDate) earliestDate = dateStr;
    }
  };
  registerDate(pbEarliestDate);
  registerDate(scannedEarliestDate);

  const mergedDaily = {};
  const allKeys = new Set([...Object.keys(archive.dailyMap || {}), ...Object.keys(scannedDaily)]);
  let dailyChanged = false;
  for (const k of Array.from(allKeys).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    registerDate(k);
    const oldRec = archive.dailyMap?.[k];
    const newRec = scannedDaily[k];
    if (newRec && oldRec) {
      const merged = {
        total: Math.max(oldRec.total || 0, newRec.total || 0),
        input: Math.max(oldRec.input || 0, newRec.input || 0),
        output: Math.max(oldRec.output || 0, newRec.output || 0),
        cache: Math.max(oldRec.cache || 0, newRec.cache || 0),
        steps: Math.max(oldRec.steps || 0, newRec.steps || 0)
      };
      if (
        merged.total !== (oldRec.total || 0) ||
        merged.input !== (oldRec.input || 0) ||
        merged.output !== (oldRec.output || 0) ||
        merged.cache !== (oldRec.cache || 0) ||
        merged.steps !== (oldRec.steps || 0)
      ) {
        dailyChanged = true;
      }
      mergedDaily[k] = merged;
    } else {
      if (!oldRec) dailyChanged = true;
      mergedDaily[k] = newRec || oldRec;
    }
  }

  const now = new Date();
  const todayKey = formatLocalDateKey(now);
  const monthPrefix = todayKey.slice(0, 7);
  const yearPrefix = todayKey.slice(0, 4);
  if (!earliestDate) earliestDate = todayKey;

  let grandTotalTokens = 0, totalInputTokens = 0, totalOutputTokens = 0, totalCacheTokens = 0, totalSteps = 0;
  let todayTokens = 0, monthTokens = 0, yearTokens = 0;

  for (const [k, v] of Object.entries(mergedDaily)) {
    if (!v) continue;
    grandTotalTokens += v.total || 0;
    totalInputTokens += v.input || 0;
    totalOutputTokens += v.output || 0;
    totalCacheTokens += v.cache || 0;
    totalSteps += v.steps || 0;
    if (k === todayKey) todayTokens += v.total || 0;
    if (k.startsWith(monthPrefix)) monthTokens += v.total || 0;
    if (k.startsWith(yearPrefix)) yearTokens += v.total || 0;
  }

  const totalConversations = Math.max(archive.maxConversations || 0, transcriptCount, pbCount);
  const out = {
    updatedAt: `${todayKey} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
    firstUseDate: earliestDate,
    summary: {
      grandTotalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCacheTokens,
      todayTokens,
      monthTokens,
      yearTokens,
      totalSteps,
      totalConversations,
      firstUseDate: earliestDate,
      activeDaysCount: Object.keys(mergedDaily).length
    },
    dailyMap: mergedDaily
  };

  const archiveDirty = dailyChanged ||
    fileIndexChanged ||
    earliestDate !== archive.firstUseDate ||
    totalConversations !== (archive.maxConversations || 0) ||
    !archive.fileIndex ||
    Object.keys(archive.fileIndex).length !== Object.keys(nextFileIndex).length;

  const archivePayload = {
    firstUseDate: earliestDate,
    maxConversations: totalConversations,
    updatedAt: out.updatedAt,
    dailyMap: mergedDaily,
    fileIndex: nextFileIndex
  };

  return { out, archiveDirty, archivePayload };
}

function collectTokenHistory(options = {}) {
  if (!options.force && cachedTokenHistory && Date.now() - cachedTokenHistoryAt < TOKEN_HISTORY_TTL_MS) {
    return cachedTokenHistory;
  }
  const { agDir, brainDir, convDir, archivePath } = getAgPaths();
  const fullRescan = options.fullRescan === true;

  let archive = normalizeArchiveObj(null);
  try {
    if (fs.existsSync(archivePath)) {
      const st = fs.statSync(archivePath);
      if (cachedArchiveState.path === archivePath && cachedArchiveState.mtimeMs === st.mtimeMs && cachedArchiveState.size === st.size && cachedArchiveState.data) {
        archive = cachedArchiveState.data;
      } else {
        archive = normalizeArchiveObj(JSON.parse(fs.readFileSync(archivePath, 'utf8')));
        cachedArchiveState = { path: archivePath, mtimeMs: st.mtimeMs, size: st.size, data: archive };
      }
    }
  } catch {}
  if (!fullRescan) hydrateMemoryFileIndex(archive.fileIndex);
  else memoryFileIndex.clear();

  // 1. Check conversations/*.pb timestamps with directory mtime cache
  let pbCount = 0;
  let pbEarliestDate = null;
  try {
    if (fs.existsSync(convDir)) {
      const dirSt = fs.statSync(convDir);
      if (!fullRescan && cachedConvDirState.path === convDir && cachedConvDirState.mtimeMs === dirSt.mtimeMs) {
        pbCount = cachedConvDirState.pbCount;
        pbEarliestDate = cachedConvDirState.earliestDate;
      } else {
        for (const name of fs.readdirSync(convDir)) {
          const p = path.join(convDir, name);
          try {
            const st = fs.statSync(p);
            if (st.isFile()) {
              pbCount++;
              const ts = st.birthtimeMs && st.birthtimeMs > 946684800000 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
              if (ts > 946684800000) {
                const dk = formatLocalDateKey(new Date(ts));
                if (!pbEarliestDate || dk < pbEarliestDate) pbEarliestDate = dk;
              }
            }
          } catch {}
        }
        cachedConvDirState = { path: convDir, mtimeMs: dirSt.mtimeMs, pbCount, earliestDate: pbEarliestDate };
      }
    }
  } catch {}

  // 2. Direct-probe brain/<session>/.system_generated/logs/transcript.jsonl (skips 19k+ non-transcript files)
  const scannedDaily = {};
  let scannedEarliestDate = null;
  const nextFileIndex = {};
  let transcriptCount = 0;
  let fileIndexChanged = false;

  try {
    if (fs.existsSync(brainDir)) {
      for (const entry of fs.readdirSync(brainDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const primary = path.join(brainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
        const fallback = path.join(brainDir, entry.name, 'transcript.jsonl');
        let targetFile = null;
        let st = null;
        try { st = fs.statSync(primary); if (st.isFile()) targetFile = primary; } catch {}
        if (!targetFile) {
          try { st = fs.statSync(fallback); if (st.isFile()) targetFile = fallback; } catch {}
        }
        if (!targetFile || !st) continue;
        transcriptCount++;
        const relKey = entry.name;
        const cached = !fullRescan ? memoryFileIndex.get(relKey) : null;
        let rec;
        if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
          rec = cached;
        } else {
          try {
            const content = fs.readFileSync(targetFile, 'utf8');
            const parsed = parseTranscriptText(content);
            rec = { size: st.size, mtimeMs: st.mtimeMs, earliestDate: parsed.earliestDate, daily: parsed.daily };
            memoryFileIndex.set(relKey, rec);
            fileIndexChanged = true;
          } catch {
            continue;
          }
        }
        nextFileIndex[relKey] = rec;
        if (rec.earliestDate && (!scannedEarliestDate || rec.earliestDate < scannedEarliestDate)) {
          scannedEarliestDate = rec.earliestDate;
        }
        mergeDailyTotals(scannedDaily, rec.daily);
      }
    }
  } catch {}

  const { out, archiveDirty, archivePayload } = buildTokenHistoryResult(
    archive, pbCount, pbEarliestDate, scannedDaily, scannedEarliestDate, transcriptCount, nextFileIndex, fileIndexChanged
  );

  if (archiveDirty) {
    try {
      fs.mkdirSync(agDir, { recursive: true });
      fs.writeFileSync(archivePath, JSON.stringify(archivePayload), 'utf8');
      const st = fs.statSync(archivePath);
      cachedArchiveState = { path: archivePath, mtimeMs: st.mtimeMs, size: st.size, data: normalizeArchiveObj(archivePayload) };
    } catch {}
  }

  cachedTokenHistory = out;
  cachedTokenHistoryAt = Date.now();
  return out;
}

async function collectTokenHistoryAsync(options = {}) {
  if (!options.force && cachedTokenHistory && Date.now() - cachedTokenHistoryAt < TOKEN_HISTORY_TTL_MS) {
    return cachedTokenHistory;
  }
  if (pendingTokenHistory && !options.fullRescan) {
    return pendingTokenHistory;
  }
  const task = (async () => {
    const { agDir, brainDir, convDir, archivePath } = getAgPaths();
    const fullRescan = options.fullRescan === true;

    let archive = normalizeArchiveObj(null);
    try {
      const st = await fsp.stat(archivePath);
      if (cachedArchiveState.path === archivePath && cachedArchiveState.mtimeMs === st.mtimeMs && cachedArchiveState.size === st.size && cachedArchiveState.data) {
        archive = cachedArchiveState.data;
      } else {
        const rawText = await fsp.readFile(archivePath, 'utf8');
        archive = normalizeArchiveObj(JSON.parse(rawText));
        cachedArchiveState = { path: archivePath, mtimeMs: st.mtimeMs, size: st.size, data: archive };
      }
    } catch {}
    if (!fullRescan) hydrateMemoryFileIndex(archive.fileIndex);
    else memoryFileIndex.clear();

    // 1. Check conversations/*.pb timestamps asynchronously with dir mtime cache
    let pbCount = 0;
    let pbEarliestDate = null;
    try {
      const dirSt = await fsp.stat(convDir);
      if (!fullRescan && cachedConvDirState.path === convDir && cachedConvDirState.mtimeMs === dirSt.mtimeMs) {
        pbCount = cachedConvDirState.pbCount;
        pbEarliestDate = cachedConvDirState.earliestDate;
      } else {
        const names = await fsp.readdir(convDir);
        const CONC = 16;
        for (let i = 0; i < names.length; i += CONC) {
          const batch = names.slice(i, i + CONC);
          await Promise.all(batch.map(async name => {
            try {
              const st = await fsp.stat(path.join(convDir, name));
              if (st.isFile()) {
                pbCount++;
                const ts = st.birthtimeMs && st.birthtimeMs > 946684800000 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
                if (ts > 946684800000) {
                  const dk = formatLocalDateKey(new Date(ts));
                  if (!pbEarliestDate || dk < pbEarliestDate) pbEarliestDate = dk;
                }
              }
            } catch {}
          }));
        }
        cachedConvDirState = { path: convDir, mtimeMs: dirSt.mtimeMs, pbCount, earliestDate: pbEarliestDate };
      }
    } catch {}

    // 2. Direct-probe brain/<session>/.system_generated/logs/transcript.jsonl asynchronously
    const scannedDaily = {};
    let scannedEarliestDate = null;
    const nextFileIndex = {};
    let transcriptCount = 0;
    let fileIndexChanged = false;

    try {
      const entries = await fsp.readdir(brainDir, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory());
      const toParse = [];
      const STAT_CONC = 16;
      for (let i = 0; i < dirs.length; i += STAT_CONC) {
        const batch = dirs.slice(i, i + STAT_CONC);
        await Promise.all(batch.map(async entry => {
          const primary = path.join(brainDir, entry.name, '.system_generated', 'logs', 'transcript.jsonl');
          const fallback = path.join(brainDir, entry.name, 'transcript.jsonl');
          let targetFile = null;
          let st = null;
          try { st = await fsp.stat(primary); if (st.isFile()) targetFile = primary; } catch {}
          if (!targetFile) {
            try { st = await fsp.stat(fallback); if (st.isFile()) targetFile = fallback; } catch {}
          }
          if (!targetFile || !st) return;
          transcriptCount++;
          const relKey = entry.name;
          const cached = !fullRescan ? memoryFileIndex.get(relKey) : null;
          if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
            nextFileIndex[relKey] = cached;
            if (cached.earliestDate && (!scannedEarliestDate || cached.earliestDate < scannedEarliestDate)) {
              scannedEarliestDate = cached.earliestDate;
            }
            mergeDailyTotals(scannedDaily, cached.daily);
          } else {
            toParse.push({ relKey, targetFile, size: st.size, mtimeMs: st.mtimeMs });
          }
        }));
      }

      // Only parse changed/new transcript files in small async batches, yielding to the event loop between batches
      const PARSE_CONC = 6;
      for (let i = 0; i < toParse.length; i += PARSE_CONC) {
        const batch = toParse.slice(i, i + PARSE_CONC);
        await Promise.all(batch.map(async job => {
          try {
            const content = await fsp.readFile(job.targetFile, 'utf8');
            const parsed = parseTranscriptText(content);
            const rec = { size: job.size, mtimeMs: job.mtimeMs, earliestDate: parsed.earliestDate, daily: parsed.daily };
            memoryFileIndex.set(job.relKey, rec);
            nextFileIndex[job.relKey] = rec;
            fileIndexChanged = true;
            if (rec.earliestDate && (!scannedEarliestDate || rec.earliestDate < scannedEarliestDate)) {
              scannedEarliestDate = rec.earliestDate;
            }
            mergeDailyTotals(scannedDaily, rec.daily);
          } catch {}
        }));
        if (i + PARSE_CONC < toParse.length) {
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    } catch {}

    const { out, archiveDirty, archivePayload } = buildTokenHistoryResult(
      archive, pbCount, pbEarliestDate, scannedDaily, scannedEarliestDate, transcriptCount, nextFileIndex, fileIndexChanged
    );

    if (archiveDirty) {
      try {
        await fsp.mkdir(agDir, { recursive: true });
        await fsp.writeFile(archivePath, JSON.stringify(archivePayload), 'utf8');
        const st = await fsp.stat(archivePath);
        cachedArchiveState = { path: archivePath, mtimeMs: st.mtimeMs, size: st.size, data: normalizeArchiveObj(archivePayload) };
      } catch {}
    }

    cachedTokenHistory = out;
    cachedTokenHistoryAt = Date.now();
    return out;
  })();

  pendingTokenHistory = task;
  try {
    return await task;
  } finally {
    if (pendingTokenHistory === task) pendingTokenHistory = null;
  }
}

module.exports = { collect, collectTokenHistory, collectTokenHistoryAsync, scanFiles, pythonScan, resolvePython };
