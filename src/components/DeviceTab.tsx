import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Select, MenuItem, Button, Paper, IconButton, Tooltip,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import { GripperState } from '../App';
import { C } from '../theme';
import {
  FW, REG, INPUT_REGISTERS, HOLDING_REGISTERS, ACTION_VALUES, INPUT_RANGE, HOLDING_RANGE,
} from '../registers';
import { PH11_SPEC, posToReg, regToDeg, speedToReg, forceToReg, torqueToNm, UI_MAX } from '../constants';

// ── Device 탭 ─────────────────────────────────────────────────────────────────
// 연결 설정 + 장치 정보를 한 화면에 3열로 배치한다. (내부 탭 없음 — 모두 동시에 보임)
//
//  ┌ Connection ─────────┐ ┌ Register Map ─────────────────────┐ ┌ Motor Spec ─────────┐
//  │ port / baud / id    │ │ Input 2000–2004 · 2010–2015       │ │ PH11B-51-C 사양       │
//  ├ Active Settings ────┤ │ Holding 1000–1004                 │ ├ Unit Table ─────────┤
//  ├ Controller ─────────┤ │ REG_ACTION_REQUEST 값 · 주의사항   │ │ UI 0~255 → 레지스터   │
//  └─────────────────────┘ └───────────────────────────────────┘ └─────────────────────┘

interface Props {
  state: GripperState;
  updateState: (p: Partial<GripperState>) => void;
  ports: string[];
  onRefreshPorts: () => Promise<void>;
}

const BAUD_RATES: number[] = [9600, 19200, 38400, 57600, 115200, 230400];
const SLAVE_IDS:  number[] = Array.from({ length: 247 }, (_, i) => i + 1);   // 0 = broadcast (사용 금지)

// ── 모터 사양 ─────────────────────────────────────────────────────────────────
const MOTOR_SPECS = [
  { key: 'Rated Torque',             value: '3.5 Nm',          highlight: true  },
  { key: 'Start-Stop Peak Torque',   value: '8.3 Nm'                             },
  { key: 'Avg. Max Torque',          value: '5.5 Nm'                             },
  { key: 'Instantaneous Max Torque', value: '17.0 Nm',         highlight: true  },
  { key: 'Rated Speed',              value: '60 rpm'                             },
  { key: 'Speed Ratio',              value: '51 : 1'                             },
  { key: 'Rated Power',              value: '50 W'                               },
  { key: 'Working Voltage',          value: '24 ~ 36 V'                          },
  { key: 'Motor Type',               value: 'Inner Rotor Torque Motor'           },
  { key: 'Communication',            value: 'CANopen'                            },
  { key: 'Encoder Type',             value: 'Dual Magnetic'                      },
  { key: 'Encoder Accuracy',         value: '19-bit'                             },
  { key: 'Diameter (OD)',            value: 'Ø 52 mm'                            },
  { key: 'Inner Diameter',           value: '6 mm'                               },
  { key: 'Weight',                   value: '455 g'                              },
  { key: 'Reverse Backlash',         value: '15 arcsec'                          },
  { key: 'Working Temp.',            value: '-20 ~ 80 °C'                        },
  { key: 'Working Noise',            value: '< 60 dB (@30 cm)'                   },
];

// ── 컨트롤러(펌웨어) 통신 사양 ────────────────────────────────────────────────
const CONTROLLER_SPECS = [
  { key: 'MCU / Firmware',  value: 'STM32F407 · Embassy (Rust)' },
  { key: 'Interface',       value: 'RS-485 · Modbus RTU'        },
  { key: 'Frame',           value: `${FW.BAUD_RATE} bps · 8N1`  },
  { key: 'Slave ID',        value: String(FW.SLAVE_ID)          },
  { key: 'Function Codes',  value: '03 · 04 · 06 · 10'          },
  { key: 'Motor Bus',       value: 'CANopen (CSP / CST)'        },
];

