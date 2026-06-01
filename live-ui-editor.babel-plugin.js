// JS 파일이므로 타입 지정(: any[])을 삭제했습니다.
export default function liveUiEditorPlugin() {
  return {
    name: 'live-ui-editor-plugin',
    visitor: {
      // 플러그인 로직 작성...
      // 예시: Identifier(path) { ... }
    },
  };
}