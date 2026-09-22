// ── 레지스터 맵 (UI 기준 · 연속 번호) ───────────────────────────────────────────
// 구 펌웨어 맵의 RESERVED 를 걷어내고 번호를 순서대로 다시 매겼다.
//   Input   2000 ~ 2004  + 2010 ~ 2015 (ADC0 ~ ADC5)
//   Holding 1000 ~ 1004
// ※ 펌웨어(stm-clicker4 · src/modbus.rs)의 REG_* 상수도 같은 값으로 맞춰야 통신이 된다.
//   (구 맵: 2000/2002/2003/2004/2005/2010 · 1000/1003/1004/1005/1006)
// 통신: Modbus RTU · 8N1 고정 · 115200 bps · Slave ID 1

export const FW = {
  BAUD_RATE: 115200,
  SLAVE_ID:  1,
  /** 위치 레지스터 단위: 0.1 deg. 0 = 완전 열림, -2000(-200°) = 완전 닫힘 */
  POS_REG_CLOSED: -2000,
  /** 속도 최대 (deg/s) */
  SPEED_MAX: 360,
  /** 힘/토크 레지스터 단위: 0.1 % of rated torque → 1000 = 100 % */
  TORQUE_FULL: 1000,
  /** 가속도 고정값 (deg/s²) */
  ACC_DEFAULT: 50,
} as const;

// ── 주소 ──────────────────────────────────────────────────────────────────────
export const REG = {
  // Holding (쓰기, FC06/FC16)
  ACTION_REQUEST:   1000,
  POSITION_REQUEST: 1001,
  SPEED_REQUEST:    1002,
  FORCE_REQUEST:    1003,
  ACC_REQUEST:      1004,
  // Input (읽기, FC04)
  ACTION_STATUS:    2000,
  FAULT_STATUS:     2001,
  POSITION_ECHO:    2002,
  CURR_POSITION:    2003,
  CURR_TORQUE:      2004,
  ADC0_VOLTAGE:     2010,
  ADC1_VOLTAGE:     2011,
  ADC2_VOLTAGE:     2012,
  ADC3_VOLTAGE:     2013,
  ADC4_VOLTAGE:     2014,
  ADC5_VOLTAGE:     2015,
} as const;

/** ADC 채널 수 (ADC0 ~ ADC5) */
export const ADC_COUNT = 6;
/** ADC 채널 주소 — 2010 + ch */
export const ADC_ADDRS: readonly number[] = Array.from({ length: ADC_COUNT }, (_, ch) => REG.ADC0_VOLTAGE + ch);
/** ADC 레지스터 블록 (연속) — 2010 ~ 2015 */
export const ADC_RANGE = { first: REG.ADC0_VOLTAGE, last: REG.ADC5_VOLTAGE } as const;

/** 홀딩 레지스터 블록 (연속) */
export const HOLDING_RANGE = { first: REG.ACTION_REQUEST, last: REG.ACC_REQUEST } as const;
/** 폴링용 입력 레지스터 블록 — 2005~2009 는 비어 있고 2010~2015 가 ADC0~ADC5 */
export const INPUT_RANGE   = { first: REG.ACTION_STATUS, last: REG.ADC5_VOLTAGE } as const;
/** 상태/위치/토크 입력 레지스터 (ADC 제외) — 2000 ~ 2004 */
export const STATUS_RANGE  = { first: REG.ACTION_STATUS, last: REG.CURR_TORQUE } as const;

// ── REG_ACTION_REQUEST (1000) 비트 ──────────────────────────────────────────
export const ACTION_BIT = {
  rACT: 0x01,  // bit0: Servo ON/OFF
  rRST: 0x02,  // bit1: Fault Reset (상승 엣지)
  rBRK: 0x04,  // bit2: Brake release (rACT=0 일 때)
  rTRQ: 0x08,  // bit3: Torque control mode (상승 엣지)
  rPOS: 0x10,  // bit4: Position control mode → MoveJ (상승 엣지)
  rSTP: 0x20,  // bit5: Quick stop → StopJ (상승 엣지)
} as const;

// ── REG_ACTION_STATUS (2000) 비트 ───────────────────────────────────────────
export const STATUS_BIT = {
  gACT: 0x01,  // bit0: Servo ON
  gERR: 0x02,  // bit1: Fault (rRST 까지 래치)
  gBRK: 0x04,  // bit2: Brake released
  gRUN: 0x08,  // bit3: Motor moving (또는 CST 제한토크 유지 중)
} as const;

export const STATUS_BITS = [
  { key: 'gACT', mask: STATUS_BIT.gACT, label: 'ACT', title: 'Servo ON' },
  { key: 'gERR', mask: STATUS_BIT.gERR, label: 'ERR', title: 'Fault (latched)' },
  { key: 'gBRK', mask: STATUS_BIT.gBRK, label: 'BRK', title: 'Brake released' },
  { key: 'gRUN', mask: STATUS_BIT.gRUN, label: 'RUN', title: 'Moving' },
] as const;

/** 폴링 한 사이클에 읽는 블록 — 입력 2000~2015(16, ADC0~5 포함), 홀딩 1000~1004(5) */
export const MONITOR_BLOCK = {
  inputAddress:    INPUT_RANGE.first,
  inputQuantity:   INPUT_RANGE.last - INPUT_RANGE.first + 1,
  holdingAddress:  HOLDING_RANGE.first,
  holdingQuantity: HOLDING_RANGE.last - HOLDING_RANGE.first + 1,
} as const;

