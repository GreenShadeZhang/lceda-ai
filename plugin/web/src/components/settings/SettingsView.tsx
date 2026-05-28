import { useAuthStore } from '../../stores/auth-store';
import { useSettingsStore } from '../../stores/settings-store';
import { Button } from '../shared/Button';
import { Moon, Sun } from 'lucide-react';
import styles from './SettingsView.module.css';

export function SettingsView() {
  const { isAuthenticated, clearTokens } = useAuthStore();
  const { apiBaseUrl, setApiBaseUrl, theme, setTheme } = useSettingsStore();

  return (
    <div className={styles.container}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>外观</h2>
        <div className={styles.themeRow}>
          <span className={styles.themeLabel}>主题</span>
          <div className={styles.themeToggle}>
            <button
              className={[styles.themeBtn, theme === 'dark' ? styles.themeBtnActive : ''].join(' ')}
              onClick={() => setTheme('dark')}
            >
              <Moon size={13} />
              <span>暗色</span>
            </button>
            <button
              className={[styles.themeBtn, theme === 'light' ? styles.themeBtnActive : ''].join(' ')}
              onClick={() => setTheme('light')}
            >
              <Sun size={13} />
              <span>亮色</span>
            </button>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>API 设置</h2>
        <label className={styles.label}>
          <span>后端地址</span>
          <input
            type="text"
            className={styles.input}
            value={apiBaseUrl}
            onChange={e => setApiBaseUrl(e.target.value.trimEnd())}
            placeholder="https://lceda-ai.verdure-hiro.cn"
            spellCheck={false}
          />
        </label>
        <p className={styles.hint}>
          默认连接线上服务：<code>https://lceda-ai.verdure-hiro.cn</code><br />
          本地开发可改为：<code>http://localhost:5267</code>
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>账号</h2>
        {isAuthenticated ? (
          <div className={styles.accountRow}>
            <span className={styles.accountStatus}>✅ 已登录</span>
            <Button variant="danger" size="sm" onClick={clearTokens}>
              退出登录
            </Button>
          </div>
        ) : (
          <p className={styles.hint}>未登录，请返回聊天页面登录。</p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>关于</h2>
        <p className={styles.hint}>
          绿荫智绘 — AI 驱动的 EasyEDA Pro 原理图生成插件<br />
          后端：ASP.NET Core + Keycloak + PostgreSQL
        </p>
      </section>
    </div>
  );
}
