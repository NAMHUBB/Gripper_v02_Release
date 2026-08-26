import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Box, Typography, TextField, Select, MenuItem,
  Button, Checkbox, Paper, Chip,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import CheckIcon from '@mui/icons-material/Check';
import { GripperState } from '../App';
import { getRegCache } from '../scriptRunner';

interface Props {
  state: GripperState;
  updateState: (p: Partial<GripperState>) => void;
  onAdcValuesUpdate: (adc: number[]) => void;
  /** 데모 모드에서 App이 생성한 입력 레지스터(2000~2015) 값 */
  demoRegisters?: Record<number, number>;
}

const BAUD_RATES: number[] = [9600, 19200, 38400, 57600, 115200, 230400];
const MODBUS_IDS: number[] = Array.from({ length: 255 }, (_, i) => i + 1);
const COM_PORTS:  string[] = Array.from({ length: 256 }, (_, i) => `COM${i + 1}`);
const DEFAULT_COM_PORT = 'COM1';

const registers = [
  { addr: 2000, format: 'Bin4',  comment: 'REG_ACTION_STATUS'            }, // ← bit0~3만 사용 → 4비트
  { addr: 2001, format: 'Dec16', comment: 'RESERVED'                     },
  { addr: 2002, format: 'Dec16', comment: 'REG_FAULT_STATUS'             },
  { addr: 2003, format: 'Int16', comment: 'REG_POSITION_ECHO(0.1deg)'    },
  { addr: 2004, format: 'Int16', comment: 'REG_CURR_POSITION(0.1deg)'    },
  { addr: 2005, format: 'Int16', comment: 'REG_CURR_TORQUE(0.1% TR)'     },
  { addr: 2006, format: 'Dec16', comment: 'RESERVED'                     },
  { addr: 2007, format: 'Int16', comment: 'REG_ORIGIN_POS_ECHO(0.1deg)'  },
  { addr: 2010, format: 'Int16', comment: 'ADC0'                         },
  { addr: 2011, format: 'Int16', comment: 'ADC1'                         },
  { addr: 2012, format: 'Int16', comment: 'ADC2'                         },
  { addr: 2013, format: 'Int16', comment: 'ADC3'                         },
  { addr: 2014, format: 'Int16', comment: 'ADC4'                         },
  { addr: 2015, format: 'Int16', comment: 'ADC5'                         },
  { addr: 1000, format: 'Bin6',  comment: 'REG_ACTION_REQUEST'           }, // ← bit0~5만 사용 → 6비트
  { addr: 1001, format: 'Dec16', comment: 'RESERVED'                     },
  { addr: 1002, format: 'Dec16', comment: 'RESERVED'                     },
  { addr: 1003, format: 'Int16', comment: 'REG_POSITION_REQUEST(0.1deg)' },
  { addr: 1004, format: 'Dec16', comment: 'REG_SPEED_REQUEST(deg/s)'     },
  { addr: 1005, format: 'Dec16', comment: 'REG_FORCE_REQUEST(0.1% TR)'   },
  { addr: 1006, format: 'Dec16', comment: 'REG_ACC_REQUEST(deg/s^2)'     },
  { addr: 1007, format: 'Int16', comment: 'REG_ORIGIN_POS(0.1deg)'       },
];

// 포맷 드롭다운 옵션 — Bin4 / Bin6 추가
const FORMAT_OPTIONS = ['Dec16', 'Int16', 'Bin4', 'Bin6', 'Bin16', 'Hex16'];

const selectSx = {
  height: 28, fontSize: '0.82rem', bgcolor: '#fff',
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#CBD8E8' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#90CAF9' },
  '& .MuiSelect-select': { py: 0.4, px: 1 },
};
const btnSx = {
  fontSize: '0.75rem', borderColor: '#CBD8E8', color: '#1A2A3A', height: 28, px: 1.5,
  '&:hover': { borderColor: '#1976D2', color: '#1976D2', bgcolor: '#E3F2FD' },
};

const formatValue = (raw: number, fmt: string): string => {
  const u16 = raw < 0 ? raw + 65536 : raw;
  switch (fmt) {
    case 'Int16':  return String(raw);
    case 'Bin4':   return (u16 & 0x0F).toString(2).padStart(4,  '0');  // 4비트: bit0~3
    case 'Bin6':   return (u16 & 0x3F).toString(2).padStart(6,  '0');  // 6비트: bit0~5
    case 'Bin16':  return u16.toString(2).padStart(16, '0');
    case 'Hex16':  return '0x' + u16.toString(16).toUpperCase().padStart(4, '0');
    default:       return String(u16); // Dec16
  }
};

