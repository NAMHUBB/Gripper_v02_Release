// ── 데모(시뮬레이션) 데이터 소스 ──────────────────────────────────────────────
// 실제 그리퍼(Modbus RTU)가 연결되지 않은 환경에서 Connect 시 사용된다.
// 펌웨어 레지스터 단위(0.1 deg / 0.1 %TR / mV)와 상태 비트(gACT·gERR·gBRK·gRUN)를 그대로 흉내낸다.
// - 위치   : 사인파 스윕(0~255) 또는 사용자 지령값 추종 (속도 제한 + 1차 지연)
// - 토크   : 속도·파지 상태에 비례 + 리플/노이즈 (0.1 %TR, 1000 = 정격)
// - ADC0~5 : 저주파 드리프트 + 파지 하중 성분 + 노이즈 (mV, 0~3300) — 채널마다 오프셋/위상 다름

import { REG, STATUS_BIT, ADC_ADDRS, ADC_COUNT } from './registers';
import { posToReg, UI_MAX } from './constants';

const TWO_PI = Math.PI * 2;

/** 지령 없이 자유 운전할 때의 사인파 스윕 주기 (초) */
const SWEEP_PERIOD = 8;

// ADC 채널 특성 (mV) — ADC0 ~ ADC5
//  base : 무부하 오프셋
//  drift: 저주파 드리프트 진폭
//  freq : 드리프트 주파수 (Hz)
//  load : 정격 하중에서의 최대 상승폭 (채널마다 감도 다름)
const ADC_CH = [
  { base: 1650, drift: 30, freq: 0.07, load: 1200 },
  { base: 1500, drift: 40, freq: 0.05, load:  900 },
  { base: 1800, drift: 25, freq: 0.09, load:  700 },
  { base: 1200, drift: 35, freq: 0.06, load: 1000 },
  { base: 2000, drift: 20, freq: 0.11, load:  500 },
  { base:  900, drift: 45, freq: 0.04, load: 1400 },
] as const;
const ADC_MAX_MV    = 3300;

/** 파지(접촉) 판정 위치 — 이 값 이상으로 닫히면 물체를 잡은 것으로 간주 */
const GRIP_POS = 225;
/** 토크 최대 (0.1 %TR) */
const TORQUE_FULL = 1000;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface DemoCommand {
  activated:       boolean;
  goToPosition:    boolean;
  eStop:           boolean;
  positionRequest: number;   // 0~255
  speed:           number;   // 0~255
  force:           number;   // 0~255
}

export interface DemoSample {
  positionEcho:   number;    // 0~255
  positionActual: number;    // 0~255
  torqueActual:   number;    // 0.1 %TR (0~1000)
  adc:            number[];  // mV · ADC0 ~ ADC5
  objectDetected: boolean;
}

export class DemoSimulator {
  private t      = 0;   // 경과 시간 (s)
  private pos    = 0;   // 실제 위치 (0~255)
  private echo   = 0;   // 지령 에코 (0~255)
  private torque = 0;   // 토크 (0.1 %TR)

  reset(): void {
    this.t = 0;
    this.pos = 0;
    this.echo = 0;
    this.torque = 0;
  }

