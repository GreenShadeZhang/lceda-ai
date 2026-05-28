import styles from './shared.module.css';

export function TypingDots({ status }: { status?: string }) {
  return (
    <div className={styles.typingContainer}>
      <div className={styles.dots}>
        <div className={styles.dot} />
        <div className={styles.dot} />
        <div className={styles.dot} />
      </div>
      {status && <span>{status}</span>}
    </div>
  );
}
