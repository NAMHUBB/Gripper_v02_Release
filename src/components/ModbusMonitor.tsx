import React, { useState } from 'react';
import { Box, Paper, Typography, TextField, Select, MenuItem, Chip } from '@mui/material';
import {
  INPUT_REGISTERS, ADC_REGISTERS, HOLDING_REGISTERS, ALL_REGISTERS,
  FORMAT_OPTIONS, RegFormat, RegisterDef, formatRegister,
  REG, ACTION_BIT, STATUS_BIT, STATUS_RANGE, ADC_RANGE, HOLDING_RANGE,
} from '../registers';
import { C } from '../theme';

// ── Modbus 모니터 (대시보드 우측 컬럼) ─────────────────────────────────────────
// 펌웨어가 실제로 사용하는 레지스터만 표시한다. (RESERVED 제외 — registers.ts 참고)

const GRID_COLS = '54px 74px minmax(0, 1fr) 60px 92px';

interface Props {
  connected: boolean;
  demo:      boolean;
  baudRate:  number;
  /** 주소 → 값 (App 이 폴링/시뮬레이션으로 채움) */
  values:    Record<number, number>;
  readError: string | null;
}

// ── 섹션 헤더 ────────────────────────────────────────────────────────────────
const SectionRow: React.FC<{ label: string; range: string; fc: string }> = ({ label, range, fc }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1.5, py: 0.45, flexShrink: 0, bgcolor: C.surfaceTint, borderBottom: `1px solid ${C.line}`, borderTop: `1px solid ${C.line}` }}>
    <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.title, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</Typography>
    <Typography sx={{ fontSize: '0.6rem', color: C.muted, fontFamily: C.mono }}>{range}</Typography>
    <Box sx={{ flex: 1 }} />
    <Typography sx={{ fontSize: '0.58rem', color: C.muted, fontFamily: C.mono }}>{fc}</Typography>
  </Box>
);

// ── 비트 디코드 ──────────────────────────────────────────────────────────────
// 2000(REG_ACTION_STATUS) · 1000(REG_ACTION_REQUEST) 을 비트 단위로 풀어서 보여준다.
const STATUS_DECODE = [
  { bit: 0, key: 'gACT', mask: STATUS_BIT.gACT, desc: 'Servo ON' },
  { bit: 1, key: 'gERR', mask: STATUS_BIT.gERR, desc: 'Fault (latched)' },
  { bit: 2, key: 'gBRK', mask: STATUS_BIT.gBRK, desc: 'Brake released' },
  { bit: 3, key: 'gRUN', mask: STATUS_BIT.gRUN, desc: 'Moving / holding torque' },
];
const REQUEST_DECODE = [
  { bit: 0, key: 'rACT', mask: ACTION_BIT.rACT, desc: 'Servo ON' },
  { bit: 1, key: 'rRST', mask: ACTION_BIT.rRST, desc: 'Fault reset ↑' },
  { bit: 2, key: 'rBRK', mask: ACTION_BIT.rBRK, desc: 'Brake release' },
  { bit: 3, key: 'rTRQ', mask: ACTION_BIT.rTRQ, desc: 'Torque mode ↑' },
  { bit: 4, key: 'rPOS', mask: ACTION_BIT.rPOS, desc: 'Move (MoveJ) ↑' },
  { bit: 5, key: 'rSTP', mask: ACTION_BIT.rSTP, desc: 'Quick stop ↑' },
];