  /** dt(초)만큼 시뮬레이션을 진행하고 한 샘플을 반환한다. */
  step(dt: number, cmd: DemoCommand): DemoSample {
    this.t += dt;
    const t = this.t;

    // ── 1. 목표 위치 ────────────────────────────────────────────────────────
    // 사용자가 Go to Position을 켜면 지령값을, 아니면 사인파 스윕을 따라간다.
    const manual = cmd.activated && cmd.goToPosition;
    const target = cmd.eStop
      ? this.pos
      : manual
        ? clamp(cmd.positionRequest, 0, UI_MAX)
        : (UI_MAX / 2) * (1 - Math.cos((TWO_PI * t) / SWEEP_PERIOD));

    // ── 2. 위치 추종: 1차 지연 + 속도 제한 ──────────────────────────────────
    const prevPos = this.pos;
    // 속도가 빠를수록 시정수(tau)가 작아져 지령을 더 바짝 따라간다.
    const tau      = 0.60 - (cmd.speed / UI_MAX) * 0.35;                // 0.25~0.60 s
    const alpha    = cmd.eStop ? 0 : 1 - Math.exp(-dt / tau);
    const maxRate  = cmd.eStop ? 0 : 60 + (cmd.speed / UI_MAX) * 300;   // units/s
    const delta    = clamp((target - this.pos) * alpha, -maxRate * dt, maxRate * dt);
    this.pos       = clamp(this.pos + delta, 0, UI_MAX);
    this.echo      = cmd.eStop ? this.echo : target;

    const vel = dt > 0 ? (this.pos - prevPos) / dt : 0;             // units/s

    // ── 3. 토크 (0.1 %TR) ───────────────────────────────────────────────────
    const forceScale = 0.35 + (cmd.force / UI_MAX) * 0.65;
    const gripping   = !cmd.eStop && this.pos >= GRIP_POS && Math.abs(target - this.pos) < 12;

    let targetTorque = 0;
    if (!cmd.eStop) {
      targetTorque =
        45 * forceScale +                       // 무부하 유지 토크
        Math.abs(vel) * 1.3 * forceScale +      // 가감속 부하
        (gripping ? 90 + (cmd.force / UI_MAX) * 750 : 0); // 파지 시 상승 (힘 지령에 비례)
    }
    // 토크는 급변하지 않도록 1차 지연 필터(tau=0.4s)를 통과시킨다.
    this.torque += (targetTorque - this.torque) * (1 - Math.exp(-dt / 0.4));

    const ripple = cmd.eStop ? 0 : 14 * Math.sin(TWO_PI * 3 * t) + 6 * Math.sin(TWO_PI * 7.5 * t);
    const torque = clamp(this.torque + ripple + (Math.random() - 0.5) * 9, 0, TORQUE_FULL);

    // ── 4. ADC0 ~ ADC5 (mV) ────────────────────────────────────────────────
    // 평상시에는 오프셋 근처에서 미세하게 흔들리고, 파지 하중이 걸릴 때만 상승한다.
    const closeRatio = clamp((this.pos - GRIP_POS * 0.6) / (UI_MAX - GRIP_POS * 0.6), 0, 1);
    const loadRatio  = clamp(torque / 900, 0, 1) * closeRatio;
    const adc = ADC_CH.slice(0, ADC_COUNT).map((ch, i) => {
      const drift = ch.drift * Math.sin(TWO_PI * ch.freq * t + i);          // 채널별 위상차
      return Math.round(clamp(
        ch.base + drift + loadRatio * ch.load + (Math.random() - 0.5) * 4,  // 양자화 노이즈 ±2 mV
        0, ADC_MAX_MV,
      ));
    });

    return {
      positionEcho:   Math.round(this.echo),
      positionActual: Math.round(this.pos),
      torqueActual:   Math.round(torque),
      adc,
      objectDetected: gripping && torque > 300,
    };
  }
}

/** 데모 샘플 → Modbus 입력 레지스터 맵 (펌웨어가 쓰는 주소만) */
export const demoInputRegisters = (
  s: DemoSample,
  cmd: DemoCommand,
): Record<number, number> => {
  const moving = Math.abs(s.positionEcho - s.positionActual) > 2;

  // 펌웨어 REG_ACTION_STATUS 구성과 동일: gACT / gERR / gBRK / gRUN
  const actionStatus =
    (cmd.activated ? STATUS_BIT.gACT : 0) |
    (cmd.activated ? STATUS_BIT.gBRK : 0) |               // 서보 ON 이면 브레이크 해제
    (cmd.activated && !cmd.eStop && moving ? STATUS_BIT.gRUN : 0);

  return {
    [REG.ACTION_STATUS]: actionStatus,
    [REG.FAULT_STATUS]:  0,                              // fault 없음
    [REG.POSITION_ECHO]: posToReg(s.positionEcho),
    [REG.CURR_POSITION]: posToReg(s.positionActual),
    [REG.CURR_TORQUE]:   s.torqueActual,
    ...Object.fromEntries(ADC_ADDRS.map((addr, ch) => [addr, s.adc[ch] ?? 0])),
  };
};
