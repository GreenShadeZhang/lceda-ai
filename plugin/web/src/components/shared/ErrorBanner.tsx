import { AlertCircle } from 'lucide-react';
import styles from './shared.module.css';

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className={styles.errorBanner}>
      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{message}</span>
    </div>
  );
}
