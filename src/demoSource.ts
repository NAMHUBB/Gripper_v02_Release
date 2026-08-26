// ── 데모(시뮬레이션) 데이터 소스 ──────────────────────────────────────────────
// 실제 그리퍼(Modbus RTU)가 연결되지 않은 환경에서 Connect 시 사용된다.
// - 위치       : 사인파 스윕(0~255) 또는 사용자 지령값 추종 (속도 제한 + 1차 지연)
// - 전류/힘    : 속도·파지 상태에 비례 + 리플/노이즈
// - ADC 0~5    : 서로 다른 주파수/위상의 사인파 + 부하 성분 + 노이즈 (0~4095 카운트)

const TWO_PI = Math.PI * 2;

/** 지령 없이 자유 운전할 때의 사인파 스윕 주기 (초) */
const SWEEP_PERIOD = 8;

// ADC 채널별 특성 (12bit, 0~4095 카운트)
//  base : 무부하 오프셋 — 채널마다 조금씩 다름
//  drift: 저주파 드리프트 진폭 (수십 카운트 수준)
//  freq : 드리프트 주파수 (Hz)
//  load : 파지 하중에 대한 감도 (접촉하는 손가락일수록 크다)
const ADC_PROFILE = [
  { base: 512, drift: 18, freq: 0.07, phase: 0.0,               load: 1.00 },
  { base: 486, drift: 14, freq: 0.11, phase: Math.PI / 3,       load: 0.82 },
  { base: 530, drift: 10, freq: 0.05, phase: (2 * Math.PI) / 3, load: 0.46 },
  { base: 498, drift: 16, freq: 0.09, phase: Math.PI,           load: 0.94 },
  { base: 470, drift: 12, freq: 0.06, phase: (4 * Math.PI) / 3, load: 0.38 },
  { base: 521, drift: 9,  freq: 0.13, phase: (5 * Math.PI) / 3, load: 0.61 },
] as const;

/** 정격 하중에서의 최대 상승폭 (counts) */
const ADC_LOAD_SPAN = 1200;
const ADC_MAX       = 4095;

/** 파지(접촉) 판정 위치 — 이 값 이상으로 닫히면 물체를 잡은 것으로 간주 */
const GRIP_POS   = 225;
const POS_MAX    = 255;

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
  currentActual:  number;    // mA
  adc:            number[];  // 6채널 (0~4095)
  objectDetected: boolean;
}

export class DemoSimulator {
  private t       = 0;   // 경과 시간 (s)
  private pos     = 0;   // 실제 위치 (0~255)
  private echo    = 0;   // 지령 에코 (0~255)
  private current = 0;   // 전류 (mA)

  reset(): void {
    this.t = 0;
    this.pos = 0;
    this.echo = 0;
    this.current = 0;
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
        ? clamp(cmd.positionRequest, 0, POS_MAX)
        : (POS_MAX / 2) * (1 - Math.cos((TWO_PI * t) / SWEEP_PERIOD));

    // ── 2. 위치 추종: 1차 지연 + 속도 제한 ──────────────────────────────────
    const prevPos = this.pos;
    // 속도가 빠를수록 시정수(tau)가 작아져 지령을 더 바짝 따라간다.
    const tau      = 0.60 - (cmd.speed / 255) * 0.35;                // 0.25~0.60 s
    const alpha    = cmd.eStop ? 0 : 1 - Math.exp(-dt / tau);
    const maxRate  = cmd.eStop ? 0 : 60 + (cmd.speed / 255) * 300;   // units/s
    const delta    = clamp((target - this.pos) * alpha, -maxRate * dt, maxRate * dt);
    this.pos       = clamp(this.pos + delta, 0, POS_MAX);
    this.echo      = cmd.eStop ? this.echo : target;

    const vel = dt > 0 ? (this.pos - prevPos) / dt : 0;             // units/s

    // ── 3. 전류(mA) → Force(Nm)로 환산되어 표시됨 ───────────────────────────
    const forceScale = 0.35 + (cmd.force / 255) * 0.65;
    const gripping   = !cmd.eStop && this.pos >= GRIP_POS && Math.abs(target - this.pos) < 12;

    let targetCurrent = 0;
    if (!cmd.eStop) {
      targetCurrent =
        90 * forceScale +                       // 무부하 유지 전류
        Math.abs(vel) * 2.6 * forceScale +      // 가감속 부하
        (gripping ? 180 + (cmd.force / 255) * 1500 : 0); // 파지 시 상승
    }
    // 전류는 급변하지 않도록 1차 지연 필터(tau=0.4s)를 통과시킨다.
    this.current += (targetCurrent - this.current) * (1 - Math.exp(-dt / 0.4));

    const ripple  = cmd.eStop ? 0 : 28 * Math.sin(TWO_PI * 3 * t) + 12 * Math.sin(TWO_PI * 7.5 * t);
    const current = Math.max(0, this.current + ripple + (Math.random() - 0.5) * 18);

    // ── 4. ADC 6채널 ────────────────────────────────────────────────────────
    // 평상시에는 오프셋 근처에서 미세하게 흔들리고, 파지 하중이 걸릴 때만 상승한다.
    const closeRatio = clamp((this.pos - GRIP_POS * 0.6) / (POS_MAX - GRIP_POS * 0.6), 0, 1);
    const loadRatio  = clamp(current / 1800, 0, 1) * closeRatio;
    const adc = ADC_PROFILE.map(p => {
      const drift = p.drift * Math.sin(TWO_PI * p.freq * t + p.phase);
      const value =
        p.base +
        drift +
        loadRatio * ADC_LOAD_SPAN * p.load +
        (Math.random() - 0.5) * 4;                 // 양자화 노이즈 ±2 counts
      return Math.round(clamp(value, 0, ADC_MAX));
    });

    return {
      positionEcho:   Math.round(this.echo),
      positionActual: Math.round(this.pos),
      currentActual:  Math.round(current),
      adc,
      objectDetected: gripping && current > 600,
    };
  }
}

/** 데모 샘플 → Modbus 입력 레지스터(2000~2015) 맵 */
export const demoInputRegisters = (
  s: DemoSample,
  cmd: DemoCommand,
): Record<number, number> => {
  const toDeg01 = (v: number) => Math.round((v / 255) * -2000); // 0.1deg 단위
  const moving  = Math.abs(s.positionEcho - s.positionActual) > 2;

  // bit0: activated, bit1: moving, bit2: object detected, bit3: e-stop
  const actionStatus =
    (cmd.activated ? 1 : 0) |
    (moving ? 2 : 0) |
    (s.objectDetected ? 4 : 0) |
    (cmd.eStop ? 8 : 0);

  return {
    2000: actionStatus,
    2001: 0,
    2002: 0,                                            // fault 없음
    2003: toDeg01(s.positionEcho),
    2004: toDeg01(s.positionActual),
    2005: Math.round((s.currentActual / 2000) * 1000),  // 0.1% of rated torque
    2006: 0,
    2007: 0,
    2010: s.adc[0], 2011: s.adc[1], 2012: s.adc[2],
    2013: s.adc[3], 2014: s.adc[4], 2015: s.adc[5],
  };
};
