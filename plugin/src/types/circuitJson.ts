/**
 * circuitJson.ts — 后端返回的电路 JSON 数据契约类型定义
 *
 * [Source: architecture.md#ADR-09：电路 JSON 数据契约]
 */

export interface CircuitComponent {
  ref:        string;           // 位号，如 "U1"
  lcsc:       string;           // 立创商城 C 编号，如 "C6186"
  name:       string;           // 元件名，如 "AMS1117-3.3"
  x:          number;           // 坐标（mil 单位）
  y:          number;
  rotation?:  number;           // 旋转角度（0 / 90 / 180 / 270）
  add_to_bom?: boolean;
  add_to_pcb?: boolean;
}

export interface NetFlag {
  type: 'Power' | 'Ground' | 'AnalogGround' | 'ProtectGround';
  net:  string;                 // 网络名，如 "GND" / "VCC"
  x:    number;
  y:    number;
}

export interface Wire {
  points: [number, number][];   // 折线坐标路径
  net?:   string;               // 网络名（可选）
}

export interface CircuitJson {
  version:    string;
  meta: {
    description:  string;
    generated_by: string;
  };
  components: CircuitComponent[];
  net_flags:  NetFlag[];
  wires:      Wire[];
}

/** 后端 /api/schematics/generate 的非流式响应体 */
export interface GenerateApiResponse {
  success: boolean;
  data?: {
    circuitJson:  CircuitJson;
    description?: string;
  };
  error?: {
    code:    string;
    message: string;
  };
}

/** SSE 事件数据 */
export type SseEvent =
  | { type: 'progress'; text: string }
  | { type: 'complete'; circuitJson: CircuitJson }
  | { type: 'error';    message: string };

