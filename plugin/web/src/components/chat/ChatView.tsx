import {
  useState, useRef, useEffect, useCallback
} from 'react';
import {
  Send, Square, BoxSelect, RefreshCw, Plus
} from 'lucide-react';
import { useChatStore } from '../../stores/chat-store';
import { useAuthStore } from '../../stores/auth-store';
import { ChatMessage } from './ChatMessage';
import { TypingDots } from '../shared/TypingDots';
import { ErrorBanner } from '../shared/ErrorBanner';
import { Button } from '../shared/Button';
import { generateSchematic } from '../../api/schematics';
import { getSessions, createSession } from '../../api/sessions';
import { getSchematic, assembleCircuit } from '../../eda/schematic';
import { saveCheckpoint, hasCheckpoint } from '../../eda/checkpointer';
import { showToast, isEasyEda } from '../../eda/utils';
import styles from './ChatView.module.css';

type AttachMode = 'none' | 'selected' | 'all';

export function ChatView() {
  const store = useChatStore();
  const { isAuthenticated } = useAuthStore();

  const [input, setInput]           = useState('');
  const [attachMode, setAttachMode] = useState<AttachMode>('none');
  const [error, setError]           = useState('');
  const [abortCtrl, setAbortCtrl]   = useState<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const initializedRef = useRef(false);

  const sessionId  = store.currentSessionId;
  const messages   = sessionId ? (store.messages[sessionId] ?? []) : [];
  const isLoading  = store.isLoading;
  const progress   = store.progressStatus;

  // ── Initial load ────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || initializedRef.current) return;
    initializedRef.current = true;
    loadSessions();
  }, [isAuthenticated]);

  async function loadSessions() {
    try {
      const sessions = await getSessions();
      store.setSessions(sessions);
      if (sessions.length > 0) {
        store.setCurrentSession(sessions[0].id);
      } else {
        await handleNewSession();
      }
    } catch (e) {
      setError('加载会话失败: ' + (e as Error).message);
    }
  }

  async function handleNewSession() {
    try {
      const s = await createSession();
      store.setSessions([s, ...store.sessions]);
      store.setCurrentSession(s.id);
    } catch (e) {
      showToast('创建会话失败: ' + (e as Error).message, 'error');
    }
  }

  // ── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  // ── Textarea auto-resize ─────────────────────────────────────────
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  }

  // ── Checkpoint polling ──────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      store.setHasCheckpoint(hasCheckpoint());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ── Send ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !sessionId || isLoading) return;

    setInput('');
    setError('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Collect schematic context if requested
    let schematicContext = null;
    if (attachMode !== 'none' && isEasyEda()) {
      try {
        store.setProgress('读取原理图...');
        schematicContext = await getSchematic(attachMode);
        if (schematicContext.components.length === 0) {
          showToast(attachMode === 'selected' ? '没有选中的元件' : '画布上没有元件', 'warning');
          schematicContext = null;
        }
      } catch (e) {
        showToast('读取原理图失败: ' + (e as Error).message, 'error');
      }
    }

    // Add user message
    store.addMessage(sessionId, {
      id: crypto.randomUUID(), role: 'user', content: text,
      timestamp: Date.now(),
    });

    // Add streaming placeholder
    store.addMessage(sessionId, {
      id: crypto.randomUUID(), role: 'assistant', content: '',
      timestamp: Date.now(), isStreaming: true,
    });

    store.setLoading(true);
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);

    generateSchematic(text, sessionId, schematicContext, {
      onProgress: (msg) => store.setProgress(msg),

      onCircuit: async (circuitJson) => {
        store.setProgress('正在放置到画布...');

        // Save checkpoint BEFORE assembly so user can undo
        if (isEasyEda()) {
          const saved = await saveCheckpoint();
          if (saved) store.setHasCheckpoint(true);
        }

        try {
          if (isEasyEda()) {
            await assembleCircuit(circuitJson);
          }
          store.updateLastMessage(sessionId, {
            isStreaming: false,
            content: schematicContext
              ? '✅ 已根据你的描述生成并放置原理图。如需调整，请继续对话。'
              : '✅ 原理图已生成并放置到画布。',
            circuitJson,
          });
        } catch (e) {
          store.updateLastMessage(sessionId, {
            isStreaming: false,
            isError: true,
            content: '放置失败: ' + (e as Error).message,
          });
        }
      },

      onError: (msg) => {
        store.updateLastMessage(sessionId, {
          isStreaming: false,
          isError: true,
          content: '生成失败: ' + msg,
        });
        setError(msg);
      },

      onDone: () => {
        store.setLoading(false);
        store.setProgress('');
        setAbortCtrl(null);
        // If still streaming (text response, no circuit), finalize
        const msgs = store.messages[sessionId] ?? [];
        const last = msgs[msgs.length - 1];
        if (last?.isStreaming) {
          store.updateLastMessage(sessionId, { isStreaming: false });
        }
      },
    }, ctrl.signal);
  }, [input, sessionId, isLoading, attachMode]);

  function cancelRequest() {
    abortCtrl?.abort();
    store.setLoading(false);
    store.setProgress('');
    store.updateLastMessage(sessionId!, { isStreaming: false, content: '（已取消）' });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function cycleAttachMode() {
    setAttachMode(m =>
      m === 'none' ? 'selected' : m === 'selected' ? 'all' : 'none'
    );
  }

  const attachLabel = attachMode === 'none' ? '不上传' : attachMode === 'selected' ? '上传选中' : '上传全部';
  const attachActive = attachMode !== 'none';

  return (
    <div className={styles.container}>
      {/* ── Session bar ── */}
      <div className={styles.sessionBar}>
        <div className={styles.sessionList}>
          {store.sessions.slice(0, 8).map(s => (
            <button
              key={s.id}
              className={[styles.sessionChip, s.id === sessionId ? styles.activeChip : ''].join(' ')}
              onClick={() => store.setCurrentSession(s.id)}
              title={s.title}
            >
              {s.title.slice(0, 12)}
            </button>
          ))}
        </div>
        <button className={styles.newSessionBtn} onClick={handleNewSession} title="新建对话">
          <Plus size={13} />
        </button>
      </div>

      {/* ── Messages ── */}
      <div className={styles.messages}>
        {messages.length === 0 && !isLoading && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🌿</div>
            <p className={styles.emptyTitle}>绿荫智绘</p>
            <p className={styles.emptyHint}>描述你想要的电路，AI 将自动生成原理图</p>
            <p className={styles.emptyHint} style={{ marginTop: 4 }}>
              提示：开启「上传选中」可将当前原理图发给 AI 分析
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage key={msg.id} msg={msg} isLast={i === messages.length - 1} />
        ))}

        {isLoading && (
          <div className={styles.assistantLoading}>
            <TypingDots status={progress} />
          </div>
        )}

        {error && !isLoading && <ErrorBanner message={error} />}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input area ── */}
      <div className={styles.inputWrapper}>
        <div className={styles.inputOptions}>
          <button
            className={[styles.optionBtn, attachActive ? styles.optionActive : ''].join(' ')}
            onClick={cycleAttachMode}
            title="切换原理图上传模式"
          >
            <BoxSelect size={11} />
            <span>{attachLabel}</span>
          </button>
          {isLoading && (
            <button className={styles.optionBtn} onClick={cancelRequest}>
              <Square size={11} />
              <span>取消</span>
            </button>
          )}
        </div>

        <div className={[styles.inputRow, isLoading ? styles.inputLoading : ''].join(' ')}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要的电路，例如：基于 AMS1117-3.3 的 3.3V 稳压电源电路..."
            disabled={isLoading}
            rows={1}
          />
          <button
            className={styles.sendBtn}
            onClick={isLoading ? cancelRequest : sendMessage}
            disabled={!isLoading && input.trim() === ''}
          >
            {isLoading ? <Square size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
