import { Capacitor, registerPlugin } from '@capacitor/core';

export type StoredState = { stateJson: string | null; revision: number; recoveryJson: string | null };
export type StateWrite = { stateJson: string; expectedRevision: number; keepRecovery?: boolean };
export interface StatePersistence {
  readState(): Promise<StoredState>;
  writeState(input: StateWrite): Promise<{ revision: number }>;
}
export interface WordweaveNativePlugin extends StatePersistence {
  readCredential(): Promise<{ token: string | null }>;
  writeCredential(input: { token: string | null }): Promise<void>;
  request(input: { url: string; method: string; body?: string; token?: string }): Promise<{ status: number; body: string }>;
  readBackup(): Promise<{ cancelled: boolean; text?: string; name?: string }>;
  writeBackup(input: { text: string; fileName: string }): Promise<{ saved: boolean }>;
  speak(input: { text: string }): Promise<void>;
  stopSpeech(): Promise<void>;
  speechStatus(): Promise<{ available: boolean; reason?: string }>;
  openSpeechSettings(): Promise<void>;
}

const STORAGE_KEY = 'wordweave-mobile-state-v1';

// Browser preview only. One envelope makes state, revision and recovery atomic
// with respect to a failed setItem (including quota errors).
export function createBrowserPersistence(storage: Pick<Storage, 'getItem' | 'setItem'>): StatePersistence {
  const read = (): StoredState => {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { stateJson: null, revision: 0, recoveryJson: null };
    const value = JSON.parse(raw) as StoredState;
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !(value.stateJson === null || typeof value.stateJson === 'string') ||
      !(value.recoveryJson === null || typeof value.recoveryJson === 'string')) {
      throw Error('本机存储格式无效，请导入备份恢复。');
    }
    return value;
  };
  return {
    async readState() { return read(); },
    async writeState(input) {
      const current = read();
      if (input.expectedRevision !== current.revision) throw Error('本机记录已变化，请重新载入后再试。');
      const revision = current.revision + 1;
      storage.setItem(STORAGE_KEY, JSON.stringify({
        stateJson: input.stateJson,
        revision,
        recoveryJson: input.keepRecovery ? current.stateJson : current.recoveryJson,
      } satisfies StoredState));
      return { revision };
    },
  };
}

const browser: WordweaveNativePlugin = {
  async readCredential() { return { token: window.sessionStorage.getItem('wordweave-preview-token') }; },
  async writeCredential({ token }) {
    if (token) window.sessionStorage.setItem('wordweave-preview-token', token);
    else window.sessionStorage.removeItem('wordweave-preview-token');
  },
  async request({ url, method, body, token }) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://wordweave-cet-study.shiw36663.chatgpt.site' || !parsed.pathname.startsWith('/api/mobile/')) throw Error('无效的同步地址。');
    const response = await fetch(import.meta.env.DEV ? parsed.pathname + parsed.search : url, {
      method, body, credentials: 'omit',
      headers: { ...(body ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: 'Bearer ' + token} : {}) },
      signal: AbortSignal.timeout(30000),
    });
    return {status: response.status, body: await response.text()};
  },
  readState: () => createBrowserPersistence(window.localStorage).readState(),
  writeState: input => createBrowserPersistence(window.localStorage).writeState(input),
  readBackup() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
      const finish = () => input.remove();
      input.addEventListener('cancel', () => { finish(); resolve({ cancelled: true }); }, { once: true });
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        try {
          resolve(file ? { cancelled: false, text: await file.text(), name: file.name } : { cancelled: true });
        } catch (error) { reject(error); } finally { finish(); }
      }, { once: true });
      document.body.appendChild(input); input.click();
    });
  },
  async writeBackup({ text, fileName }) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = fileName;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { saved: true };
  },
  async speechStatus() {
    const available = 'speechSynthesis' in window && window.speechSynthesis.getVoices().some(voice => voice.localService && voice.lang.toLowerCase().startsWith('en'));
    return { available, ...(!available ? { reason: '未找到本机英语语音。请在 Android 设备的语音设置中安装离线英语语音。' } : {}) };
  },
  async speak({ text }) {
    const status = await browser.speechStatus();
    if (!status.available) throw Error(status.reason);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US'; utterance.rate = 0.85;
    utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.toLowerCase().startsWith('en')) ?? null;
    window.speechSynthesis.speak(utterance);
  },
  async stopSpeech() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); },
  async openSpeechSettings() { throw Error('浏览器预览不能打开 Android 语音设置，请在手机安装版中操作。'); },
};

const plugin = registerPlugin<WordweaveNativePlugin>('WordweaveNative');
export const native: WordweaveNativePlugin = Capacitor.isNativePlatform() ? plugin : browser;
