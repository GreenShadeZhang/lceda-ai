/**
 * app.js — IFrame 应用主逻辑
 *
 * 认证流程：OAuth 2.0 Device Authorization Grant (RFC 8628)
 *   1. 启动时检查持久化存储，有 token 直接进入应用
 *   2. 无 token：点击登录 → POST Keycloak /auth/device 获取设备码
 *   3. 展示 QR 码 + 用户验证码，用户用手机或电脑浏览器授权
 *   4. 轮询 /token 端点（携带 device_code）
 *   5. 授权成功 → 保存 token 进入应用界面
 *
 * 静默刷新：access_token 过期前 60s 自动通过 refresh_token 刷新
 * 参考：xiaozhi-esp32/main/keycloak_auth.cc + mcp_server.cc
 *
 * Story 3.1: AI 对话界面与 SSE 流式响应
 *   - 对话输入框 + 生成按钮
 *   - POST /api/schematics/generate (SSE 流式响应)
 *   - 实时展示 AI 处理进度
 *   - 接收 circuitJson 后通过 eda.sys_MessageBus 发送给主线程
 *   - 主线程（index.ts）调用 EDA SDK 放置元件
 */

import QRCode from 'qrcode';

// ---------------------------------------------------------------------------
// 配置常量
// ---------------------------------------------------------------------------
const KEYCLOAK_AUTHORITY   = 'https://auth.verdure-hiro.cn/realms/maker-community';
const CLIENT_ID            = 'lceda-ai';
const DEVICE_AUTH_ENDPOINT = `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/auth/device`;
const TOKEN_ENDPOINT       = `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/token`;

// 后端 AI 服务地址（TODO: 替换为生产环境 URL）
const BACKEND_API = 'http://localhost:5267';

// MessageBus 主题（与 src/messageTypes.ts 保持一致）
const MSG_GENERATE_REQUEST = 'GENERATE_REQUEST';
const MSG_GENERATE_RESULT  = 'GENERATE_RESULT';
const MSG_GENERATE_ERROR   = 'GENERATE_ERROR';
const MSG_DEBUG_INSPECT    = 'DEBUG_INSPECT';
const MSG_DEBUG_RESULT     = 'DEBUG_RESULT';
const MSG_CLEAR_CANVAS     = 'CLEAR_CANVAS';
const MSG_CLEAR_RESULT     = 'CLEAR_RESULT';

let currentAccessToken  = null;
let currentRefreshToken = null;
let refreshTimer        = null;
let pollAbort           = false;
let isGenerating        = false;
let generateTaskCleanup = null;
let currentSessionId    = null;