// ── 단위 변환표 — UI 값(0~255) 한 줄에 위치/속도/힘을 나란히 ────────────────────
const UI_STEPS = [0, 64, 128, 191, 255];
const UNIT_ROWS = UI_STEPS.map(v => ({
  ui:     v,
  pos:    `${posToReg(v)}`,
  posDeg: `${regToDeg(posToReg(v)).toFixed(1)}°`,
  spd:    `${speedToReg(v)}`,
  frc:    `${forceToReg(v)}`,
  frcNm:  `${torqueToNm(forceToReg(v)).toFixed(2)} Nm`,
}));

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────────────────
const Mono: React.FC<{ children: React.ReactNode; color?: string; bold?: boolean; size?: string }> = ({ children, color, bold, size }) => (
  <Typography sx={{ fontFamily: C.mono, fontSize: size ?? '0.68rem', color: color ?? C.text, fontWeight: bold ? 700 : 500, lineHeight: 1.5 }}>
    {children}
  </Typography>
);

const SectionTitle: React.FC<{ children: React.ReactNode; right?: React.ReactNode; mb?: number }> = ({ children, right, mb = 0.8 }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb }}>
    <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: C.title, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
      {children}
    </Typography>
    {right}
  </Box>
);

const TableHead: React.FC<{ cols: string; heads: string[] }> = ({ cols, heads }) => (
  <Box sx={{ display: 'grid', gridTemplateColumns: cols, px: 1.5, py: 0.6, bgcolor: C.surfaceAlt, borderBottom: `1px solid ${C.line}`, columnGap: 1 }}>
    {heads.map(h => <Typography key={h} sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.sub }}>{h}</Typography>)}
  </Box>
);

const KeyValueRows: React.FC<{ rows: { key: string; value: string; highlight?: boolean }[]; dense?: boolean }> = ({ rows, dense }) => (
  <Box sx={{ bgcolor: C.surfaceAlt, px: 1.6, py: 0.3 }}>
    {rows.map((s, i) => (
      <Box key={s.key} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, py: dense ? 0.42 : 0.55, borderBottom: i < rows.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
        <Typography sx={{ fontSize: '0.68rem', color: C.sub, flexShrink: 0 }}>{s.key}</Typography>
        <Typography noWrap sx={{ fontSize: '0.68rem', fontWeight: s.highlight ? 700 : 600, color: s.highlight ? C.accent : C.text, fontFamily: C.mono, minWidth: 0 }}>
          {s.value}
        </Typography>
      </Box>
    ))}
  </Box>
);

const CardHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <Box sx={{ bgcolor: C.accent, px: 1.6, py: 0.9 }}>
    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#fff' }}>{title}</Typography>
    <Typography sx={{ fontSize: '0.6rem', color: '#DCEBFA' }}>{subtitle}</Typography>
  </Box>
);

const panelSx = {
  border: `1px solid ${C.line}`, borderRadius: 2, boxShadow: 'none', bgcolor: C.surface,
  display: 'flex', flexDirection: 'column' as const, minHeight: 0, minWidth: 0, overflow: 'hidden',
};
const selectSx = {
  height: 30, fontSize: '0.8rem', bgcolor: C.surface, color: C.text,
  '& .MuiOutlinedInput-notchedOutline': { borderColor: C.line },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: C.accent },
  '& .MuiSelect-select': { py: 0.4, px: 1 },
  '& .MuiSelect-icon': { color: C.muted },
  '&.Mui-disabled': { bgcolor: C.surfaceAlt },
};
const btnSx = {
  fontSize: '0.76rem', borderColor: C.line, color: C.text, height: 30, px: 1.6,
  '&:hover': { borderColor: C.accent, color: C.accent, bgcolor: C.surfaceTint },
};
const menuItemSx = { fontSize: '0.8rem', color: C.text, fontFamily: C.mono };

