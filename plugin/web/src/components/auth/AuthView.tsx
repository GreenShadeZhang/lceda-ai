import { useState, useCallback } from 'react';
import QRCode from 'qrcode';
import { useAuthStore } from '../../stores/auth-store';
import { useSettingsStore } from '../../stores/settings-store';
import { Button } from '../shared/Button';
import { ErrorBanner } from '../shared/ErrorBanner';
import styles from './AuthView.module.css';

const KEYCLOAK_BASE    = 'https://auth.verdure-hiro.cn/realms/maker-community';
const CLIENT_ID        = 'lceda-ai';
const DEVICE_AUTH_URL  = `${KEYCLOAK_BASE}/protocol/openid-connect/auth/device`;
const TOKEN_URL        = `${KEYCLOAK_BASE}/protocol/openid-connect/token`;

type Stage = 'login' | 'device' | 'loading';

interface DeviceData {
  deviceCode:  string;
  userCode:    string;
  qrDataUrl:   string;
  openUrl:     string;
  expiresIn:   number;
  interval:    number;
}

export function AuthView() {
  const { setTokens }     = useAuthStore();
  const { apiBaseUrl }    = useSettingsStore();
  const [stage, setStage] = useState<Stage>('login');
  const [device, setDevice] = useState<DeviceData | null>(null);
  const [error, setError]   = useState('');
  const [polling, setPolling] = useState(false);

  const openInBrowser = (url: string) => {
    try { (eda as any).sys_Window?.open(url); } catch {
      try { window.open(url, '_blank'); } catch { /* ignore */ }
    }
  };

  const startDeviceFlow = useCallback(async () => {
    setError('');
    setStage('loading');
    try {
      const res = await fetch(DEVICE_AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `client_id=${encodeURIComponent(CLIENT_ID)}`,
      });
      if (!res.ok) throw new Error(`授权请求失败 HTTP ${res.status}`);
      const data = await res.json();

      const qrUrl = data.verification_uri_complete || data.verification_uri;
      const qrDataUrl = await QRCode.toDataURL(qrUrl, {
        width: 160, margin: 2,
        color: { dark: '#89b4fa', light: '#1e1e2e' },
      });

      const deviceData: DeviceData = {
        deviceCode:  data.device_code,
        userCode:    data.user_code,
        qrDataUrl,
        openUrl:     data.verification_uri,
        expiresIn:   data.expires_in ?? 300,
        interval:    data.interval   ?? 5,
      };
      setDevice(deviceData);
      setStage('device');
      startPolling(deviceData);
    } catch (e) {
      setError((e as Error).message);
      setStage('login');
    }
  }, []);

  const startPolling = useCallback(async (d: DeviceData) => {
    if (polling) return;
    setPolling(true);
    const maxTries = Math.ceil(d.expiresIn / d.interval);
    for (let i = 0; i < maxTries; i++) {
      if (i > 0) await sleep(d.interval * 1000);
      try {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
            client_id:   CLIENT_ID,
            device_code: d.deviceCode,
          }),
        });
        const json = await res.json();
        if (res.status === 200 && json.access_token) {
          setTokens(json.access_token, json.refresh_token ?? null);
          setPolling(false);
          return;
        }
        if (res.status === 400) {
          const ec = json.error;
          if (ec === 'authorization_pending' || ec === 'slow_down') continue;
          throw new Error(json.error_description || ec || '授权失败');
        }
        throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes('fetch') || msg.includes('network')) continue;
        setError(msg);
        setStage('login');
        setPolling(false);
        return;
      }
    }
    setError('登录超时，请重新尝试');
    setStage('login');
    setPolling(false);
  }, [polling]);

  if (stage === 'loading') {
    return (
      <div className={styles.center}>
        <div className={styles.spinner} />
        <span className={styles.hint}>正在请求设备码...</span>
      </div>
    );
  }

  if (stage === 'device' && device) {
    return (
      <div className={styles.device}>
        <p className={styles.deviceTitle}>扫码或打开链接完成授权</p>
        <img src={device.qrDataUrl} alt="QR Code" className={styles.qr} />
        <div className={styles.userCode}>{device.userCode}</div>
        <Button variant="primary" size="lg" onClick={() => openInBrowser(device.openUrl)}>
          在浏览器中打开
        </Button>
        <div className={styles.waitHint}>
          {polling ? '⏳ 等待授权中...' : '请在浏览器中完成授权'}
        </div>
        <button className={styles.backBtn} onClick={() => setStage('login')}>← 返回</button>
      </div>
    );
  }

  return (
    <div className={styles.login}>
      <div className={styles.logo}>🌿</div>
      <h1 className={styles.loginTitle}>绿荫智绘</h1>
      <p className={styles.loginSub}>AI 驱动的原理图生成助手</p>
      <p className={styles.loginSub} style={{ marginTop: 4, fontSize: 11 }}>
        后端：{apiBaseUrl}
      </p>
      {error && <ErrorBanner message={error} />}
      <Button variant="primary" size="lg" onClick={startDeviceFlow}>
        登录 / 注册
      </Button>
    </div>
  );
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
