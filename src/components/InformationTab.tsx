import React, { useState } from 'react';
import { Box, Typography, Divider } from '@mui/material';

// ── 색상 시스템 ───────────────────────────────────────────────────────────────
const C = {
  blue:       '#1565C0',
  blueMid:    '#1976D2',
  blueLight:  '#E3F2FD',
  bluePale:   '#F0F7FF',
  purple:     '#4527A0',
  purpleLight:'#EDE7F6',
  green:      '#2E7D32',
  greenLight: '#E8F5E9',
  orange:     '#BF360C',
  orangeLight:'#FBE9E7',
  teal:       '#00695C',
  tealLight:  '#E0F2F1',
  gray:       '#546E7A',
  grayLight:  '#F8FAFC',
  dark:       '#1A2A3A',
  line:       '#E0EAF4',
  white:      '#ffffff',
};

// ── 모터 사양 ─────────────────────────────────────────────────────────────────
const MOTOR_SPECS = [
  { key: 'Rated Torque',             value: '3.5 Nm',          highlight: true  },
  { key: 'Start-Stop Peak Torque',   value: '8.3 Nm',          highlight: false },
  { key: 'Avg. Max Torque',          value: '5.5 Nm',          highlight: false },
  { key: 'Instantaneous Max Torque', value: '17.0 Nm',         highlight: true  },
  { key: 'Rated Speed',              value: '60 rpm',          highlight: false },
  { key: 'Speed Ratio',              value: '51 : 1',          highlight: false },
  { key: 'Rated Power',              value: '50 W',            highlight: false },
  { key: 'Working Voltage',          value: '24 ~ 36 V',       highlight: false },
  { key: 'Motor Type',               value: 'Inner Rotor Torque Motor' },
  { key: 'Communication',            value: 'CANopen'          },
  { key: 'Encoder Type',             value: 'Dual Magnetic'    },
  { key: 'Encoder Accuracy',         value: '19-bit'           },
  { key: 'Diameter (OD)',            value: 'Ø 52 mm'          },
  { key: 'Inner Diameter',           value: '6 mm'             },
  { key: 'Weight',                   value: '455 g'            },
  { key: 'Reverse Backlash',         value: '15 arcsec'        },
  { key: 'Working Temp.',            value: '-20 ~ 80 °C'      },
  { key: 'Working Noise',            value: '< 60 dB (@30 cm)' },
];

// ── 레지스터 정의 ─────────────────────────────────────────────────────────────
const INPUT_REGS = [
  { addr: '2000', name: 'REG_ACTION_STATUS',   fmt: 'Bin16', desc: 'bit0=gACT  bit1=gERR  bit2=gBRK  bit3=gRUN' },
  { addr: '2001', name: 'RESERVED',            fmt: 'Dec16', desc: '—' },
  { addr: '2002', name: 'REG_FAULT_STATUS',    fmt: 'Dec16', desc: '폴트 코드' },
  { addr: '2003', name: 'REG_POSITION_ECHO',   fmt: 'Int16', desc: '목표위치 에코  (0.1deg)' },
  { addr: '2004', name: 'REG_CURR_POSITION',   fmt: 'Int16', desc: '현재 위치  (0.1deg)' },
  { addr: '2005', name: 'REG_CURR_TORQUE',     fmt: 'Int16', desc: '현재 토크  (0.1% TR)' },
  { addr: '2006', name: 'RESERVED',            fmt: 'Dec16', desc: '—' },
  { addr: '2007', name: 'REG_ORIGIN_POS_ECHO', fmt: 'Int16', desc: '원점 에코  (0.1deg)' },
  { addr: '2010', name: 'ADC0',                fmt: 'Int16', desc: '아날로그 센서 0' },
  { addr: '2011', name: 'ADC1',                fmt: 'Int16', desc: '아날로그 센서 1' },
  { addr: '2012', name: 'ADC2',                fmt: 'Int16', desc: '아날로그 센서 2' },
  { addr: '2013', name: 'ADC3',                fmt: 'Int16', desc: '아날로그 센서 3' },
  { addr: '2014', name: 'ADC4',                fmt: 'Int16', desc: '아날로그 센서 4' },
  { addr: '2015', name: 'ADC5',                fmt: 'Int16', desc: '아날로그 센서 5' },
];