const BitGroup: React.FC<{
  title: string; addr: number; value: number; connected: boolean;
  bits: { bit: number; key: string; mask: number; desc: string }[];
  errKey?: string;
}> = ({ title, addr, value, connected, bits, errKey }) => (
  <Box sx={{ minWidth: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.6, mb: 0.6 }}>
      <Typography sx={{ fontSize: '0.6rem', fontWeight: 700, color: C.title, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{title}</Typography>
      <Typography sx={{ fontSize: '0.6rem', color: C.muted, fontFamily: C.mono }}>{addr}</Typography>
    </Box>
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.55 }}>
      {bits.map(b => {
        const on    = connected && (value & b.mask) !== 0;
        const isErr = b.key === errKey;
        return (
          <Box key={b.key} sx={{ display: 'grid', gridTemplateColumns: '14px 44px 1fr', alignItems: 'center', columnGap: 0.7 }}>
            <Box sx={{
              width: 10, height: 10, borderRadius: '50%', justifySelf: 'center',
              bgcolor: on ? (isErr ? C.danger : C.accent) : 'transparent',
              border: `1.5px solid ${on ? (isErr ? C.danger : C.accent) : C.line}`,
              boxShadow: on && !isErr ? '0 0 0 2px rgba(25,118,210,0.15)' : 'none',
            }} />
            <Typography sx={{ fontSize: '0.64rem', fontWeight: 700, fontFamily: C.mono, color: on ? (isErr ? C.danger : C.text) : C.faint }}>
              {b.key}
            </Typography>
            <Typography noWrap sx={{ fontSize: '0.62rem', color: on ? C.sub : C.faint }}>
              bit{b.bit} · {b.desc}
            </Typography>
          </Box>
        );
      })}
    </Box>
  </Box>
);

