import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// TAURI_ENV_PLATFORM이 'android'인 경우 true
const isAndroid = process.env.TAURI_ENV_PLATFORM === 'android';

export default defineConfig(async () => {
  const babelPlugins: any[] = [];

  // 안드로이드가 아닐 때만 라이브 에디터 플러그인 로드
  if (!isAndroid) {
    try {
      // 확장자를 명시하지 않거나 .ts로 변경하는 것이 안전합니다.
      const plugin = await import('./live-ui-editor.babel-plugin');
      const pluginContent = plugin.default ?? plugin;
      
      // 유효한 함수/객체인지 확인 후 푸시
      if (pluginContent) {
        babelPlugins.push(pluginContent);
      }
    } catch (error) {
      console.warn('live-ui-editor plugin not found, skipping...');
    }
  }

  return {
    plugins: [
      react({
        babel: {
          // babelPlugins가 비어있어도 빈 배열을 전달하면 안전합니다.
          plugins: babelPlugins,
        },
      }),
    ],
    server: {
      host: '0.0.0.0', // 안드로이드 기기 접속을 위해 필요
      port: 5173,
      strictPort: true,
    },
  };
});