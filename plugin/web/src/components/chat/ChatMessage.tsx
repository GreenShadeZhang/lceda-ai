import { useEffect, useRef } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import type { ChatMessage as Msg } from '../../stores/chat-store';
import { TypingDots } from '../shared/TypingDots';
import styles from './ChatMessage.module.css';

interface Props {
  msg: Msg;
  isLast?: boolean;
}

export function ChatMessage({ msg, isLast }: Props) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (contentRef.current && msg.role === 'assistant' && !msg.isStreaming) {
      contentRef.current.innerHTML = renderMarkdown(msg.content);
    }
  }, [msg.content, msg.isStreaming, msg.role]);

  if (msg.role === 'user') {
    return (
      <div className={styles.userRow}>
        {msg.content && <div className={styles.userBubble}>{msg.content}</div>}
      </div>
    );
  }

  // assistant
  return (
    <div className={[styles.assistantRow, isLast ? styles.last : ''].join(' ')}>
      <div className={styles.assistantBubble}>
        {msg.isStreaming && !msg.content ? (
          <TypingDots status="正在生成..." />
        ) : msg.isStreaming ? (
          <pre className={styles.streamText}>{msg.content}</pre>
        ) : msg.isError ? (
          <span className={styles.errorText}>{msg.content}</span>
        ) : (
          <div ref={contentRef} className="md-content" />
        )}

        {!msg.isStreaming && msg.circuitJson != null && (
          <div className={styles.circuitBadge}>✅ 已放置到原理图画布</div>
        )}
      </div>
    </div>
  );
}