const ModbusMonitor: React.FC<Props> = ({ connected, demo, baudRate, values, readError }) => {
  const [formats, setFormats] = useState<Record<number, RegFormat>>(() =>
    Object.fromEntries(ALL_REGISTERS.map(r => [r.addr, r.format]))
  );

  const renderRow = (r: RegisterDef, i: number, isLast: boolean) => {
    const isInput = r.addr >= 2000;
    const val     = values[r.addr] ?? 0;
    const fmt     = formats[r.addr] ?? r.format;
    return (
      <Box
        key={r.addr}
        sx={{
          display: 'grid', gridTemplateColumns: GRID_COLS,
          px: 1.5, py: 0.55, alignItems: 'center', columnGap: 0.8,
          flex: '1 1 auto', minHeight: 30,               // 남는 높이를 행들이 나눠 채운다
          bgcolor: i % 2 === 0 ? C.surface : C.surfaceAlt,
          borderBottom: isLast ? 'none' : `1px solid ${C.lineSoft}`,
          '&:hover': { bgcolor: C.surfaceTint },
        }}
      >
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, fontFamily: C.mono, color: isInput ? C.accent : C.text }}>
          {r.addr}
        </Typography>
        <Select
          value={fmt}
          size="small"
          onChange={e => setFormats(f => ({ ...f, [r.addr]: e.target.value as RegFormat }))}
          sx={{
            height: 22, fontSize: '0.66rem', bgcolor: C.surface, color: C.sub,
            '& .MuiSelect-select': { py: 0.2, px: 0.6 },
            '& .MuiSelect-icon': { color: C.muted },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: C.line },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: C.accent },
          }}
        >
          {FORMAT_OPTIONS.map(f => (
            <MenuItem key={f} value={f} sx={{ fontSize: '0.72rem', color: C.text }}>{f}</MenuItem>
          ))}
        </Select>
        <Typography noWrap title={r.desc} sx={{ fontSize: '0.7rem', color: C.text, minWidth: 0, fontWeight: 500 }}>
          {r.name}
        </Typography>
        <Typography noWrap sx={{ fontSize: '0.62rem', color: C.muted, fontFamily: C.mono }}>
          {r.unit}
        </Typography>
        <TextField
          value={formatRegister(val, fmt)}
          size="small"
          slotProps={{ input: { readOnly: true } }}
          sx={{
            '& .MuiOutlinedInput-root': {
              height: 22, fontSize: '0.7rem', fontFamily: C.mono,
              bgcolor: connected ? (isInput ? C.surfaceTint : '#F3F8FD') : C.surfaceAlt,
              '& fieldset': { borderColor: C.line },
            },
            '& .MuiInputBase-input': {
              py: 0.15, px: 0.8, textAlign: 'right', fontWeight: 600,
              color: connected ? C.text : C.faint,
            },
          }}
        />
      </Box>
    );
  };

  return (
    <Paper elevation={0} sx={{ height: '100%', display: 'flex', flexDirection: 'column', border: `1px solid ${C.line}`, borderRadius: 2, bgcolor: C.surface, boxShadow: 'none', overflow: 'hidden' }}>

      {/* 헤더 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', px: 1.75, pt: 1.5, pb: 1, flexShrink: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.title }}>Modbus Monitor</Typography>
          <Typography sx={{ fontSize: '0.62rem', color: C.muted, mt: 0.2 }}>
            Input {STATUS_RANGE.first}–{STATUS_RANGE.last} · ADC {ADC_RANGE.first}–{ADC_RANGE.last} · Holding {HOLDING_RANGE.first}–{HOLDING_RANGE.last} · 200 ms
          </Typography>
          {readError && (
            <Typography sx={{ fontSize: '0.62rem', color: C.danger, mt: 0.3, lineHeight: 1.4, wordBreak: 'break-all' }} title={readError}>
              {readError}
            </Typography>
          )}
        </Box>
        <Chip
          label={!connected ? 'Offline' : demo ? `Demo · ${baudRate}` : `Live · ${baudRate}`}
          size="small"
          sx={{
            height: 22, fontSize: '0.64rem', fontWeight: 600, flexShrink: 0,
            bgcolor: !connected ? C.surfaceAlt : demo ? C.warnBg : C.okBg,
            color:   !connected ? C.muted      : demo ? C.warn   : C.ok,
            border:  `1px solid ${!connected ? C.line : demo ? C.warnLine : '#A5D6A7'}`,
            '& .MuiChip-label': { px: 1 },
          }}
        />
      </Box>

      {/* 테이블 — 행들이 flex 로 늘어나 패널 높이를 채운다 (작은 창에서는 스크롤) */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', borderTop: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column' }}>
        {/* 컬럼 헤더 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLS, columnGap: 0.8, px: 1.5, py: 0.6, bgcolor: C.surfaceAlt, position: 'sticky', top: 0, zIndex: 1, flexShrink: 0 }}>
          {['Address', 'Format', 'Register', 'Unit', 'Value'].map(h => (
            <Typography key={h} sx={{ fontSize: '0.64rem', fontWeight: 700, color: C.sub, textAlign: h === 'Value' ? 'right' : 'left' }}>
              {h}
            </Typography>
          ))}
        </Box>

        <SectionRow label="Input Registers" range={`${STATUS_RANGE.first}–${STATUS_RANGE.last}`} fc="FC04 · read" />
        {INPUT_REGISTERS.map((r, i) => renderRow(r, i, i === INPUT_REGISTERS.length - 1))}

        <SectionRow label="ADC Registers" range={`${ADC_RANGE.first}–${ADC_RANGE.last}`} fc="FC04 · read" />
        {ADC_REGISTERS.map((r, i) => renderRow(r, i, i === ADC_REGISTERS.length - 1))}

        <SectionRow label="Holding Registers" range={`${HOLDING_RANGE.first}–${HOLDING_RANGE.last}`} fc="FC06 · write" />
        {HOLDING_REGISTERS.map((r, i) => renderRow(r, i, i === HOLDING_REGISTERS.length - 1))}
      </Box>

      {/* 비트 디코드 — 2000 / 1000 */}
      <Box sx={{ flexShrink: 0, borderTop: `1px solid ${C.line}`, bgcolor: C.surfaceAlt, px: 1.75, py: 1.6 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <BitGroup title="Action Status" addr={REG.ACTION_STATUS} value={values[REG.ACTION_STATUS] ?? 0}
            connected={connected} bits={STATUS_DECODE} errKey="gERR" />
          <BitGroup title="Action Request" addr={REG.ACTION_REQUEST} value={values[REG.ACTION_REQUEST] ?? 0}
            connected={connected} bits={REQUEST_DECODE} />
        </Box>
        {connected && (values[REG.FAULT_STATUS] ?? 0) !== 0 && (
          <Typography sx={{ fontSize: '0.64rem', color: C.danger, fontWeight: 700, fontFamily: C.mono, mt: 1 }}>
            FAULT CODE {formatRegister(values[REG.FAULT_STATUS] ?? 0, 'Hex16')} (0x603F error code)
          </Typography>
        )}
      </Box>
    </Paper>
  );
};

export default ModbusMonitor;
