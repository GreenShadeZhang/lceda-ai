/**
 * index.ts — 插件主线程入口
 *
 * 职责：
 *   - 注册菜单点击处理函数 openAIPanel（extension.json registerFn 对应）
 *   - 打开 IFrame 对话面板
 *   - 监听来自 IFrame 的 postMessage 消息（骨架，Story 2/3 填充实现）
 *
 * 重要限制（来自 architecture.md ADR）：
 *   ❌ 主线程禁止发起任何外部 HTTP 请求（浏览器安全策略）
 *   ❌ Token 不得使用 localStorage，只能存入 eda.sys_Storage（Story 2 实现）
 *   ✅ 外部 fetch 调用必须在 IFrame（iframe/app.js）内发起
 *
 * [Source: architecture.md#立创EDA 插件 SDK 技术调研]
 */

import { MSG, PluginMessage } from './messageTypes';

/**
 * 打开 AI 原理图生成器 IFrame 面板
 *
 * 此函数名与 extension.json 中 registerFn: "openAIPanel" 严格对应，
 * EDA 平台在用户点击菜单时调用此函数。
 *
 * 面板尺寸：宽 700px × 高 500px（来自 architecture.md SDK 调研）
 */
export function openAIPanel(): void {
  console.log('[ai-sch-generator] openAIPanel triggered');
  // 打开 IFrame 对话面板
  // API: eda.sys_IFrame.openIFrame(path, width, height)
  // [Source: architecture.md#立创EDA 插件 SDK 技术调研 - eda 全局对象]
  eda.sys_IFrame.openIFrame('/iframe/index.html', 700, 500);
}

/**
 * 处理来自 IFrame 的 postMessage 消息
 *
 * Story 1.1：空骨架实现，仅打印日志
 * Story 2：将处理 AUTH_SUCCESS / AUTH_FAILURE
 * Story 3：将处理 GENERATE_REQUEST
 */
export function onMessage(event: MessageEvent): void {
  // 类型安全检查：确保消息来自插件 IFrame
  if (!event.data || typeof event.data.type !== 'string') {
    return;
  }

  const message = event.data as PluginMessage;
  console.log('[ai-sch-generator] received message:', message.type);

  // Story 2/3 中将在以下 switch 中添加具体处理逻辑
  switch (message.type) {
    case MSG.AUTH_SUCCESS:
      // TODO Story 2.2: 调用 eda.sys_Storage.setItem() 存储 token
      break;
    case MSG.AUTH_FAILURE:
      // TODO Story 2.2: 显示登录失败提示
      break;
    case MSG.GENERATE_REQUEST:
      // TODO Story 3.4: 接收电路 JSON，调用 EDA SDK 放置器件
      break;
    default:
      // 忽略未知消息类型
      break;
  }
}

// 注册 postMessage 监听器（插件激活即开始监听）
window.addEventListener('message', onMessage);

console.log('[ai-sch-generator] 插件已激活，等待菜单点击...');
