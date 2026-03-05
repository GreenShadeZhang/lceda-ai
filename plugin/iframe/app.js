/**
 * app.js — IFrame 主应用入口（Story 2.1 & 2.2: PKCE 登录流程 + Token 状态管理）
 *
 * 认证流程：
 *   1. 加载时向主线程发送 REQUEST_AUTH_STATUS，请求已持久化的 token
 *   2. 主线程回送 AUTH_TOKEN_SYNC → 有 token 则 showAppUI，无则 showLoginUI
 *   3. 点击「登录」→ 构建 Keycloak PKCE 授权 URL → iframe 导航到 Keycloak
 *   4. Keycloak 认证后重定向至 callback.html
 *   5. callback.html 换取 token → postMessage AUTH_SUCCESS → 跳回 index.html
 *   6. 主线程收到 AUTH_SUCCESS → 存储 token → 再次 postMessage AUTH_TOKEN_SYNC
 *
 * 静默刷新（Story 2.2）：
 *   - access_token 过期前 60 秒自动 refresh
 *   - refresh 失败 → postMessage AUTH_FAILURE → 清除存储、引导重新登录
 *
 * [Source: architecture.md#ADR-05 认证方案]
 */

// ---------------------------------------------------------------------------
// Keycloak 配置（对接线上 maker-community）
// ---------------------------------------------------------------------------
const KEYCLOAK_AUTHORITY = 'https://auth.verdure-hiro.cn/realms/maker-community';
const CLIENT_ID          = 'lceda-ai';
const TOKEN_ENDPOINT     = `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/token`;
const AUTH_ENDPOINT      = `${KEYCLOAK_AUTHORITY}/protocol/openid-connect/auth`;

/**
 * redirect_uri 动态构建：基于当前 iframe URL，定位到同目录下的 callback.html。
 * ⚠️ 此 URI 必须在 Keycloak 客户端 lceda-ai 的 Valid Redirect URIs 中注册。
 */
const REDIRECT_URI = new URL('callback.html', window.location.href).toString();

// ---------------------------------------------------------------------------
// 运行时状态（内存，不持久化）
// ---------------------------------------------------------------------------
/** 当前 access_token（由主线程通过 AUTH_TOKEN_SYNC 同步过来） */
let currentAccessToken = null;
/** 当前 refresh_token（仅内存，不持久化） */
let currentRefreshToken = null;
/** 静默刷新定时器 */
let refreshTimer = null;

// ---------------------------------------------------------------------------
// PKCE 工具函数（Web Crypto API，无外部依赖）
// ---------------------------------------------------------------------------

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// UI 切换
// ---------------------------------------------------------------------------

function showLoading() {
  document.getElementById('loading-section').style.display = 'flex';
  document.getElementById('login-section').style.display   = 'none';
  document.getElementById('app-section').style.display     = 'none';
}

function showLoginUI() {
  document.getElementById('loading-section').style.display = 'none';
  document.getElementById('login-section').style.display   = 'flex';
  document.getElementById('app-section').style.display     = 'none';
}

function showAppUI(accessToken, refreshToken) {
  currentAccessToken  = accessToken;
  currentRefreshToken = refreshToken || null;
  document.getElementById('loading-section').style.display = 'none';
  document.getElementById('login-section').style.display   = 'none';
  document.getElementById('app-section').style.display     = 'flex';
  scheduleTokenRefresh(accessToken);
}

// ---------------------------------------------------------------------------
// PKCE 登录发起
// ---------------------------------------------------------------------------

async function initiateLogin() {
  const verifier   = generateCodeVerifier();
  const challenge  = await generateCodeChallenge(verifier);
  const state      = crypto.randomUUID();

  // PKCE 中间态存入 sessionStorage（callback.html 使用后清除）
  sessionStorage.setItem('pkce_code_verifier', verifier);
  sessionStorage.setItem('pkce_state',         state);
  sessionStorage.setItem('pkce_redirect_uri',  REDIRECT_URI);

  const params = new URLSearchParams({
    response_type:         'code',
    client_id:             CLIENT_ID,
    redirect_uri:          REDIRECT_URI,
    scope:                 'openid profile email',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state,
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token 刷新（Story 2.2：静默刷新）
// ---------------------------------------------------------------------------

function getTokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleTokenRefresh(token) {
  if (refreshTimer) clearTimeout(refreshTimer);
  const expiry = getTokenExpiry(token);
  if (!expiry) return;
  const delay = Math.max(expiry - Date.now() - 60_000, 0); // 过期前 60 秒刷新
  refreshTimer = setTimeout(doSilentRefresh, delay);
}

async function doSilentRefresh() {
  if (!currentRefreshToken) {
    showLoginUI();
    return;
  }
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        client_id:     CLIENT_ID,
        refresh_token: currentRefreshToken,
      }),
    });

    if (!response.ok) throw new Error(`refresh_failed: ${response.status}`);

    const data = await response.json();
    if (!data.access_token) throw new Error('no access_token in refresh response');

    const newRefreshToken = data.refresh_token || currentRefreshToken;

    // 将新 token 同步给主线程（主线程更新 eda.sys_Storage）
    window.parent.postMessage(
      { type: 'AUTH_TOKEN_SYNC', accessToken: data.access_token, refreshToken: newRefreshToken },
      '*',
    );

    currentAccessToken  = data.access_token;
    currentRefreshToken = newRefreshToken;
    scheduleTokenRefresh(data.access_token);

  } catch (err) {
    console.warn('[ai-sch-generator/iframe] 静默刷新失败，需重新登录:', err);
    currentAccessToken  = null;
    currentRefreshToken = null;
    if (refreshTimer) clearTimeout(refreshTimer);

    // 通知主线程清除存储并弹 Toast
    window.parent.postMessage({ type: 'AUTH_FAILURE', error: 'session_expired' }, '*');
    showLoginUI();
  }
}

// ---------------------------------------------------------------------------
// 消息监听：接收主线程 AUTH_TOKEN_SYNC
// ---------------------------------------------------------------------------

window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data.type !== 'string') return;

  switch (event.data.type) {
    case 'AUTH_TOKEN_SYNC':
      if (event.data.accessToken) {
        showAppUI(event.data.accessToken, event.data.refreshToken);
      } else {
        showLoginUI();
      }
      break;

    default:
      break;
  }
});

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

document.getElementById('btn-login').addEventListener('click', initiateLogin);

// 向主线程请求已持久化的 token（主线程响应 AUTH_TOKEN_SYNC）
window.parent.postMessage({ type: 'REQUEST_AUTH_STATUS' }, '*');

// 容错：若主线程 2 秒内未响应，直接展示登录界面
setTimeout(() => {
  if (!currentAccessToken) showLoginUI();
}, 2000);

console.log('[ai-sch-generator/iframe] app.js loaded, requesting auth status from main thread...');