// ═══════════════════════════════════════════════════════════════════════════════
const DeviceTab: React.FC<Props> = ({ state, updateState, ports, onRefreshPorts }) => {
  const [draft, setDraft] = useState({ port: state.port, baudRate: state.baudRate, slaveId: state.slaveId });
  const [statusMsg,  setStatusMsg]  = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // 포트 목록이 갱신됐는데 draft 가 비어 있으면 첫 포트를 채운다
  useEffect(() => {
    if (!draft.port && ports.length > 0) setDraft(d => ({ ...d, port: ports[0] }));
  }, [ports, draft.port]);

  const flash = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 1600);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await onRefreshPorts(); } finally { setRefreshing(false); }
  };

  const handleApply = () => {
    updateState({ port: draft.port, baudRate: draft.baudRate, slaveId: draft.slaveId });
    flash('Applied');
  };

  const handleDefault = () => {
    const d = { port: ports[0] ?? '', baudRate: FW.BAUD_RATE, slaveId: FW.SLAVE_ID };
    setDraft(d);
    updateState(d);
    flash('Firmware default');
  };

  const isDirty   = draft.port !== state.port || draft.baudRate !== state.baudRate || draft.slaveId !== state.slaveId;
  const connLabel = !state.connected ? 'Offline' : state.demo ? 'Demo' : 'Online';
  const connColor = !state.connected ? C.muted : state.demo ? C.warn : C.ok;
  const locked    = state.connected;

  // 현재 draft 포트가 목록에 없으면(장치 분리 등) 옵션에 임시로 포함시켜 Select 가 깨지지 않게 한다
  const portOptions = draft.port && !ports.includes(draft.port) ? [draft.port, ...ports] : ports;

  const settingRow = (label: string, control: React.ReactNode) => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      <Typography sx={{ fontSize: '0.76rem', color: C.text, fontWeight: 600, flexShrink: 0 }}>{label}</Typography>
      {control}
    </Box>
  );

  return (
    <Box sx={{
      height: '100%', overflow: 'hidden', p: 1.5,
      display: 'grid', gap: 1.2,
      gridTemplateColumns: '350px minmax(0, 1fr) 372px',
    }}>

      {/* ══ 1열: 연결 설정 · 적용값 · 컨트롤러 ═══════════════════════════════ */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, minHeight: 0, overflowY: 'auto' }}>

        <Paper elevation={0} sx={{ ...panelSx, p: 1.8, overflow: 'visible' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Box>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.title }}>Modbus RTU Connection</Typography>
              <Typography sx={{ fontSize: '0.6rem', color: C.muted, mt: 0.2 }}>RS-485 · 8 data · No parity · 1 stop (펌웨어 고정)</Typography>
            </Box>
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: connColor }}>● {connLabel}</Typography>
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
            {settingRow('Serial Port',
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Select value={draft.port} size="small" displayEmpty disabled={locked}
                  sx={{ ...selectSx, width: 182, '& .MuiSelect-select': { py: 0.4, px: 1, fontFamily: C.mono, fontSize: '0.72rem' } }}
                  onChange={e => setDraft(d => ({ ...d, port: e.target.value }))}
                  renderValue={v => (v ? <span title={String(v)}>{String(v).replace('/dev/tty.', '').replace('/dev/cu.', '')}</span> : <span style={{ color: C.faint }}>No ports found</span>)}>
                  {portOptions.length === 0 && <MenuItem disabled value="" sx={menuItemSx}>No serial ports detected</MenuItem>}
                  {portOptions.map(p => <MenuItem key={p} value={p} sx={menuItemSx}>{p}</MenuItem>)}
                </Select>
                <Tooltip title="포트 목록 새로 고침">
                  <span>
                    <IconButton size="small" onClick={handleRefresh} disabled={refreshing || locked}
                      sx={{ color: C.accent, border: `1px solid ${C.line}`, borderRadius: 1.2, width: 30, height: 30, '&:hover': { bgcolor: C.surfaceTint } }}>
                      <RefreshIcon sx={{ fontSize: 16, animation: refreshing ? 'spin 0.8s linear infinite' : 'none', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            )}
            {settingRow('Baud Rate',
              <Select value={draft.baudRate} size="small" disabled={locked} sx={{ ...selectSx, width: 218 }}
                onChange={e => setDraft(d => ({ ...d, baudRate: Number(e.target.value) }))}>
                {BAUD_RATES.map(v => (
                  <MenuItem key={v} value={v} sx={menuItemSx}>
                    {v}{v === FW.BAUD_RATE && <span style={{ color: C.muted, marginLeft: 8, fontSize: '0.68rem' }}>firmware</span>}
                  </MenuItem>
                ))}
              </Select>
            )}
            {settingRow('Slave ID',
              <Select value={draft.slaveId} size="small" disabled={locked} sx={{ ...selectSx, width: 218 }}
                onChange={e => setDraft(d => ({ ...d, slaveId: Number(e.target.value) }))} MenuProps={{ sx: { maxHeight: 260 } }}>
                {SLAVE_IDS.map(v => (
                  <MenuItem key={v} value={v} sx={menuItemSx}>
                    {v}{v === FW.SLAVE_ID && <span style={{ color: C.muted, marginLeft: 8, fontSize: '0.68rem' }}>firmware</span>}
                  </MenuItem>
                ))}
              </Select>
            )}
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mt: 1.8, alignItems: 'center' }}>
            <Button variant="outlined" size="small" onClick={handleDefault} disabled={locked}
              startIcon={<RestoreIcon sx={{ fontSize: '14px !important' }} />} sx={btnSx}>
              Default
            </Button>
            <Button variant="outlined" size="small" onClick={handleApply} disabled={locked}
              startIcon={<CheckIcon sx={{ fontSize: '14px !important' }} />}
              sx={{ ...btnSx, borderColor: isDirty ? C.accent : '#BBDEFB', color: C.accent, fontWeight: isDirty ? 700 : 500, '&:hover': { bgcolor: C.surfaceTint, borderColor: C.accent } }}>
              Apply
            </Button>
            {statusMsg && <Typography sx={{ fontSize: '0.7rem', color: C.ok, ml: 0.5 }}>✓ {statusMsg}</Typography>}
            {!statusMsg && isDirty && <Typography sx={{ fontSize: '0.64rem', color: C.warn, fontWeight: 600, ml: 0.5 }}>● unsaved</Typography>}
          </Box>
          <Typography sx={{ fontSize: '0.62rem', color: C.muted, mt: 1.2, lineHeight: 1.55 }}>
            <b style={{ color: C.sub }}>Apply</b> → 상단 <b style={{ color: C.sub }}>Connect</b>. 포트를 열 수 없으면 DEMO 모드로 전환됩니다. 연결 중에는 변경할 수 없습니다.
          </Typography>
        </Paper>

        <Paper elevation={0} sx={{ ...panelSx, border: `1px solid ${isDirty ? C.warnLine : C.line}` }}>
          <Box sx={{ px: 1.6, pt: 1.3, pb: 0.4 }}>
            <SectionTitle mb={0}>Active Settings</SectionTitle>
          </Box>
          <KeyValueRows dense rows={[
            { key: 'Serial Port', value: state.port || '—' },
            { key: 'Baud Rate',   value: `${state.baudRate} bps` },
            { key: 'Frame',       value: '8N1 (fixed)' },
            { key: 'Slave ID',    value: String(state.slaveId) },
            { key: 'Poll block',  value: `In ${INPUT_RANGE.first}–${INPUT_RANGE.last} · Hold ${HOLDING_RANGE.first}–${HOLDING_RANGE.last}` },
            { key: 'Poll period', value: '200 ms · 800 ms timeout' },
            { key: 'Link loss',   value: '3 misses → disconnect' },
          ]} />
        </Paper>

        <Paper elevation={0} sx={panelSx}>
          <CardHeader title="Gripper Controller" subtitle="stm-clicker4 · Modbus RTU slave" />
          <KeyValueRows dense rows={CONTROLLER_SPECS} />
        </Paper>
      </Box>

      {/* ══ 2열: 레지스터 맵 ══════════════════════════════════════════════════ */}
      <Paper elevation={0} sx={panelSx}>
        <Box sx={{ px: 1.8, pt: 1.4, pb: 1, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.title }}>Register Map</Typography>
          <Typography sx={{ fontSize: '0.62rem', color: C.muted, mt: 0.2 }}>
            Input {INPUT_RANGE.first}–{REG.CURR_TORQUE} · {REG.ADC0_VOLTAGE}–{REG.ADC5_VOLTAGE} (ADC0–5) · Holding {HOLDING_RANGE.first}–{HOLDING_RANGE.last} — 펌웨어 REG_* 상수와 동일해야 함
          </Typography>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.6, display: 'flex', flexDirection: 'column', gap: 1.4 }}>
          <Box>
            <SectionTitle right={<Mono color={C.muted} size="0.62rem">FC04 · read-only</Mono>}>Input Registers</SectionTitle>
            <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 1.5, overflow: 'hidden' }}>
              <TableHead cols="52px 170px 68px 1fr" heads={['Addr', 'Name', 'Unit', 'Description']} />
              {INPUT_REGISTERS.map((r, i) => (
                <Box key={r.addr} sx={{ display: 'grid', gridTemplateColumns: '52px 170px 68px 1fr', px: 1.5, py: 0.5, alignItems: 'center', columnGap: 1, bgcolor: i % 2 === 0 ? C.surface : C.surfaceAlt, borderBottom: i < INPUT_REGISTERS.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
                  <Mono color={C.accent} bold>{r.addr}</Mono>
                  <Mono>{r.name}</Mono>
                  <Mono color={C.muted} size="0.62rem">{r.unit}</Mono>
                  <Typography sx={{ fontSize: '0.64rem', color: C.text, lineHeight: 1.45 }}>{r.desc}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Box>
            <SectionTitle right={<Mono color={C.muted} size="0.62rem">FC06 / FC16 · write</Mono>}>Holding Registers</SectionTitle>
            <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 1.5, overflow: 'hidden' }}>
              <TableHead cols="52px 170px 68px 104px 1fr" heads={['Addr', 'Name', 'Unit', 'Range', 'Description']} />
              {HOLDING_REGISTERS.map((r, i) => (
                <Box key={r.addr} sx={{ display: 'grid', gridTemplateColumns: '52px 170px 68px 104px 1fr', px: 1.5, py: 0.5, alignItems: 'center', columnGap: 1, bgcolor: i % 2 === 0 ? C.surface : C.surfaceAlt, borderBottom: i < HOLDING_REGISTERS.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
                  <Mono color={C.text} bold>{r.addr}</Mono>
                  <Mono>{r.name}</Mono>
                  <Mono color={C.muted} size="0.62rem">{r.unit}</Mono>
                  <Mono color={C.sub} size="0.62rem">{r.range ?? '—'}</Mono>
                  <Typography sx={{ fontSize: '0.64rem', color: C.text, lineHeight: 1.45 }}>{r.desc}</Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Box>
            <SectionTitle>REG_ACTION_REQUEST ({REG.ACTION_REQUEST}) — UI 가 쓰는 값</SectionTitle>
            <Box sx={{ border: `1px solid ${C.line}`, borderRadius: 1.5, overflow: 'hidden' }}>
              <TableHead cols="44px 80px 1fr 1fr" heads={['Dec', 'Binary', '의미', '사용 시점']} />
              {ACTION_VALUES.map((row, i) => (
                <Box key={row.dec} sx={{ display: 'grid', gridTemplateColumns: '44px 80px 1fr 1fr', px: 1.5, py: 0.45, alignItems: 'center', columnGap: 1, bgcolor: i % 2 === 0 ? C.surface : C.surfaceAlt, borderBottom: i < ACTION_VALUES.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
                  <Mono color={C.accent} bold>{row.dec}</Mono>
                  <Mono>{row.bin}</Mono>
                  <Typography sx={{ fontSize: '0.64rem', color: C.text }}>{row.meaning}</Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: C.sub }}>{row.when}</Typography>
                </Box>
              ))}
            </Box>
            <Typography sx={{ fontSize: '0.62rem', color: C.muted, mt: 0.6, lineHeight: 1.55 }}>
              rRST · rPOS · rSTP 는 <b style={{ color: C.sub }}>상승 엣지</b>에서 동작 — UI 는 트리거 값(3 / 17 / 33)을 쓴 직후 1 로 되돌린다.
              {' '}{REG.SPEED_REQUEST}(속도) 또는 {REG.ACC_REQUEST}(가속도)가 0 이면 펌웨어는 이동 명령을 무시한다.
              {' '}{REG.FAULT_STATUS} 에러코드와 gERR 는 rRST 까지 래치된다.
            </Typography>
          </Box>

          <Box sx={{ px: 1.3, py: 0.9, bgcolor: C.warnBg, borderRadius: 1.5, border: `1px solid ${C.warnLine}` }}>
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, color: C.warn, mb: 0.3 }}>⚠ 안전 범위</Typography>
            {[
              `속도(${REG.SPEED_REQUEST}) = 0 → 이동 무시 · UI 는 최소 1 로 보정`,
              `가속도(${REG.ACC_REQUEST}) = 0 → 이동 무시 · UI 고정값 ${FW.ACC_DEFAULT} deg/s²`,
              `힘(${REG.FORCE_REQUEST}) > ${FW.TORQUE_FULL} 금지 → 정격 토크(${PH11_SPEC.rated} Nm) 초과 시 모터 손상`,
              `위치(${REG.POSITION_REQUEST}) < ${FW.POS_REG_CLOSED} 금지 → 기구부 파손 위험`,
            ].map(msg => (
              <Typography key={msg} sx={{ fontSize: '0.63rem', color: C.text, lineHeight: 1.65 }}>• {msg}</Typography>
            ))}
          </Box>
        </Box>
      </Paper>

      {/* ══ 3열: 모터 사양 · 단위 변환표 ══════════════════════════════════════ */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, minHeight: 0, overflowY: 'auto' }}>

        <Paper elevation={0} sx={panelSx}>
          <CardHeader title="EYOU PH11B-51-C" subtitle="Harmonic Drive Actuator · CANopen · 51:1 · Ø52 mm · 455 g" />
          <KeyValueRows dense rows={MOTOR_SPECS} />
        </Paper>

        <Paper elevation={0} sx={panelSx}>
          <Box sx={{ px: 1.6, pt: 1.3, pb: 0.8 }}>
            <SectionTitle mb={0.3} right={<Mono color={C.muted} size="0.6rem">UI 0~{UI_MAX}</Mono>}>Unit Table</SectionTitle>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.15 }}>
              <Mono size="0.6rem" color={C.sub}>{REG.POSITION_REQUEST} = round(ui/255 × {FW.POS_REG_CLOSED})  → 0.1 deg</Mono>
              <Mono size="0.6rem" color={C.sub}>{REG.SPEED_REQUEST} = max(1, round(ui/255 × {FW.SPEED_MAX}))  → deg/s</Mono>
              <Mono size="0.6rem" color={C.sub}>{REG.FORCE_REQUEST} = round(ui/255 × {FW.TORQUE_FULL})  → 0.1 %TR</Mono>
            </Box>
          </Box>
          <Box sx={{ borderTop: `1px solid ${C.line}` }}>
            <TableHead cols="40px 1fr 1fr 1fr" heads={['UI', `Pos (${REG.POSITION_REQUEST})`, `Speed (${REG.SPEED_REQUEST})`, `Force (${REG.FORCE_REQUEST})`]} />
            {UNIT_ROWS.map((row, i) => (
              <Box key={row.ui} sx={{ display: 'grid', gridTemplateColumns: '40px 1fr 1fr 1fr', px: 1.5, py: 0.55, alignItems: 'center', columnGap: 1, bgcolor: i % 2 === 0 ? C.surface : C.surfaceAlt, borderBottom: i < UNIT_ROWS.length - 1 ? `1px solid ${C.lineSoft}` : 'none' }}>
                <Mono bold>{row.ui}</Mono>
                <Box sx={{ minWidth: 0 }}>
                  <Mono size="0.66rem">{row.pos}</Mono>
                  <Mono size="0.58rem" color={C.muted}>{row.posDeg}</Mono>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Mono size="0.66rem">{row.spd}</Mono>
                  <Mono size="0.58rem" color={C.muted}>deg/s</Mono>
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Mono size="0.66rem">{row.frc}</Mono>
                  <Mono size="0.58rem" color={C.muted}>{row.frcNm}</Mono>
                </Box>
              </Box>
            ))}
          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default DeviceTab;
