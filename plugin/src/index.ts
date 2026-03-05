/**
 * index.ts — 插件主线程入口
 *
 * 职责：
 *   - 注册菜单点击处理函数 openAIPanel（extension.json registerFn 对应）
 *   - 打开 IFrame 对话面板
 *   - 监听来自 IFrame 的 postMessage 消息
 *
 * Story 2.2：处理认证消息
 *   - REQUEST_AUTH_STATUS → 从 eda.sys_Storage 读取 token → AUTH_TOKEN_SYNC 回送 IFrame
 *   - AUTH_SUCCESS        → 存储 accessToken + refreshToken 到 eda.sys_Storage
 *   - AUTH_TOKEN_SYNC     → 静默刷新后主线程更新 eda.sys_Storage（IFrame 主动同步过来）
 *   - AUTH_FAILURE        → 清除存储、展示 Toast 提示登录过期
 *
 * 重要限制（来自 architecture.md ADR）：
 *   ❌ 主线程禁止发起任何外部 HTTP 请求（浏览器安全策略）
 *   ❌ Token 不得使用 localStorage，只能存入 eda.sys_Storage
 *   ✅ 外部 fetch 调用必须在 IFrame（iframe/app.js）内发起
 *
 * [Source: architecture.md#立创EDA 插件 SDK 技术调研]
 */

import { MSG, AuthSuccessMessage, AuthFailureMessage, AuthTokenSyncMessage } from './messageTypes';

// IFrame 窗口引用（用于主线程 → IFrame 的 postMessage）
let iframeWindow: WindowProxy | null = null;

/**
 * 打开 AI 原理图生成器 IFrame 面板（Story 1.1 + Story 2.2 更新：检查已有 token）
 */
export function openAIPanel(): void {
  console.log('[ai-sch-generator] openAIPanel triggered');
  eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500);
}

/**
 * 处理来自 IFrame 的 postMessage 消息
 */
export async function onMessage(event: MessageEvent): Promise<void> {
  if (!event.data || typeof event.data.type !== 'string') {
    return;
  }

  // 保存 iframe 窗口引用（用于回复消息）
  if (event.source) {
    iframeWindow = event.source as WindowProxy;
  }

  const type = event.data.type as string;
  console.log('[ai-sch-generator] received message:', type);

  switch (type) {
    // ---- IFrame 加载时请求当前 token 状态 ----
    case MSG.REQUEST_AUTH_STATUS: {
      const accessToken  = await eda.sys_Storage.getItem('access_token');
      const refreshToken = await eda.sys_Storage.getItem('refresh_token');
      (event.source as WindowProxy).postMessage(
        { type: MSG.AUTH_TOKEN_SYNC, accessToken: accessToken || null, refreshToken: refreshToken || null },
        '*',
      );
      break;
    }

    // ---- PKCE 登录成功：callback.html 换取 token 后回送 ----
    case MSG.AUTH_SUCCESS: {
      const authMsg = event.data as AuthSuccessMessage;
      await eda.sys_Storage.setItem('access_token',  authMsg.accessToken);
      await eda.sys_Storage.setItem('refresh_token', authMsg.refreshToken ?? '');
      console.log('[ai-sch-generator] token 已存储到 eda.sys_Storage');
      // 登录后 iframe 会跳回 index.html，index.html 的 app.js 加载时会再次 REQUEST_AUTH_STATUS
      break;
    }

    // ---- 静默刷新后 IFrame 将新 token 回写主线程 ----
    case MSG.AUTH_TOKEN_SYNC: {
      const syncMsg = event.data as AuthTokenSyncMessage;
      if (syncMsg.accessToken) {
        await eda.sys_Storage.setItem('access_token',  syncMsg.accessToken);
        await eda.sys_Storage.setItem('refresh_token', syncMsg.refreshToken ?? '');
      }
      break;
    }

    // ---- 登录失败或 refresh_token 过期 ----
    case MSG.AUTH_FAILURE: {
      const failMsg = event.data as AuthFailureMessage;
      // 清除已存储的失效 token
      await eda.sys_Storage.removeItem('access_token');
      await eda.sys_Storage.removeItem('refresh_token');
      // 展示 Toast 提示（session_expired 时给用户友好提示）
      if (failMsg.error === 'session_expired') {
        eda.sys_ToastMessage.showToast('登录已过期，请重新登录', 'warning');
      }
      break;
    }

    case MSG.GENERATE_REQUEST:
      // TODO Story 3.4: 接收电路 JSON，调用 EDA SDK 放置器件
      break;

    default:
      break;
  }
}

// 注册 postMessage 监听器（插件激活即开始监听）
window.addEventListener('message', onMessage);

console.log('[ai-sch-generator] 插件已激活，等待菜单点击...');