const HOLDING_REGS = [
  { addr: '1000', name: 'REG_ACTION_REQUEST',   fmt: 'Bin16', range: '0 / 1 / 3 / 17 / 33', desc: 'bit0=rACT  bit1=rRST  bit2=rBRK  bit3=rTRQ  bit4=rPOS  bit5=rSTP' },
  { addr: '1001', name: 'RESERVED',             fmt: 'Dec16', range: '0',          desc: '—' },
  { addr: '1002', name: 'RESERVED',             fmt: 'Dec16', range: '0',          desc: '—' },
  { addr: '1003', name: 'REG_POSITION_REQUEST', fmt: 'Int16', range: '-2000 ~ 0',  desc: '목표위치  (0.1deg)  /  0=열림  -2000=닫힘' },
  { addr: '1004', name: 'REG_SPEED_REQUEST',    fmt: 'Dec16', range: '1 ~ 360',    desc: '속도  (deg/s)  /  0 입력 금지' },
  { addr: '1005', name: 'REG_FORCE_REQUEST',    fmt: 'Dec16', range: '0 ~ 1000',   desc: '토크  (0.1% TR)  /  1000 = 정격 3.5 Nm' },
  { addr: '1006', name: 'REG_ACC_REQUEST',      fmt: 'Dec16', range: '1 ~ 360',    desc: '가속도  (deg/s²)  /  0 입력 금지  /  스크립트 고정값=50' },
  { addr: '1007', name: 'REG_ORIGIN_POS',       fmt: 'Int16', range: '-2000 ~ 0',  desc: '원점 위치  (0.1deg)' },
];

// ── 스크립트 매핑 ─────────────────────────────────────────────────────────────
const SCRIPT_MAP = [
  {
    cmd: 'rq_activate_and_wait()',
    input: '없음',
    writes: [{ reg: '1000', val: '= 1' }],
    reads:  [{ reg: '2000', cond: 'bit0(gACT) = 1' }],
    color: C.blue,
  },
  {
    cmd: 'rq_open_and_wait()',
    input: '없음',
    writes: [
      { reg: '1003', val: '= 0' },
      { reg: '1004', val: '= 현재 speed' },
      { reg: '1005', val: '= 현재 force' },
      { reg: '1006', val: '= 50 (고정)' },
      { reg: '1000', val: '17 → 1 (rPOS 트리거)' },
    ],
    reads: [{ reg: '2000', cond: 'bit3(gRUN) = 0' }],
    color: C.green,
  },
  {
    cmd: 'rq_close_and_wait()',
    input: '없음',
    writes: [
      { reg: '1003', val: '= -2000' },
      { reg: '1004', val: '= 현재 speed' },
      { reg: '1005', val: '= 현재 force' },
      { reg: '1006', val: '= 50 (고정)' },
      { reg: '1000', val: '17 → 1 (rPOS 트리거)' },
    ],
    reads: [{ reg: '2000', cond: 'bit3(gRUN) = 0' }],
    color: C.green,
  },
  {
    cmd: 'rq_move_and_wait_norm(pct)',
    input: '0 ~ 100 (%)',
    writes: [
      { reg: '1003', val: '= -(pct/100)×2000' },
      { reg: '1004', val: '= 현재 speed' },
      { reg: '1005', val: '= 현재 force' },
      { reg: '1006', val: '= 50 (고정)' },
      { reg: '1000', val: '17 → 1 (rPOS 트리거)' },
    ],
    reads: [{ reg: '2000', cond: 'bit3(gRUN) = 0' }],
    color: C.green,
  },
  {
    cmd: 'rq_set_speed_norm(pct)',
    input: '0 ~ 100 (%)',
    writes: [{ reg: '1004', val: '= (pct/100)×360  →  1~360' }],
    reads:  [],
    color: C.purple,
  },
  {
    cmd: 'rq_set_force_norm(pct)',
    input: '0 ~ 100 (%)',
    writes: [{ reg: '1005', val: '= (pct/100)×1000  →  0~1000' }],
    reads:  [],
    color: C.purple,
  },
  {
    cmd: 'rq_reset()',
    input: '없음',
    writes: [{ reg: '1000', val: '3 → 1 (rRST 트리거)' }],
    reads:  [],
    color: C.orange,
  },
  {
    cmd: 'rq_emergency_release()',
    input: '없음',
    writes: [{ reg: '1000', val: '= 33 (rSTP=1)' }],
    reads:  [],
    color: C.orange,
  },
];