// ── 표시용 정의 ───────────────────────────────────────────────────────────────
export type RegFormat = 'Dec16' | 'Int16' | 'Bin4' | 'Bin6' | 'Bin16' | 'Hex16';
export const FORMAT_OPTIONS: RegFormat[] = ['Dec16', 'Int16', 'Bin4', 'Bin6', 'Bin16', 'Hex16'];

export interface RegisterDef {
  addr:    number;
  name:    string;
  unit:    string;
  format:  RegFormat;
  desc:    string;
  range?:  string;
}

export const INPUT_REGISTERS: RegisterDef[] = [
  { addr: REG.ACTION_STATUS, name: 'REG_ACTION_STATUS', unit: 'bits',    format: 'Bin4',  desc: 'bit0 gACT · bit1 gERR · bit2 gBRK · bit3 gRUN' },
  { addr: REG.FAULT_STATUS,  name: 'REG_FAULT_STATUS',  unit: 'code',    format: 'Hex16', desc: '모터 에러코드 (0x603F) · rRST 까지 래치' },
  { addr: REG.POSITION_ECHO, name: 'REG_POSITION_ECHO', unit: '0.1 deg', format: 'Int16', desc: `목표 위치 에코 (${REG.POSITION_REQUEST} 미러)` },
  { addr: REG.CURR_POSITION, name: 'REG_CURR_POSITION', unit: '0.1 deg', format: 'Int16', desc: '현재 위치 · 0 = 열림, -2000 = 닫힘' },
  { addr: REG.CURR_TORQUE,   name: 'REG_CURR_TORQUE',   unit: '0.1 %TR', format: 'Int16', desc: '현재 토크 · 1000 = 정격 100 % (3.5 Nm)' },
];

/** ADC 입력 레지스터 (FC04) — Input 섹션과 분리해서 표시 */
export const ADC_REGISTERS: RegisterDef[] = ADC_ADDRS.map((addr, ch) => ({
  addr, name: `ADC${ch}_VOLTAGE`, unit: 'mV', format: 'Int16', desc: `ADC CH${ch} 전압 (1 mV 단위)`,
}));

export const HOLDING_REGISTERS: RegisterDef[] = [
  { addr: REG.ACTION_REQUEST,   name: 'REG_ACTION_REQUEST',   unit: 'bits',    format: 'Bin6',  range: '1 / 3 / 17 / 33', desc: 'bit0 rACT · bit1 rRST · bit2 rBRK · bit3 rTRQ · bit4 rPOS · bit5 rSTP' },
  { addr: REG.POSITION_REQUEST, name: 'REG_POSITION_REQUEST', unit: '0.1 deg', format: 'Int16', range: '-2000 ~ 0',       desc: '목표 위치 · 0 = 열림, -2000 = 닫힘' },
  { addr: REG.SPEED_REQUEST,    name: 'REG_SPEED_REQUEST',    unit: 'deg/s',   format: 'Dec16', range: '1 ~ 360',         desc: '속도 · 0 이면 이동하지 않음' },
  { addr: REG.FORCE_REQUEST,    name: 'REG_FORCE_REQUEST',    unit: '0.1 %TR', format: 'Dec16', range: '0 ~ 1000',        desc: '토크 제한 · 1000 = 정격 3.5 Nm' },
  { addr: REG.ACC_REQUEST,      name: 'REG_ACC_REQUEST',      unit: 'deg/s²',  format: 'Dec16', range: '1 ~',             desc: '가속도 · 0 이면 이동하지 않음 (UI 고정값 50)' },
];

export const ALL_REGISTERS: RegisterDef[] = [...INPUT_REGISTERS, ...ADC_REGISTERS, ...HOLDING_REGISTERS];

/** 레지스터 1000 에 UI 가 쓰는 값 */
export const ACTION_VALUES = [
  { dec: 0,  bin: '000000', meaning: 'Servo OFF',                              when: 'Activate OFF' },
  { dec: 1,  bin: '000001', meaning: 'Servo ON (rACT)',                        when: 'Activate ON · 트리거 해제' },
  { dec: 3,  bin: '000011', meaning: 'Servo ON + Fault Reset 트리거 (rRST)',    when: 'Reset Fault' },
  { dec: 17, bin: '010001', meaning: 'Servo ON + 위치 이동 트리거 (rPOS)',      when: 'OPEN / CLOSE / Position 변경' },
  { dec: 33, bin: '100001', meaning: 'Servo ON + Quick Stop (rSTP)',           when: 'E-STOP' },
] as const;

// ── 값 포맷 ───────────────────────────────────────────────────────────────────
export const formatRegister = (raw: number, fmt: RegFormat): string => {
  const u16 = raw < 0 ? raw + 65536 : raw;
  switch (fmt) {
    case 'Int16':  return String(raw);
    case 'Bin4':   return (u16 & 0x0F).toString(2).padStart(4,  '0');  // bit0~3
    case 'Bin6':   return (u16 & 0x3F).toString(2).padStart(6,  '0');  // bit0~5
    case 'Bin16':  return u16.toString(2).padStart(16, '0');
    case 'Hex16':  return '0x' + u16.toString(16).toUpperCase().padStart(4, '0');
    default:       return String(u16); // Dec16
  }
};
