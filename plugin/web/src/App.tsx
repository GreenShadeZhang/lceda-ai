import { useEffect } from 'react';
import { useAuthStore } from './stores/auth-store';
import { useAppStore } from './stores/app-store';
import { useSettingsStore } from './stores/settings-store';
import { AuthView } from './components/auth/AuthView';
import { Navbar } from './components/layout/Navbar';
import { ChatView } from './components/chat/ChatView';
import { SettingsView } from './components/settings/SettingsView';
import styles from './App.module.css';

const KEYCLOAK_BASE = 'https://auth.verdure-hiro.cn/realms/maker-community';
const CLIENT_ID     = 'lceda-ai';
const TOKEN_URL     = `${KEYCLOAK_BASE}/protocol/openid-connect/token`;

export default function App() {
  const { isAuthenticated, accessToken, refreshToken, setTokens, clearTokens, isTokenValid } = useAuthStore();
  const { activeTab } = useAppStore();
  const { theme } = useSettingsStore();

  // Apply theme to root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Load tokens from EDA/localStorage on mount
  useEffect(() => {
    useAuthStore.getState().loadFromStorage();
  }, []);

  // Silent refresh: check every 60s, refresh when token expires in < 90s
  useEffect(() => {
    if (!isAuthenticated) return;

    const check = async () => {
      if (!isTokenValid() && refreshToken) {
        try {
          const res = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type:    'refresh_token',
              client_id:     CLIENT_ID,
              refresh_token: refreshToken,
            }),
          });
          if (res.ok) {
            const json = await res.json();
            setTokens(json.access_token, json.refresh_token ?? refreshToken);
          } else {
            clearTokens();
          }
        } catch { /* network error — stay logged in for now */ }
      }
    };

    const id = setInterval(check, 60_000);
    check(); // also run immediately
    return () => clearInterval(id);
  }, [isAuthenticated, refreshToken]);

  if (!isAuthenticated) {
    return (
      <div className={styles.root}>
        <AuthView />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Navbar />
      <div className={styles.content}>
        {activeTab === 'chat'     && <ChatView />}
        {activeTab === 'settings' && <SettingsView />}
      </div>
    </div>
  );
}