// ---------------------------------------------------------------------------
// 调试日志
// ---------------------------------------------------------------------------
function dbg(...args) {
  const msg = args.map(a => {
    if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  console.log('[ai-sch]', msg);
  try {
    const el = document.getElementById('debug-log');
    if (el) {
      const line = document.createElement('div');
      line.textContent = '» ' + msg;
      el.appendChild(line);
      el.scrollTop = el.scrollHeight;
    }
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// 持久化存储（优先 eda.sys_Storage，降级 localStorage）
// ---------------------------------------------------------------------------
function getStoredTokens() {
  try {
    const at = eda.sys_Storage.getExtensionUserConfig('ai_sch_access_token') || null;
    const rt = eda.sys_Storage.getExtensionUserConfig('ai_sch_refresh_token') || null;
    return { accessToken: at, refreshToken: rt };
  } catch (_) {}
  return {
    accessToken:  localStorage.getItem('ai_sch_access_token'),
    refreshToken: localStorage.getItem('ai_sch_refresh_token'),
  };
}

function saveTokens(at, rt) {
  try {
    eda.sys_Storage.setExtensionUserConfig('ai_sch_access_token',  at);
    eda.sys_Storage.setExtensionUserConfig('ai_sch_refresh_token', rt || '');
    return;
  } catch (_) {}
  localStorage.setItem('ai_sch_access_token',  at);
  localStorage.setItem('ai_sch_refresh_token', rt || '');
}

function clearStoredTokens() {
  try {
    eda.sys_Storage.setExtensionUserConfig('ai_sch_access_token',  '');
    eda.sys_Storage.setExtensionUserConfig('ai_sch_refresh_token', '');
    return;
  } catch (_) {}
  localStorage.removeItem('ai_sch_access_token');
  localStorage.removeItem('ai_sch_refresh_token');
}

function showEdaToast(message, type = 1) {
  try { eda.sys_ToastMessage.showMessage(message, type); return; } catch (_) {}
  console.warn('[Toast]', message);
}

// ---------------------------------------------------------------------------
// UI 区块切换
// ---------------------------------------------------------------------------
const SECTIONS = ['loading-section', 'login-section', 'device-section', 'app-section'];

function showSection(id) {
  SECTIONS.forEach(s => {
    document.getElementById(s).style.display = s === id ? 'flex' : 'none';
  });
}

function showLoading()  { showSection('loading-section'); }
function showLoginUI()  { pollAbort = true; showSection('login-section'); }

function showAppUI(at, rt) {
  currentAccessToken  = at;
  currentRefreshToken = rt || null;
  showSection('app-section');
  scheduleTokenRefresh(at);
  setupAppEventListeners();
  loadSessions();
}

// ---------------------------------------------------------------------------
// 步骤 1：请求设备码
// ---------------------------------------------------------------------------
async function initiateDeviceFlow() {
  pollAbort = false;
  showLoading();
  dbg('device flow: requesting device code...');
  try {
    const res = await fetch(DEVICE_AUTH_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `client_id=${encodeURIComponent(CLIENT_ID)}`,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`设备授权失败 HTTP ${res.status}: ${errText.slice(0, 120)}`);
    }
    const data = await res.json();
    dbg('device code:', { user_code: data.user_code, expires_in: data.expires_in });

    const qrUrl   = data.verification_uri_complete || data.verification_uri;
    const openUrl = data.verification_uri;

    await renderDeviceSection(data.user_code, qrUrl, openUrl);
    await pollLoop(data.device_code, data.interval || 5, data.expires_in || 300);
  } catch (e) {
    dbg('device flow error:', e);
    showEdaToast('登录失败：' + (e.message || String(e)), 0);
    showLoginUI();
  }
}

// ---------------------------------------------------------------------------
// 步骤 2：展示 QR 码页面
// ---------------------------------------------------------------------------
async function renderDeviceSection(userCode, qrUrl, openUrl) {
  showSection('device-section');
  setDeviceStatus('等待扫码授权...');
  document.getElementById('user-code-display').textContent = userCode;

  try {
    const dataUrl = await QRCode.toDataURL(qrUrl, {
      width:  180,
      margin: 2,
      color:  { dark: '#89b4fa', light: '#1e1e2e' },
    });
    const img         = document.getElementById('qr-image');
    img.src           = dataUrl;
    img.style.display = 'block';
  } catch (e) {
    dbg('QR render failed:', e);
  }

  document.getElementById('btn-open-browser').onclick = () => openInBrowser(openUrl);
}

function setDeviceStatus(msg) {
  const el = document.getElementById('device-status');
  if (el) el.textContent = msg;
}

function openInBrowser(url) {
  try   { eda.sys_Window.open(url); }
  catch { try { window.open(url, '_blank'); } catch (_) {} }
}

// ---------------------------------------------------------------------------
// 步骤 3：轮询 token（参考 esp32 keycloak_auth.cc PollToken）
// ---------------------------------------------------------------------------
async function pollLoop(deviceCode, interval, expiresIn) {
  const maxAttempts = Math.ceil(expiresIn / interval);
  dbg(`poll: maxAttempts=${maxAttempts}, interval=${interval}s`);

  for (let i = 0; i < maxAttempts; i++) {
    if (pollAbort) { dbg('poll: aborted'); return; }

    if (i > 0) {
      for (let t = interval; t > 0; t--) {
        if (pollAbort) return;
        setDeviceStatus(`等待授权... 约剩 ${(maxAttempts - i) * interval}s`);
        await sleep(1000);
      }
      if (pollAbort) return;
    }

    setDeviceStatus(`检查验证... (${i + 1}/${maxAttempts})`);

    try {
      const res  = await fetch(TOKEN_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({
          grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
          client_id:   CLIENT_ID,
          device_code: deviceCode,
        }),
      });
      const json = await res.json();

      if (res.status === 200 && json.access_token) {
        dbg('poll: token obtained!');
        saveTokens(json.access_token, json.refresh_token || '');
        showEdaToast('登录成功！');
        showAppUI(json.access_token, json.refresh_token);
        return;
      }

      if (res.status === 400) {
        const errCode = json.error;
        if (errCode === 'authorization_pending' || errCode === 'slow_down') continue;
        throw new Error(json.error_description || errCode || '授权失败');
      }

      throw new Error(`轮询异常 HTTP ${res.status}`);

    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to fetch')) {
        dbg(`poll ${i + 1}: 网络错误，继续`, msg);
        continue;
      }
      dbg('poll: fatal:', e);
      showEdaToast('授权失败：' + msg, 0);
      showLoginUI();
      return;
    }
  }

  dbg('poll: timeout');
  showEdaToast('登录超时，请重新尝试', 0);
  showLoginUI();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// 静默刷新
// ---------------------------------------------------------------------------
function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.exp ? payload.exp * 1000 : null;
  } catch { return null; }
}

