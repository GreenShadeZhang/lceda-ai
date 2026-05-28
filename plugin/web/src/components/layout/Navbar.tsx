import { MessageSquare, Settings, Undo2 } from 'lucide-react';
import { useAppStore, type AppTab } from '../../stores/app-store';
import { useChatStore } from '../../stores/chat-store';
import { restoreCheckpoint } from '../../eda/checkpointer';
import { showToast } from '../../eda/utils';
import styles from './Navbar.module.css';

const TABS: { id: AppTab; icon: typeof MessageSquare; label: string }[] = [
  { id: 'chat',     icon: MessageSquare, label: '对话' },
  { id: 'settings', icon: Settings,      label: '设置' },
];

export function Navbar() {
  const { activeTab, setActiveTab } = useAppStore();
  const { hasCheckpoint, setHasCheckpoint } = useChatStore();

  async function handleUndo() {
    try {
      await restoreCheckpoint();
      setHasCheckpoint(false);
    } catch (e) {
      showToast((e as Error).message, 'error');
    }
  }

  return (
    <header className={styles.navbar}>
      <span className={styles.title}>🌿 绿荫智绘</span>

      <nav className={styles.tabs}>
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[styles.tab, activeTab === id ? styles.active : ''].join(' ')}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {hasCheckpoint && (
        <button className={styles.undoBtn} onClick={handleUndo} title="撤销上次 AI 修改">
          <Undo2 size={13} />
          <span>撤销</span>
        </button>
      )}
    </header>
  );
}
