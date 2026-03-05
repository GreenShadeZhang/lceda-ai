/**
 * circuitJson.ts — 后端返回的电路 JSON 数据契约类型定义
 *
 * Story 1.1：占位文件，为 Story 3 预留类型定义
 * Story 3.2/3.4：将在此文件中定义完整的 CircuitJson 类型
 *
 * [Source: architecture.md#ADR-09：电路 JSON 数据契约]
 */

// Story 3 中将定义：
// export interface CircuitComponent { ref: string; lcsc: string; ... }
// export interface NetFlag { type: 'Power' | 'Ground' | ...; net: string; ... }
// export interface Wire { from: ...; to: ...; points: [number, number][]; }
// export interface CircuitJson { version: string; meta: ...; components: ...; ... }
export type CircuitJson = unknown; // 占位，Story 3 替换
