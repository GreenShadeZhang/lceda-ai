/**
 * messageTypes.ts — IFrame ↔ 主线程 postMessage 消息类型常量
 *
 * 消息方向：
 *   IFrame → 主线程：AUTH_SUCCESS, AUTH_FAILURE, GENERATE_REQUEST
 *   主线程 → IFrame：AUTH_TOKEN_SYNC, GENERATE_RESULT, GENERATE_ERROR
 *
 * [Source: architecture.md#IFrame ↔ Plugin 主线程消息规范]
 * 命名规范：SCREAMING_SNAKE_CASE（来自 architecture.md#TypeScript 命名规范）
 */

export const MSG = {
  // IFrame → 主线程
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  AUTH_FAILURE: 'AUTH_FAILURE',
  GENERATE_REQUEST: 'GENERATE_REQUEST',
  // 主线程 → IFrame
  AUTH_TOKEN_SYNC: 'AUTH_TOKEN_SYNC',
  GENERATE_RESULT: 'GENERATE_RESULT',
  GENERATE_ERROR: 'GENERATE_ERROR',
} as const;

/** 所有消息类型的联合类型 */
export type MsgType = (typeof MSG)[keyof typeof MSG];

// ---------------------------------------------------------------------------
// Payload 接口定义
// 为后续故事提供类型安全的 postMessage 通信
// ---------------------------------------------------------------------------

/** IFrame → 主线程：OIDC 登录成功，携带 token */
export interface AuthSuccessMessage {
  type: typeof MSG.AUTH_SUCCESS;
  accessToken: string;
  refreshToken: string;
}

/** IFrame → 主线程：OIDC 登录失败 */
export interface AuthFailureMessage {
  type: typeof MSG.AUTH_FAILURE;
  error: string;
}

/** IFrame → 主线程：用户提交自然语言需求 */
export interface GenerateRequestMessage {
  type: typeof MSG.GENERATE_REQUEST;
  userInput: string;
  authToken: string;
}

/** 主线程 → IFrame：token 刷新同步 */
export interface AuthTokenSyncMessage {
  type: typeof MSG.AUTH_TOKEN_SYNC;
  accessToken: string;
  refreshToken: string;
}

/** 主线程 → IFrame：原理图生成结果 */
export interface GenerateResultMessage {
  type: typeof MSG.GENERATE_RESULT;
  /** Story 3 中替换为具体的 CircuitJson 类型 */
  circuitJson: unknown;
}

/** 主线程 → IFrame：生成过程发生错误 */
export interface GenerateErrorMessage {
  type: typeof MSG.GENERATE_ERROR;
  error: string;
}

/** 所有消息的联合类型（类型守卫用） */
export type PluginMessage =
  | AuthSuccessMessage
  | AuthFailureMessage
  | GenerateRequestMessage
  | AuthTokenSyncMessage
  | GenerateResultMessage
  | GenerateErrorMessage;