// ── 단위 변환표 ────────────────────────────────────────────────────────────────
const UNIT_ROWS = [
  { cmd: 'move_norm(0)',    reg: '1003 =     0', real: '0.0° (완전 열림)'    },
  { cmd: 'move_norm(25)',   reg: '1003 =  -500', real: '-50.0°'              },
  { cmd: 'move_norm(50)',   reg: '1003 = -1000', real: '-100.0°'             },
  { cmd: 'move_norm(75)',   reg: '1003 = -1500', real: '-150.0°'             },
  { cmd: 'move_norm(100)',  reg: '1003 = -2000', real: '-200.0° (완전 닫힘)' },
  { cmd: 'speed_norm(25)',  reg: '1004 =    90', real: '90 deg/s'            },
  { cmd: 'speed_norm(50)',  reg: '1004 =   180', real: '180 deg/s'           },
  { cmd: 'speed_norm(100)', reg: '1004 =   360', real: '360 deg/s  (정격 최대)' },
  { cmd: 'force_norm(25)',  reg: '1005 =   250', real: '0.88 Nm'             },
  { cmd: 'force_norm(40)',  reg: '1005 =   400', real: '1.40 Nm  (기본값)'   },
  { cmd: 'force_norm(50)',  reg: '1005 =   500', real: '1.75 Nm'             },
  { cmd: 'force_norm(100)', reg: '1005 =  1000', real: '3.5 Nm  (정격 최대)' },
];

// ── 1000번 비트 테이블 ─────────────────────────────────────────────────────────
const REG1000_BITS = [
  { dec: '1',  bin: '000001', meaning: 'Servo ON (rACT=1)',                   cmd: 'activate  /  트리거 해제'      },
  { dec: '3',  bin: '000011', meaning: 'Servo ON + 폴트 리셋 트리거 (rRST=1)', cmd: 'reset step1'                  },
  { dec: '17', bin: '010001', meaning: 'Servo ON + 위치제어 트리거 (rPOS=1)',   cmd: 'open / close / move step1'    },
  { dec: '33', bin: '100001', meaning: 'Servo ON + 즉시 정지 (rSTP=1)',         cmd: 'emergency_release'            },
];

// ── 내부 탭 목록 ──────────────────────────────────────────────────────────────
const TAB_ITEMS = ['Motor Spec', 'Unit Table'/*, 'Script Mapping', 'Register Map'*/];

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────────────────
const Badge: React.FC<{ text: string; color: string; bg: string }> = ({ text, color, bg }) => (
  <Box component="span" sx={{
    display: 'inline-block', px: 0.8, py: 0.15,
    bgcolor: bg, color, borderRadius: 0.8,
    fontSize: '0.6rem', fontWeight: 700,
    fontFamily: '"Consolas", monospace', letterSpacing: '0.02em', lineHeight: 1.6,
  }}>
    {text}
  </Box>
);

const AddrBadge: React.FC<{ addr: string; input?: boolean }> = ({ addr, input = false }) => (
  <Badge text={addr} color={input ? C.blue : C.purple} bg={input ? C.blueLight : C.purpleLight} />
);

const MonoText: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <Typography sx={{ fontFamily: '"Consolas", monospace', fontSize: '0.68rem', color: color ?? C.dark, lineHeight: 1.6 }}>
    {children}
  </Typography>
);

const SectionTitle: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
  <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: color ?? C.gray, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1 }}>
    {children}
  </Typography>
);