const ModbusTab: React.FC<Props> = ({ state, updateState, onAdcValuesUpdate, demoRegisters }) => {
  const safeInitPort = COM_PORTS.includes(state.port) ? state.port : DEFAULT_COM_PORT;

  const [draft, setDraft] = useState({
    comPort:      safeInitPort,
    baudRate:     state.baudRate,
    stopBit:      state.stopBit,
    parity:       state.parity,
    slaveId:      state.slaveId,
    termResistor: state.termResistor,
  });

  const [statusMsg,    setStatusMsg]    = useState<string | null>(null);
  const [adcReadError, setAdcReadError] = useState<string | null>(null);

  const [formats, setFormats] = useState<Record<number, string>>(() =>
    Object.fromEntries(registers.map(r => [r.addr, r.format]))
  );

  const [liveValues, setLiveValues] = useState<Record<number, number>>(() =>
    Object.fromEntries(registers.map(r => [r.addr, 0]))
  );

  useEffect(() => {
    if (!COM_PORTS.includes(state.port)) {
      updateState({ port: DEFAULT_COM_PORT });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 데모 모드: App이 생성한 시뮬레이션 레지스터 값을 그대로 반영 (통신 없음)
  useEffect(() => {
    if (!state.connected || !state.demo || !demoRegisters) return;
    setLiveValues(prev => ({ ...prev, ...demoRegisters }));
    setAdcReadError(null);
  }, [state.connected, state.demo, demoRegisters]);

  useEffect(() => {
    if (!state.connected) {
      setAdcReadError(null);
      onAdcValuesUpdate([0, 0, 0, 0, 0, 0]);
      return;
    }
    if (state.demo) return;   // 데모 모드에서는 실제 폴링을 하지 않는다

    const poll = async () => {
      const [inp1, inp2, hold] = await Promise.allSettled([
        invoke<number[]>('modbus_read_input_registers',   { address: 2000, quantity: 8 }),
        invoke<number[]>('modbus_read_input_registers',   { address: 2010, quantity: 6 }),
        invoke<number[]>('modbus_read_holding_registers', { address: 1000, quantity: 8 }),
      ]);

      setLiveValues(prev => {
        const next = { ...prev };
        if (inp1.status === 'fulfilled')
          inp1.value.forEach((v, i) => { next[2000 + i] = v; });
        if (inp2.status === 'fulfilled')
          inp2.value.forEach((v, i) => { next[2010 + i] = v; });
        if (hold.status === 'fulfilled')
          hold.value.forEach((v, i) => { next[1000 + i] = v; });

        const cache = getRegCache();
        Object.entries(cache).forEach(([addrStr, cachedVal]) => {
          const addr = parseInt(addrStr, 10);
          if (addr >= 1000 && addr <= 1007) {
            const hwVal = next[addr];
            if (hwVal === 0 || hold.status === 'rejected') {
              next[addr] = cachedVal;
            }
          }
        });
        return next;
      });

      if (inp2.status === 'rejected') {
        setAdcReadError('ADC(2010~2015) read failed');
        onAdcValuesUpdate([0, 0, 0, 0, 0, 0]);
      } else {
        onAdcValuesUpdate((inp2 as PromiseFulfilledResult<number[]>).value);
        setAdcReadError(null);
      }
    };

    poll();
    const iv = setInterval(poll, 400);
    return () => clearInterval(iv);
  }, [state.connected, state.demo, onAdcValuesUpdate]);

  const flash = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 1600);
  };

  const handleComPortChange = (val: string) => {
    setDraft(s => ({ ...s, comPort: val }));
    updateState({ port: val });
  };

  const handleApply = () => {
    updateState({
      port:         draft.comPort,
      baudRate:     draft.baudRate,
      stopBit:      draft.stopBit,
      parity:       draft.parity,
      slaveId:      draft.slaveId,
      termResistor: draft.termResistor,
    });
    flash('Applied');
  };

  const handleDefault = () => {
    const d = {
      comPort:      DEFAULT_COM_PORT,
      baudRate:     115200,
      stopBit:      '1'    as const,
      parity:       'None' as const,
      slaveId:      1,
      termResistor: false,
    };
    setDraft(d);
    updateState({ port: DEFAULT_COM_PORT, baudRate: 115200, stopBit: '1', parity: 'None', slaveId: 1, termResistor: false });
    flash('Reset to default');
  };

  const isDirty =
    draft.baudRate     !== state.baudRate     ||
    draft.stopBit      !== state.stopBit      ||
    draft.parity       !== state.parity       ||
    draft.slaveId      !== state.slaveId      ||
    draft.termResistor !== state.termResistor;

  const menuMaxHeight = { sx: { maxHeight: 240 } };

  const rows: { label: string; control: React.ReactNode }[] = [
    {
      label: 'COM Port',
      control: (
        <Select value={draft.comPort} size="small" sx={{ ...selectSx, width: 110 }}
          onChange={e => handleComPortChange(e.target.value)} MenuProps={menuMaxHeight}>
          {COM_PORTS.map(p => <MenuItem key={p} value={p} sx={{ fontSize: '0.82rem' }}>{p}</MenuItem>)}
        </Select>
      ),
    },
    {
      label: 'Baud Rate',
      control: (
        <Select value={draft.baudRate} size="small" sx={{ ...selectSx, width: 110 }}
          onChange={e => setDraft(s => ({ ...s, baudRate: Number(e.target.value) }))}>
          {BAUD_RATES.map(v => <MenuItem key={v} value={v} sx={{ fontSize: '0.82rem' }}>{v}</MenuItem>)}
        </Select>
      ),
    },
    {
      label: 'Stop Bit',
      control: (
        <Select value={draft.stopBit} size="small" sx={{ ...selectSx, width: 80 }}
          onChange={e => setDraft(s => ({ ...s, stopBit: e.target.value as '1' | '2' }))}>
          {['1', '2'].map(v => <MenuItem key={v} value={v} sx={{ fontSize: '0.82rem' }}>{v}</MenuItem>)}
        </Select>
      ),
    },
    {
      label: 'Parity',
      control: (
        <Select value={draft.parity} size="small" sx={{ ...selectSx, width: 80 }}
          onChange={e => setDraft(s => ({ ...s, parity: e.target.value as 'None' | 'Even' | 'Odd' }))}>
          {['None', 'Even', 'Odd'].map(v => <MenuItem key={v} value={v} sx={{ fontSize: '0.82rem' }}>{v}</MenuItem>)}
        </Select>
      ),
    },
    {
      label: 'Slave ID',
      control: (
        <Select value={draft.slaveId} size="small" sx={{ ...selectSx, width: 80 }}
          onChange={e => setDraft(s => ({ ...s, slaveId: Number(e.target.value) }))} MenuProps={menuMaxHeight}>
          {MODBUS_IDS.map(v => <MenuItem key={v} value={v} sx={{ fontSize: '0.82rem' }}>{v}</MenuItem>)}
        </Select>
      ),
    },
    {
      label: 'Termination Resistor',
      control: (
        <Checkbox checked={draft.termResistor} size="small"
          onChange={e => setDraft(s => ({ ...s, termResistor: e.target.checked }))}
          sx={{ p: '3px', color: '#90A4AE', '&.Mui-checked': { color: '#1976D2' } }} />
      ),
    },
  ];

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', overflow: 'hidden' }}>

      {/* LEFT */}
      <Box sx={{ p: 2.5, borderRight: '1px solid #E0EAF4', bgcolor: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: '#1A2A3A', mb: 1.5 }}>
          Modbus RTU
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
          {rows.map(({ label, control }) => (
            <Box key={label} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: '0.82rem', color: '#1A2A3A', fontWeight: 500 }}>{label}</Typography>
              {control}
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 2, p: 1.2, bgcolor: '#F8FAFC', borderRadius: 1.5, border: `1px solid ${isDirty ? '#FFF3E0' : '#EEF2F7'}` }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
            <Typography sx={{ fontSize: '0.65rem', color: '#90A4AE', fontWeight: 600, letterSpacing: '0.04em' }}>
              ACTIVE SETTINGS
            </Typography>
            {isDirty && (
              <Typography sx={{ fontSize: '0.6rem', color: '#FB8C00', fontWeight: 600 }}>● unsaved changes</Typography>
            )}
          </Box>
          {[
            { k: 'COM Port',  v: draft.comPort },
            { k: 'Baud Rate', v: String(state.baudRate) },
            { k: 'Stop Bit',  v: state.stopBit },
            { k: 'Parity',    v: state.parity },
            { k: 'Slave ID',  v: String(state.slaveId) },
          ].map(({ k, v }) => (
            <Box key={k} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <Typography sx={{ fontSize: '0.7rem', color: '#90A4AE' }}>{k}</Typography>
              <Typography sx={{ fontSize: '0.7rem', fontWeight: 600, color: '#1A2A3A', fontFamily: 'monospace' }}>{v}</Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <Button variant="outlined" size="small" onClick={handleDefault}
            startIcon={<RestoreIcon sx={{ fontSize: '13px !important' }} />} sx={btnSx}>
            Default
          </Button>
          <Button variant="outlined" size="small" onClick={handleApply}
            startIcon={<CheckIcon sx={{ fontSize: '13px !important' }} />}
            sx={{ ...btnSx, borderColor: isDirty ? '#1976D2' : '#BBDEFB', color: '#1976D2', fontWeight: isDirty ? 700 : 400, '&:hover': { bgcolor: '#E3F2FD', borderColor: '#1976D2' } }}>
            Apply
          </Button>
        </Box>

        {statusMsg && (
          <Typography sx={{ fontSize: '0.72rem', color: '#388E3C', mt: 1 }}>✓ {statusMsg}</Typography>
        )}
      </Box>

      {/* RIGHT */}
      <Box sx={{ p: 2.5, bgcolor: '#FAFBFC', overflowY: 'auto' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: '#1A2A3A' }}>Modbus Monitor</Typography>
            <Typography sx={{ fontSize: '0.7rem', color: '#90A4AE' }}>
              Input Register (2000–2015) · Holding Register (1000–1007)
            </Typography>
            {adcReadError && (
              <Typography sx={{ fontSize: '0.68rem', color: '#D84315', mt: 0.2 }}>{adcReadError}</Typography>
            )}
          </Box>
          <Chip
            label={
              !state.connected ? 'Offline'
                : state.demo   ? `Demo · ${state.baudRate}`
                :                `Live · ${state.baudRate}`
            }
            size="small"
            sx={{
              bgcolor: !state.connected ? '#F5F5F5' : state.demo ? '#FFF3E0' : '#E8F5E9',
              color:   !state.connected ? '#9E9E9E' : state.demo ? '#EF6C00' : '#2E7D32',
              border:  `1px solid ${!state.connected ? '#E0E0E0' : state.demo ? '#FFCC80' : '#A5D6A7'}`,
              fontSize: '0.7rem',
            }}
          />
        </Box>

        <Paper sx={{ overflow: 'hidden', border: '1px solid #E0EAF4' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '70px 90px 1fr 150px', px: 1.5, py: 0.8, bgcolor: '#F0F4F8', borderBottom: '1px solid #E0EAF4' }}>
            {['Address', 'Format', 'Comment', 'Value'].map(h => (
              <Typography key={h} sx={{ fontSize: '0.7rem', fontWeight: 600, color: '#5A7A9A', ...(h === 'Comment' && { pl: 1.5 }) }}>
                {h}
              </Typography>
            ))}
          </Box>

          {registers.map((r, i) => {
            const isHolding  = r.addr < 2000;
            const cache      = getRegCache();
            const displayVal = isHolding && cache[r.addr] !== undefined
              ? cache[r.addr]
              : (liveValues[r.addr] ?? 0);

            return (
              <Box
                key={r.addr}
                sx={{
                  display: 'grid', gridTemplateColumns: '70px 90px 1fr 150px',
                  px: 1.5, py: 0.7, alignItems: 'center',
                  bgcolor: i % 2 === 0 ? '#fff' : '#FAFBFC',
                  borderBottom: i < registers.length - 1 ? '1px solid #EEF2F7' : 'none',
                  '&:hover': { bgcolor: '#EBF3FF' },
                }}
              >
                <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, fontFamily: 'monospace', color: r.addr >= 2000 ? '#1976D2' : '#5E35B1' }}>
                  {r.addr}
                </Typography>
                <Select
                  value={formats[r.addr] ?? r.format}
                  size="small"
                  onChange={e => setFormats(f => ({ ...f, [r.addr]: e.target.value }))}
                  sx={{
                    height: 22, fontSize: '0.68rem',
                    '& .MuiSelect-select': { py: 0.2, px: 0.6 },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#E0EAF4' },
                  }}
                >
                  {FORMAT_OPTIONS.map(f => (
                    <MenuItem key={f} value={f} sx={{ fontSize: '0.72rem' }}>{f}</MenuItem>
                  ))}
                </Select>
                <Typography sx={{ fontSize: '0.75rem', color: '#1A2A3A', pl: 1.5 }}>{r.comment}</Typography>
                <TextField
                  value={formatValue(displayVal, formats[r.addr] ?? r.format)}
                  size="small"
                  slotProps={{ input: { readOnly: true } }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      height: 22, fontSize: '0.72rem', fontFamily: 'monospace',
                      bgcolor: state.connected
                        ? (r.addr >= 2000 ? '#F0F7FF' : '#FFF8F0')
                        : '#FAFAFA',
                      '& fieldset': { borderColor: '#E0EAF4' },
                    },
                    '& .MuiInputBase-input': {
                      py: 0.15, px: 0.8,
                      color: state.connected ? '#1A2A3A' : '#B0BEC5',
                    },
                  }}
                />
              </Box>
            );
          })}
        </Paper>
      </Box>
    </Box>
  );
};

export default ModbusTab;