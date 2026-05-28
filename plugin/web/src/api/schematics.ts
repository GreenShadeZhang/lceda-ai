import { streamSSE } from './sse';
import type { SchematicContext } from '../types/eda';

export type GenerateCallbacks = {
  onProgress?: (msg: string) => void;
  onCircuit?: (circuitJson: unknown) => void;
  onError?: (msg: string) => void;
  onDone?: () => void;
};

export function generateSchematic(
  userInput: string,
  sessionId: string | null,
  schematicContext: SchematicContext | null,
  callbacks: GenerateCallbacks,
  signal?: AbortSignal,
): void {
  streamSSE(
    '/api/schematics/generate',
    { userInput, sessionId, schematicContext },
    {
      onProgress: callbacks.onProgress,
      onComplete: callbacks.onCircuit,
      onError: callbacks.onError,
      onDone: callbacks.onDone,
    },
    signal,
  );
}
