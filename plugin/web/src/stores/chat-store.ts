import { create } from 'zustand';
import type { SessionDto } from '../api/sessions';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  isError?: boolean;
  circuitJson?: unknown;      // set when message contains a generated circuit
  checkpointSaved?: boolean;  // true if checkpoint was saved before assembly
}

interface ChatState {
  sessions:        SessionDto[];
  currentSessionId: string | null;
  messages:        Record<string, ChatMessage[]>; // sessionId -> messages
  isLoading:       boolean;
  progressStatus:  string;
  hasCheckpoint:   boolean;

  setSessions:         (sessions: SessionDto[]) => void;
  setCurrentSession:   (id: string | null) => void;
  addMessage:          (sessionId: string, msg: ChatMessage) => void;
  updateLastMessage:   (sessionId: string, update: Partial<ChatMessage>) => void;
  appendToLastMessage: (sessionId: string, chunk: string) => void;
  setMessages:         (sessionId: string, msgs: ChatMessage[]) => void;
  setLoading:          (v: boolean) => void;
  setProgress:         (v: string) => void;
  setHasCheckpoint:    (v: boolean) => void;
  clearMessages:       (sessionId: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessions: [],
  currentSessionId: null,
  messages: {},
  isLoading: false,
  progressStatus: '',
  hasCheckpoint: false,

  setSessions: (sessions) => set({ sessions }),
  setCurrentSession: (id) => set({ currentSessionId: id }),

  addMessage: (sessionId, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionId]: [...(s.messages[sessionId] ?? []), msg],
      },
    })),

  updateLastMessage: (sessionId, update) =>
    set((s) => {
      const msgs = [...(s.messages[sessionId] ?? [])];
      if (msgs.length === 0) return s;
      msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], ...update };
      return { messages: { ...s.messages, [sessionId]: msgs } };
    }),

  appendToLastMessage: (sessionId, chunk) =>
    set((s) => {
      const msgs = [...(s.messages[sessionId] ?? [])];
      if (msgs.length === 0) return s;
      const last = msgs[msgs.length - 1];
      msgs[msgs.length - 1] = { ...last, content: last.content + chunk };
      return { messages: { ...s.messages, [sessionId]: msgs } };
    }),

  setMessages: (sessionId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [sessionId]: msgs } })),

  setLoading:       (v) => set({ isLoading: v }),
  setProgress:      (v) => set({ progressStatus: v }),
  setHasCheckpoint: (v) => set({ hasCheckpoint: v }),

  clearMessages: (sessionId) =>
    set((s) => ({ messages: { ...s.messages, [sessionId]: [] } })),
}));
