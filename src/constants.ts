import { FW } from './registers';

// ── EYOU PH11B-51-C Motor Specifications ─────────────────────────────────────
// Rated torque : 3.5 Nm
// Peak torque  : 17.0 Nm (instantaneous max)
export const PH11_SPEC = {
  rated: 3.5,    // Nm
  peak:  17.0,   // Nm
} as const;

// ── 폴링 / 차트 샘플 주기 ─────────────────────────────────────────────────────
/** 폴링 주기 (ms) — 모니터 블록(입력 11 + 홀딩 5 워드)을 한 사이클에 읽는다 */
export const POLL_MS = 200;
/**
 * 차트 클록 (ms) — dmt-gripper-controller 와 동일한 50 ms.
 * 폴링과 무관하게 앱이 켜진 순간부터 계속 돌며 마지막 읽기값을 샘플한다.
 * 짧은 틱이 한 스텝을 ~1 px 로 유지해 선이 뚝뚝 끊기지 않고 흘러간다.
 */
export const CHART_TICK_MS = 50;
export const PERIOD_SEC    = CHART_TICK_MS / 1000;

// ── UI 단위 (0~255) ↔ 펌웨어 레지스터 단위 변환 ──────────────────────────────
// UI 슬라이더/버튼은 0~255 정규화 값을 쓰고, 레지스터에 쓸 때 펌웨어 단위로 바꾼다.
export const UI_MAX = 255;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 위치 UI(0~255) → REG_POSITION_REQUEST (0.1 deg, 0 ~ -2000) */
export const posToReg   = (v: number) => Math.round((v / UI_MAX) * FW.POS_REG_CLOSED);
/** 위치 레지스터 (0.1 deg) → 위치 UI(0~255) */
export const regToPos   = (reg: number) => clamp(Math.round((reg / FW.POS_REG_CLOSED) * UI_MAX), -UI_MAX, UI_MAX);
/** 0.1 deg → deg */
export const regToDeg   = (reg: number) => reg / 10;
/** 속도 UI(0~255) → REG_SPEED_REQUEST (deg/s, 최소 1 — 0 이면 펌웨어가 이동하지 않음) */
export const speedToReg = (v: number) => Math.max(1, Math.round((v / UI_MAX) * FW.SPEED_MAX));
/** 힘 UI(0~255) → REG_FORCE_REQUEST (0.1 %TR, 0 ~ 1000) */
export const forceToReg = (v: number) => Math.round((v / UI_MAX) * FW.TORQUE_FULL);

/** 토크 레지스터(0.1 %TR, 1000 = 100 %) → Nm */
export const torqueToNm = (permille: number): number =>
  parseFloat(((permille / FW.TORQUE_FULL) * PH11_SPEC.rated).toFixed(3));