function scheduleTokenRefresh(token) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expiry = getTokenExpiry(token);
  if (!expiry) return;
  const delay = Math.max(expiry - Date.now() - 60_000, 0);
  refreshTimer = setTimeout(doSilentRefresh, delay);
}

async function doSilentRefresh() {
  if (!currentRefreshToken) { showLoginUI(); return; }
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     CLIENT_ID,
        refresh_token: currentRefreshToken,
      }),
    });
    if (!res.ok) throw new Error(`refresh ${res.status}`);
    const data = await res.json();
    if (!data.access_token) throw new Error('no access_token in refresh');
    const newRt = data.refresh_token || currentRefreshToken;
    saveTokens(data.access_token, newRt);
    currentAccessToken  = data.access_token;
    currentRefreshToken = newRt;
    scheduleTokenRefresh(data.access_token);
  } catch (e) {
    dbg('silent refresh failed:', e);
    currentAccessToken = currentRefreshToken = null;
    if (refreshTimer) clearTimeout(refreshTimer);
    clearStoredTokens();
    showEdaToast('登录已过期，请重新登录', 0);
    showLoginUI();
  }
}

// ---------------------------------------------------------------------------
// Story 3.1 / 4.5: 面板切换
// ---------------------------------------------------------------------------
function showChatPanel() {
  document.getElementById('chat-messages').style.display = '';
  document.getElementById('session-panel').classList.remove('visible');
  document.querySelector('.input-area').style.display = '';
  document.getElementById('gen-status').style.display = '';
  document.getElementById('tab-chat').classList.add('active');
  document.getElementById('tab-sessions').classList.remove('active');
}

function showSessionPanel() {
  document.getElementById('chat-messages').style.display = 'none';
  document.getElementById('session-panel').classList.add('visible');
  document.querySelector('.input-area').style.display = 'none';
  document.getElementById('gen-status').style.display = 'none';
  document.getElementById('tab-chat').classList.remove('active');
  document.getElementById('tab-sessions').classList.add('active');
}