// ═══════════════════════════════════════════════════════════════════════════════
// InformationTab 
// ═══════════════════════════════════════════════════════════════════════════════
const InformationTab: React.FC = () => {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#fff', overflow: 'hidden' }}>

      {/* 내부 탭 헤더 */}
      <Box sx={{ display: 'flex', borderBottom: `2px solid ${C.line}`, px: 3, pt: 2, flexShrink: 0 }}>
        {TAB_ITEMS.map((label, i) => (
          <Box
            key={label}
            onClick={() => setActiveTab(i)}
            sx={{
              px: 2.5, py: 1.2, cursor: 'pointer', position: 'relative',
              fontSize: '0.75rem', fontWeight: activeTab === i ? 700 : 500,
              color: activeTab === i ? C.blueMid : C.gray,
              transition: 'color 0.15s',
              '&:hover': { color: C.blueMid },
              '&::after': {
                content: '""',
                position: 'absolute', bottom: -2, left: 0, right: 0, height: 2,
                bgcolor: activeTab === i ? C.blueMid : 'transparent',
                transition: 'background 0.15s',
              },
            }}
          >
            {label}
          </Box>
        ))}
      </Box>

      {/* 탭 컨텐츠 */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>

        {/* ── Motor Spec ─────────────────────────────────────────────────── */}
        {activeTab === 0 && (
          <Box sx={{ maxWidth: 480 }}>
            <Box sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.blueMid, letterSpacing: '0.1em', mb: 0.3 }}>
                MOTOR SPECIFICATION
              </Typography>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 700, color: C.dark }}>
                EYOU PH11-51-C
              </Typography>
              <Typography sx={{ fontSize: '0.72rem', color: C.gray, mt: 0.2 }}>
                Harmonic Drive Actuator · CANopen · Integrated Brake
              </Typography>
            </Box>
            <Divider sx={{ mb: 2, borderColor: C.line }} />
            <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ bgcolor: C.blueMid, px: 2, py: 1 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#fff' }}>PH11B-51-C</Typography>
                <Typography sx={{ fontSize: '0.6rem', color: C.blueLight }}>51:1 · 60 rpm · Ø52mm · 455g</Typography>
              </Box>
              <Box sx={{ bgcolor: C.grayLight, px: 2, py: 0.5 }}>
                {MOTOR_SPECS.map((s, i) => (
                  <Box key={s.key} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.6, borderBottom: i < MOTOR_SPECS.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                    <Typography sx={{ fontSize: '0.7rem', color: C.gray }}>{s.key}</Typography>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: s.highlight ? 700 : 500, color: s.highlight ? C.blueMid : C.dark, fontFamily: 'monospace' }}>
                      {s.value}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}

        {/* ── Script Mapping ─────────────────────────────────────────────── */}
        {/* {activeTab === 3 && (
          <Box>
            <SectionTitle color={C.blueMid}>Script Command → Modbus Register Mapping</SectionTitle>

            <Box sx={{ mb: 2.5, p: 1.5, bgcolor: C.bluePale, borderRadius: 2, border: `1px solid ${C.blueLight}` }}>
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: C.blue, mb: 0.8 }}>
                실행 기본값 (스크립트 시작 시 자동 설정)
              </Typography>
              <Box sx={{ display: 'flex', gap: 3 }}>
                {[
                  { label: 'speed_norm', val: '50%',  reg: '1004 = 180 deg/s'    },
                  { label: 'force_norm', val: '40%',  reg: '1005 = 400 (1.4 Nm)' },
                  { label: 'acc',        val: '고정', reg: '1006 = 50 deg/s²'    },
                  { label: 'timeout',    val: '대기', reg: '최대 10,000 ms'       },
                ].map(({ label, val, reg }) => (
                  <Box key={label}>
                    <Typography sx={{ fontSize: '0.6rem', color: C.gray }}>{label}</Typography>
                    <MonoText color={C.blue}>{val}</MonoText>
                    <Typography sx={{ fontSize: '0.6rem', color: C.gray }}>{reg}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
              {SCRIPT_MAP.map(({ cmd, input, writes, reads, color }) => (
                <Box key={cmd} sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1.8, py: 0.9, bgcolor: `${color}14`, borderBottom: `1px solid ${C.line}` }}>
                    <MonoText color={color}>{cmd}</MonoText>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                      <Typography sx={{ fontSize: '0.6rem', color: C.gray }}>입력값</Typography>
                      <Badge text={input} color={input === '없음' ? C.gray : color} bg={input === '없음' ? C.grayLight : `${color}18`} />
                    </Box>
                  </Box>
                  <Box sx={{ display: 'grid', gridTemplateColumns: reads.length > 0 ? '1fr 1fr' : '1fr', px: 1.8, py: 1, gap: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: C.purple, mb: 0.5, letterSpacing: '0.05em' }}>WRITE</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                        {writes.map(({ reg, val }) => (
                          <Box key={reg + val} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                            <AddrBadge addr={reg} />
                            <MonoText color={C.dark}>{val}</MonoText>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    {reads.length > 0 && (
                      <Box>
                        <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, color: C.blue, mb: 0.5, letterSpacing: '0.05em' }}>READ (완료 조건)</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                          {reads.map(({ reg, cond }) => (
                            <Box key={reg} sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                              <AddrBadge addr={reg} input />
                              <MonoText color={C.gray}>{cond}</MonoText>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>

            <Box sx={{ mt: 2.5 }}>
              <SectionTitle>레지스터 1000 (REG_ACTION_REQUEST) 사용 값</SectionTitle>
              <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '50px 90px 1fr 1fr', px: 1.5, py: 0.7, bgcolor: '#F0F4F8', borderBottom: `1px solid ${C.line}` }}>
                  {['Dec', 'Binary', '의미', '사용 시점'].map(h => (
                    <Typography key={h} sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.gray }}>{h}</Typography>
                  ))}
                </Box>
                {REG1000_BITS.map(({ dec, bin, meaning, cmd: c }, i) => (
                  <Box key={dec} sx={{ display: 'grid', gridTemplateColumns: '50px 90px 1fr 1fr', px: 1.5, py: 0.9, alignItems: 'center', bgcolor: i % 2 === 0 ? C.white : C.grayLight, borderBottom: i < REG1000_BITS.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                    <MonoText color={C.purple}>{dec}</MonoText>
                    <MonoText color={C.dark}>{bin}</MonoText>
                    <Typography sx={{ fontSize: '0.68rem', color: C.dark }}>{meaning}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: C.gray }}>{c}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )} */}

        {/* ── Register Map ───────────────────────────────────────────────── */}
        {/* {activeTab === 4 && (
          <Box>
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <SectionTitle color={C.purple}>Holding Register (쓰기)</SectionTitle>
                <Badge text="1000 ~ 1007" color={C.purple} bg={C.purpleLight} />
              </Box>
              <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '55px 180px 60px 110px 1fr', px: 1.5, py: 0.8, bgcolor: '#F0F4F8', borderBottom: `1px solid ${C.line}` }}>
                  {['Addr', 'Name', 'Format', 'Range', 'Description'].map(h => (
                    <Typography key={h} sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.gray }}>{h}</Typography>
                  ))}
                </Box>
                {HOLDING_REGS.map(({ addr, name, fmt, range, desc }, i) => (
                  <Box key={addr} sx={{ display: 'grid', gridTemplateColumns: '55px 180px 60px 110px 1fr', px: 1.5, py: 0.85, alignItems: 'center', bgcolor: i % 2 === 0 ? C.white : C.grayLight, borderBottom: i < HOLDING_REGS.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                    <AddrBadge addr={addr} />
                    <MonoText color={name === 'RESERVED' ? C.gray : C.purple}>{name}</MonoText>
                    <Typography sx={{ fontSize: '0.65rem', color: C.gray }}>{fmt}</Typography>
                    <MonoText color={range === '0' ? C.gray : C.orange}>{range}</MonoText>
                    <Typography sx={{ fontSize: '0.65rem', color: C.dark, lineHeight: 1.5 }}>{desc}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <SectionTitle color={C.blue}>Input Register (읽기 전용)</SectionTitle>
                <Badge text="2000 ~ 2015" color={C.blue} bg={C.blueLight} />
              </Box>
              <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '55px 180px 60px 1fr', px: 1.5, py: 0.8, bgcolor: '#F0F4F8', borderBottom: `1px solid ${C.line}` }}>
                  {['Addr', 'Name', 'Format', 'Description'].map(h => (
                    <Typography key={h} sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.gray }}>{h}</Typography>
                  ))}
                </Box>
                {INPUT_REGS.map(({ addr, name, fmt, desc }, i) => (
                  <Box key={addr} sx={{ display: 'grid', gridTemplateColumns: '55px 180px 60px 1fr', px: 1.5, py: 0.85, alignItems: 'center', bgcolor: i % 2 === 0 ? C.white : C.grayLight, borderBottom: i < INPUT_REGS.length - 1 ? `1px solid ${C.line}` : 'none' }}>
                    <AddrBadge addr={addr} input />
                    <MonoText color={name === 'RESERVED' ? C.gray : C.blue}>{name}</MonoText>
                    <Typography sx={{ fontSize: '0.65rem', color: C.gray }}>{fmt}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: C.dark, lineHeight: 1.5 }}>{desc}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )} */}

        {/* ── Unit Table ─────────────────────────────────────────────────── */}
        {activeTab === 1 && (
          <Box>
            <SectionTitle color={C.blueMid}>단위 변환 참고표</SectionTitle>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 2.5 }}>
              {[
                { title: '위치 변환', color: C.green,  formula: 'reg = (pct / 100) × (−2000)',     range: '0% → 0   /   100% → −2000', unit: '단위: 0.1deg' },
                { title: '속도 변환', color: C.purple, formula: 'reg = MAX(1, (pct/100) × 360)',    range: '0% → 1   /   100% → 360',   unit: '단위: deg/s' },
                { title: '힘 변환',   color: C.orange, formula: 'reg = (pct / 100) × 1000',         range: '0% → 0   /   100% → 1000',  unit: '단위: 0.1% TR  (100%=3.5Nm)' },
              ].map(({ title, color, formula, range, unit }) => (
                <Box key={title} sx={{ border: `1px solid ${color}44`, borderRadius: 2, overflow: 'hidden' }}>
                  <Box sx={{ bgcolor: `${color}18`, px: 1.5, py: 0.8, borderBottom: `1px solid ${color}33` }}>
                    <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color }}>{title}</Typography>
                  </Box>
                  <Box sx={{ px: 1.5, py: 1 }}>
                    <MonoText color={color}>{formula}</MonoText>
                    <Typography sx={{ fontSize: '0.62rem', color: C.gray, mt: 0.5 }}>{range}</Typography>
                    <Typography sx={{ fontSize: '0.6rem',  color: C.gray, mt: 0.3 }}>{unit}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>

            <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 2, overflow: 'hidden' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '200px 140px 1fr', px: 1.5, py: 0.8, bgcolor: '#F0F4F8', borderBottom: `1px solid ${C.line}` }}>
                {['스크립트 입력', '레지스터 값', '실제 값'].map(h => (
                  <Typography key={h} sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.gray }}>{h}</Typography>
                ))}
              </Box>
              {UNIT_ROWS.map(({ cmd: c, reg, real }, i) => {
                const isPos  = c.includes('move');
                const isSpd  = c.includes('speed');
                const color  = isPos ? C.green : isSpd ? C.purple : C.orange;
                const isFirst = i === 0 || !UNIT_ROWS[i - 1].cmd.includes(c.split('_')[0]);
                return (
                  <Box key={c + reg} sx={{
                    display: 'grid', gridTemplateColumns: '200px 140px 1fr',
                    px: 1.5, py: 0.85, alignItems: 'center',
                    bgcolor: i % 2 === 0 ? C.white : C.grayLight,
                    borderBottom: i < UNIT_ROWS.length - 1 ? `1px solid ${C.line}` : 'none',
                    borderTop: isFirst && i > 0 ? `2px solid ${C.line}` : 'none',
                  }}>
                    <MonoText color={color}>rq_set_{c}</MonoText>
                    <MonoText color={C.dark}>{reg}</MonoText>
                    <Typography sx={{ fontSize: '0.68rem', color: C.dark, fontWeight: real.includes('정격') ? 600 : 400 }}>
                      {real}
                    </Typography>
                  </Box>
                );
              })}
            </Box>

            <Box sx={{ mt: 2, p: 1.5, bgcolor: '#FFF8E1', borderRadius: 2, border: '1px solid #FFE082' }}>
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#F57F17', mb: 0.5 }}>⚠️ 안전 범위 주의</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3 }}>
                {[
                  '속도(1004) = 0 입력 금지 → 코드에서 MAX(1, ...) 자동 보정',
                  '가속도(1006) = 0 입력 금지 → 스크립트에서 고정값 50 사용',
                  '힘(1005) > 1000 금지 → 정격 토크(3.5 Nm) 초과 시 모터 손상',
                  '위치(1003) < -2000 금지 → 기구부 파손 위험',
                ].map(msg => (
                  <Typography key={msg} sx={{ fontSize: '0.65rem', color: '#795548' }}>• {msg}</Typography>
                ))}
              </Box>
            </Box>
          </Box>
        )}

      </Box>
    </Box>
  );
};

// ← 핵심 변경: InfoTab → InformationTab
export default InformationTab;