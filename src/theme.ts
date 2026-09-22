// ── UI 색상 토큰 ──────────────────────────────────────────────────────────────
// 글자 색상은 모두 블루 계열 한 팔레트로 통일한다. (회색 텍스트 사용 금지)
// 상태(ok/warn/danger)와 차트 데이터 시리즈 색은 의미 구분을 위해 예외로 둔다.
export const C = {
  // ── 텍스트 (진한 → 흐린 순) ─────────────────────────────────────────────
  text:    '#0F2F55',   // 본문 · 값 (딥 네이비)
  title:   '#1565C0',   // 패널 제목 · 강조
  accent:  '#1976D2',   // 액티브 · 주요 버튼 · 링크
  sub:     '#3D6A9B',   // 보조 텍스트 · 라벨
  muted:   '#7FA1C8',   // 흐린 텍스트 · 축 눈금 · 힌트
  faint:   '#AFC6E0',   // 플레이스홀더 · 비활성

  // ── 면 · 선 ─────────────────────────────────────────────────────────────
  app:         '#EEF3F9',   // 앱 배경
  surface:     '#FFFFFF',   // 패널
  surfaceAlt:  '#F5F9FD',   // 표 줄무늬 · 카드 안 카드
  surfaceTint: '#E8F1FB',   // 선택/활성 배경
  line:        '#D9E5F2',   // 테두리
  lineSoft:    '#E9F0F8',   // 약한 테두리 · 구분선
  grid:        '#EEF3F9',   // 차트 그리드

  // ── 상태 (텍스트 통일 예외) ─────────────────────────────────────────────
  ok:       '#2E7D32',
  okBg:     '#E8F5E9',
  warn:     '#EF6C00',
  warnBg:   '#FFF3E0',
  warnLine: '#FFCC80',
  danger:   '#C62828',
  dangerBg: '#FFEBEE',

  // ── 차트 시리즈 (dmt-gripper-controller 차트와 동일: Position 파랑 · Torque 빨강) ──
  seriesActual: '#2563EB',   // Position (actual)
  seriesEcho:   '#93C5FD',   // Position (echo, 점선)
  seriesTorque: '#EF4444',   // Torque
  seriesAdc:    '#0D47A1',   // ADC 대표색 (읽기값 타일)
  /** ADC0 ~ ADC5 시리즈 색 (우측 축) — 파랑/보라/청록 계열로 Torque 빨강과 구분 */
  seriesAdcCh:  ['#0D47A1', '#7C3AED', '#0891B2', '#059669', '#D97706', '#DB2777'],

  // ── 글꼴 ────────────────────────────────────────────────────────────────
  mono: '"Consolas", "Courier New", monospace',
  font: "'Inter', 'Segoe UI', sans-serif",
} as const;