async function loadSessions() {
  const listEl = document.getElementById('session-list');
  if (listEl) listEl.innerHTML = '<div class="session-empty">正在加载会话...</div>';

  try {
    const res = await fetch(`${BACKEND_API}/api/sessions?pageSize=20&pageIndex=1`, {
      headers: { 'Authorization': `Bearer ${currentAccessToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || '请求失败');

    const sessions = json.data?.items || [];
    renderSessionList(sessions);

    // 自动选中最新一条会话并加载其历史
    if (sessions.length > 0) {
      await selectSession(sessions[0], false);
    }
  } catch (e) {
    dbg('loadSessions error:', e);
    if (listEl) listEl.innerHTML = `<div class="session-empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

function renderSessionList(sessions) {
  const listEl = document.getElementById('session-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (sessions.length === 0) {
    listEl.innerHTML = '<div class="session-empty">暂无会话，点击「新建对话」开始</div>';
    return;
  }
  sessions.forEach(s => listEl.appendChild(buildSessionItem(s)));
}

function buildSessionItem(session) {
  const item = document.createElement('div');
  item.className = 'session-item' + (session.id === currentSessionId ? ' active' : '');
  item.dataset.sessionId = session.id;
  const date = new Date(session.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  item.innerHTML = `<div class="session-title">${escapeHtml(session.title)}</div><div class="session-date">${escapeHtml(date)}</div>`;
  item.addEventListener('click', () => selectSession(session, true));
  return item;
}

async function selectSession(session, switchToChat = true) {
  currentSessionId = session.id;

  // 更新会话列表高亮
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.dataset.sessionId === session.id);
  });

  // 更新会话指示栏
  const indicator = document.getElementById('session-indicator');
  if (indicator) indicator.textContent = session.title;
  const bar = document.getElementById('session-indicator-bar');
  if (bar) bar.classList.add('visible');

  // 加载会话历史并切换到对话面板
  await loadSessionHistory(session.id);
  if (switchToChat) showChatPanel();
}

async function loadSessionHistory(sessionId) {
  const chatEl = document.getElementById('chat-messages');
  if (!chatEl) return;
  chatEl.innerHTML = '';

  try {
    const res = await fetch(`${BACKEND_API}/api/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { 'Authorization': `Bearer ${currentAccessToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || '请求失败');

    const histories = json.data?.histories || [];
    histories.forEach(h => {
      appendUserMessage(h.userInput);
      const bubble = appendAiMessageElement();
      updateBubble(bubble, h.isSuccess ? '✅ 原理图生成成功' : '❌ 生成失败', !h.isSuccess);
    });
    chatEl.scrollTop = chatEl.scrollHeight;
  } catch (e) {
    dbg('loadSessionHistory error:', e);
  }
}

async function createNewSession() {
  const btn = document.getElementById('session-new-btn');
  if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }
  try {
    const res = await fetch(`${BACKEND_API}/api/sessions`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${currentAccessToken}`,
        'Content-Type':  'application/json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error?.message || '创建失败');

    const session = json.data;
    const listEl  = document.getElementById('session-list');
    // 删除空状提示
    const emptyEl = listEl?.querySelector('.session-empty');
    if (emptyEl) emptyEl.remove();
    listEl?.prepend(buildSessionItem(session));

    await selectSession(session, true);
    // 清空新建会话的内容
    const chatEl = document.getElementById('chat-messages');
    if (chatEl) chatEl.innerHTML = '';
    setGenStatus('');
    showEdaToast('新建会话成功');
  } catch (e) {
    dbg('createNewSession error:', e);
    showEdaToast('新建会话失败：' + (e.message || String(e)), 0);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '＋ 新建对话'; }
  }
}

// ---------------------------------------------------------------------------
// Story 3.1: 应用 UI 事件
// ---------------------------------------------------------------------------
let appListenersSetup = false;

function setupAppEventListeners() {
  if (appListenersSetup) return;
  appListenersSetup = true;

  document.getElementById('generate-btn').addEventListener('click', handleGenerate);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('btn-inspect').addEventListener('click', handleInspect);
  document.getElementById('btn-clear').addEventListener('click', handleClear);
  document.getElementById('user-input').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleGenerate();
  });

  document.getElementById('tab-chat').addEventListener('click', showChatPanel);
  document.getElementById('tab-sessions').addEventListener('click', showSessionPanel);
  document.getElementById('session-new-btn').addEventListener('click', createNewSession);
}

async function handleGenerate() {
  if (isGenerating) return;
  const input = document.getElementById('user-input');
  const text  = (input.value || '').trim();
  if (!text) { showEdaToast('请输入电路需求描述', 0); return; }

  appendUserMessage(text);
  input.value = '';
  await sendGenerateRequest(text);
}

function handleLogout() {
  currentAccessToken = currentRefreshToken = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  if (generateTaskCleanup) { generateTaskCleanup(); generateTaskCleanup = null; }
  clearStoredTokens();
  appListenersSetup = false;
  const chatEl = document.getElementById('chat-messages');
  if (chatEl) chatEl.innerHTML = '';
  showEdaToast('已退出登录');
  showLoginUI();
}

async function handleInspect() {
  const btn = document.getElementById('btn-inspect');
  btn.disabled = true;
  btn.textContent = '检查中...';

  const bubbleEl = appendAiMessageElement();
  updateBubble(bubbleEl, '🔍 正在检查画布元件...');

  try {
    eda.sys_MessageBus.publish(MSG_DEBUG_INSPECT, {});
  } catch (e) {
    updateBubble(bubbleEl, '❗ MessageBus 发布失败: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = '🔍 检查';
    return;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      updateBubble(bubbleEl, '❗ 检查超时（主线程未响应）', true);
      resolve(undefined);
    }, 8000);

    try {
      eda.sys_MessageBus.subscribeOnce(MSG_DEBUG_RESULT, (data) => {
        clearTimeout(timer);
        if (data?.error) {
          updateBubble(bubbleEl, '❗ 检查出错: ' + data.error, true);
        } else {
          const text = formatInspectResult(data);
          updateBubble(bubbleEl, text);
          console.log('[DEBUG_INSPECT] 完整数据:', JSON.stringify(data, null, 2));
        }
        resolve(undefined);
      });
    } catch (e) {
      clearTimeout(timer);
      updateBubble(bubbleEl, '❗ 订阅失败: ' + e.message, true);
      resolve(undefined);
    }
  });

  btn.disabled = false;
  btn.textContent = '🔍 检查';
}

async function handleClear() {
  const btn = document.getElementById('btn-clear');
  btn.disabled = true;
  btn.textContent = '清除中...';

  const bubbleEl = appendAiMessageElement();
  updateBubble(bubbleEl, '🗑️ 正在清除画布...');

  try {
    eda.sys_MessageBus.publish(MSG_CLEAR_CANVAS, {});
  } catch (e) {
    updateBubble(bubbleEl, '❗ 清除失败: ' + e.message, true);
    btn.disabled = false;
    btn.textContent = '🗑️ 清除';
    return;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      updateBubble(bubbleEl, '❗ 清除超时（主线程未响应）', true);
      resolve(undefined);
    }, 10000);

    try {
      eda.sys_MessageBus.subscribeOnce(MSG_CLEAR_RESULT, (data) => {
        clearTimeout(timer);
        if (data?.success) {
          updateBubble(bubbleEl, `✅ 画布已清除：${data.components || 0} 个元件, ${data.wires || 0} 条导线, ${data.pins || 0} 个引脚`);
        } else {
          updateBubble(bubbleEl, '❗ 清除失败: ' + (data?.error || '未知错误'), true);
        }
        resolve(undefined);
      });
    } catch (e) {
      clearTimeout(timer);
      updateBubble(bubbleEl, '❗ 订阅失败: ' + e.message, true);
      resolve(undefined);
    }
  });

  btn.disabled = false;
  btn.textContent = '🗑️ 清除';
}

function formatInspectResult(data) {
  const s = data.summary || {};
  let text = `🔍 画布检查结果\n`;
  text += `────────────────────\n`;
  text += `元件: ${s.components || 0}  引脚: ${s.totalPins || 0}  导线: ${s.wires || 0}  网络标识: ${s.netFlags || 0}\n\n`;

  for (const comp of data.components || []) {
    text += `📦 ${comp.designator || '?'} (${comp.name || '?'}) @ (${comp.x}, ${comp.y}) rot=${comp.rotation}\n`;
    text += `   LCSC: ${comp.supplierId || '-'}\n`;
    for (const pin of comp.pins || []) {
      text += `   └ Pin ${pin.number} [${pin.name}] @ (${pin.x}, ${pin.y})\n`;
    }
  }

  if ((data.wires || []).length > 0) {
    text += `\n🔗 导线:\n`;
    for (const w of data.wires) {
      const pts = Array.isArray(w.line) ? JSON.stringify(w.line) : '-';
      text += `   net=${w.net || '?'}  points=${pts}\n`;
    }
  }

  if ((data.netFlags || []).length > 0) {
    text += `\n🏷️ 网络标识:\n`;
    for (const nf of data.netFlags) {
      text += `   ${nf.name || nf.number || '?'} @ (${nf.x}, ${nf.y})\n`;
    }
  }

  text += `\nℹ️ 完整数据已输出到控制台 (F12)`;
  return text;
}

// ---------------------------------------------------------------------------
// Chat UI 帮助函数
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function appendUserMessage(text) {
  const chatEl = document.getElementById('chat-messages');
  if (!chatEl) return;
  const msg = document.createElement('div');
  msg.className = 'chat-msg chat-msg-user';
  msg.innerHTML = `<span class="chat-bubble">${escapeHtml(text)}</span>`;
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function appendAiMessageElement() {
  const chatEl = document.getElementById('chat-messages');
  if (!chatEl) return null;
  const msg     = document.createElement('div');
  msg.className = 'chat-msg chat-msg-ai';
  const bubble  = document.createElement('span');
  bubble.className = 'chat-bubble';
  bubble.textContent = '...';
  msg.appendChild(bubble);
  chatEl.appendChild(msg);
  chatEl.scrollTop = chatEl.scrollHeight;
  return bubble;
}

function updateBubble(bubbleEl, text, isError = false) {
  if (!bubbleEl) return;
  bubbleEl.className = 'chat-bubble' + (isError ? ' error' : '');
  bubbleEl.innerHTML = escapeHtml(text);
  const chatEl = document.getElementById('chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

function setGenStatus(msg) {
  const el = document.getElementById('gen-status');
  if (el) el.textContent = msg;
}

function setGeneratingState(generating) {
  isGenerating = generating;
  const btn = document.getElementById('generate-btn');
  if (!btn) return;
  btn.disabled   = generating;
  btn.textContent = generating ? '生成中...' : '生成原理图';
  setGenStatus(generating ? '正在处理...' : '');
}

// ---------------------------------------------------------------------------
// Story 3.1: 调用后端 SSE 流式 API
// ---------------------------------------------------------------------------
async function sendGenerateRequest(userInput) {
  setGeneratingState(true);
  const bubbleEl = appendAiMessageElement();

  try {
    const res = await fetch(`${BACKEND_API}/api/schematics/generate`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${currentAccessToken}`,
        'Accept':        'text/event-stream',
      },
      body: JSON.stringify({ userInput, ...(currentSessionId ? { sessionId: currentSessionId } : {}) }),
    });

    if (res.status === 401) {
      updateBubble(bubbleEl, '登录已过期，请重新登录', true);
      clearStoredTokens();
      showLoginUI();
      return;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API 错误 HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      await handleSSEStream(res.body, bubbleEl);
    } else {
      const data = await res.json();
      await handleJsonResponse(data, bubbleEl);
    }

  } catch (e) {
    dbg('generate error:', e);
    const isNetworkErr = e.message.includes('Failed to fetch') ||
                         e.message.includes('NetworkError') ||
                         e.message.includes('net::');
    const errMsg = isNetworkErr
      ? `无法连接到后端服务（${BACKEND_API}）\n请确认后端已启动并监听该地址`
      : `生成失败：${e.message}`;
    updateBubble(bubbleEl, errMsg, true);
    showEdaToast('原理图生成失败', 0);
  } finally {
    setGeneratingState(false);
    setGenStatus('');
  }
}

// ---------------------------------------------------------------------------
// SSE 流式响应处理
// ---------------------------------------------------------------------------
async function handleSSEStream(body, bubbleEl) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let   buffer      = '';
  let   displayText = '';
  let   circuitJson = null;
  let   isTextOnly  = false;  // FR-10: 现代协议 text 事件标记

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 留下不完整的最后一行

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const dataStr = line.slice(5).trim();
        if (dataStr === '[DONE]') { buffer = ''; break; }

        try {
          const event = JSON.parse(dataStr);
          if (event.eventType === 'text') {
            // FR-10: 现代协议 —— 纲文字回复，不触发 EDA SDK
            isTextOnly = true;
            if (event.text) {
              displayText += (displayText ? '\n' : '') + event.text;
              updateBubble(bubbleEl, displayText);
              setGenStatus(event.text.slice(0, 50));
            }
          } else if (event.eventType === 'schematic' && event.circuitJson) {
            // FR-10: 现代协议 —— 原理图响应，触发 EDA SDK
            circuitJson = event.circuitJson;
          } else if (event.type === 'progress' && event.text) {
            // 旧协议展居层
            displayText += (displayText ? '\n' : '') + event.text;
            updateBubble(bubbleEl, displayText);
            setGenStatus(event.text.slice(0, 50));
          } else if (event.type === 'complete' && event.circuitJson) {
            // 旧协议展居层
            circuitJson = event.circuitJson;
          } else if (event.type === 'error') {
            throw new Error(event.message || '后端返回错误');
          }
        } catch (parseErr) {
          // 忽略非 JSON 行，但重新抛出业务错误
          if (parseErr.message && parseErr.message !== '后端返回错误' &&
              parseErr.name !== 'SyntaxError') {
            throw parseErr;
          }
          if (parseErr.name !== 'SyntaxError') throw parseErr;
          dbg('SSE parse warning:', dataStr.slice(0, 80));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // FR-10: 纲文字响应无需 EDA SDK 渲染
  if (isTextOnly && !circuitJson) {
    setGenStatus('');
    return;
  }

  if (!circuitJson) throw new Error('响应未包含电路 JSON（circuitJson 字段缺失）');
  await notifyMainThreadToPlace(circuitJson, bubbleEl, displayText);
}

// ---------------------------------------------------------------------------
// 非流式 JSON 响应处理
// ---------------------------------------------------------------------------
async function handleJsonResponse(data, bubbleEl) {
  if (!data.success) {
    throw new Error(data.error?.message || '后端返回失败');
  }
  const circuitJson = data.data?.circuitJson;
  if (!circuitJson) throw new Error('响应中未包含 circuitJson 字段');
  await notifyMainThreadToPlace(circuitJson, bubbleEl, '');
}

// ---------------------------------------------------------------------------
// Story 3.4: 通过 eda.sys_MessageBus 通知主线程放置元件
// 主线程（index.ts）订阅 GENERATE_REQUEST 并调用 EDA SDK
// IFrame → 主线程 MessageBus 是单向的；采用非阻塞模式，5s 内有回复则更新 UI，超时也不报错
// ---------------------------------------------------------------------------
async function notifyMainThreadToPlace(circuitJson, bubbleEl, prevText) {
  dbg('publishing GENERATE_REQUEST to MessageBus...');
  const compCount = (circuitJson.components || []).length;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  try {
    eda.sys_MessageBus.publish(MSG_GENERATE_REQUEST, { requestId, circuitJson });
  } catch (e) {
    dbg('MessageBus publish failed:', e);
    throw new Error('无法发送给主线程（MessageBus 不可用）: ' + e.message);
  }

  updateBubble(bubbleEl, (prevText ? prevText + '\n' : '') +
    `电路解析完成（${compCount} 个元件），正在放置到画布...`);
  setGenStatus('正在放置元件...');

  // 非阻塞等待主线程结果（至多 5 秒）；超时视为成功，主线程已独立完成放置
  let gotResponse = false;
  await new Promise((resolve) => {
    let resultSub = null;
    let errorSub = null;

    const cleanup = () => {
      try { if (resultSub) resultSub.cancel(); } catch (_) {}
      try { if (errorSub) errorSub.cancel(); } catch (_) {}
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 5_000);

    try {
      resultSub = eda.sys_MessageBus.subscribe(MSG_GENERATE_RESULT, (result) => {
        if (result?.requestId && result.requestId !== requestId) return;
        clearTimeout(timer);
        cleanup();
        gotResponse = true;

        if (result?.skipped) {
          const skipLog = Array.isArray(result?.log) && result.log.length > 0
            ? `\n${result.log[0]}`
            : '';
          updateBubble(bubbleEl, (prevText ? prevText + '\n' : '') +
            `ℹ️ 已忽略重复绘制请求。${skipLog}`);
          resolve(undefined);
          return;
        }

        const placed = result?.placedCount ?? compCount;
        const logLines = Array.isArray(result?.log) ? result.log : [];
        const logText = logLines.length > 0 ? '\n\n📋 日志：\n' + logLines.join('\n') : '';
        updateBubble(bubbleEl, (prevText ? prevText + '\n' : '') +
          `✅ 原理图已生成！共放置 ${placed} 个元件。` + logText);
        showEdaToast(`生成成功！放置了 ${placed} 个元件`);
        resolve(undefined);
      });

      errorSub = eda.sys_MessageBus.subscribe(MSG_GENERATE_ERROR, (err) => {
        if (err?.requestId && err.requestId !== requestId) return;
        clearTimeout(timer);
        cleanup();
        gotResponse = true;
        const msg = err?.message || String(err) || '元件放置部分失败';
        updateBubble(bubbleEl, (prevText ? prevText + '\n' : '') +
          `⚠️ 放置时发生错误：${msg}`, true);
        resolve(undefined);
      });
    } catch (e) {
      clearTimeout(timer);
      cleanup();
      resolve(undefined);
    }
  });

  if (!gotResponse) {
    updateBubble(bubbleEl, (prevText ? prevText + '\n' : '') +
      `✅ 原理图已发送（${compCount} 个元件），请查看画布`);
    showEdaToast('原理图已发送到画布');
  }
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------
dbg('app.js: loaded');

document.getElementById('btn-login').addEventListener('click', initiateDeviceFlow);
document.getElementById('btn-cancel-device').addEventListener('click', () => {
  pollAbort = true;
  showLoginUI();
});

(async () => {
  dbg('init: checking stored tokens...');
  showLoading();
  let at = null, rt = null;
  try {
    ({ accessToken: at, refreshToken: rt } = getStoredTokens());
  } catch (e) {
    dbg('getStoredTokens error:', e);
  }
  if (at) {
    dbg('init: → showAppUI');
    showAppUI(at, rt);
  } else {
    dbg('init: → showLoginUI');
    showLoginUI();
  }
})().catch(e => dbg('init error:', e));
