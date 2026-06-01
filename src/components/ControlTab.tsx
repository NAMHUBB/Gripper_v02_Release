import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  Box, Paper, Typography, Switch, Slider, Button,
  Dialog, DialogTitle, DialogContent, IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

import { GripperState, DataPoint } from '../App';
import { PH11_SPEC, mAtoNm } from '../constants';
import GripperViewer from './GripperViewer';
import { parseScript, runScript, saveScript, loadScript } from '../scriptRunner';

const POS_MAX = 255;
const POS_MIN = -255;
const CMD_FONT = '"Consolas", "Courier New", monospace';

// ── 자동완성 목록 (지원 명령어만) ─────────────────────────────────────────────
const ALL_COMMANDS = [
  { cmd: 'rq_activate_and_wait()', hint: '서보 ON + 준비 대기',        cursorInside: false },
  { cmd: 'rq_open_and_wait()',     hint: '완전 열기 (0%)',              cursorInside: false },
  { cmd: 'rq_close_and_wait()',    hint: '완전 닫기 (100%)',            cursorInside: false },
  { cmd: 'rq_move_and_wait_norm()',hint: '위치 이동 % (0~100)',         cursorInside: true  },
  { cmd: 'rq_set_speed_norm()',    hint: '속도 설정 % (0~100)',         cursorInside: true  },
  { cmd: 'rq_set_force_norm()',    hint: '힘 설정 % (0~100)',           cursorInside: true  },
  { cmd: 'rq_reset()',             hint: '에러 리셋 + 재활성화',         cursorInside: false },
  { cmd: 'rq_emergency_release()', hint: '즉시 정지 (비상)',             cursorInside: false },
  { cmd: 'LOG()',                  hint: '로그 출력',                    cursorInside: true  },
  { cmd: 'WAIT()',                 hint: '대기 (ms)',                    cursorInside: true  },
  { cmd: 'REPEAT()',               hint: 'n회 반복 시작',                cursorInside: true  },
  { cmd: 'END',                    hint: 'REPEAT 종료',                 cursorInside: false },
];

// ── 설명서 데이터 (지원 명령어만) ─────────────────────────────────────────────
const COMMAND_DOCS = [
  {
    category: '초기화',
    color: '#1565C0',
    commands: [
      { cmd: 'rq_activate_and_wait()', args: '',       desc: '서보 ON 후 준비 완료까지 자동 대기. 스크립트 첫 줄에 필수.' },
    ],
  },
  {
    category: '이동 명령',
    color: '#2E7D32',
    commands: [
      { cmd: 'rq_open_and_wait()',          args: '',        desc: '완전 열기 (0%). 이동 완료 후 다음 명령 실행.' },
      { cmd: 'rq_close_and_wait()',         args: '',        desc: '완전 닫기 (100%). 이동 완료 후 다음 명령 실행.' },
      { cmd: 'rq_move_and_wait_norm(pos)',  args: '0~100',   desc: '지정 % 위치로 이동.  예) rq_move_and_wait_norm(50) → 중간' },
    ],
  },
  {
    category: '파라미터 설정',
    color: '#6A1B9A',
    commands: [
      { cmd: 'rq_set_speed_norm(speed)', args: '0~100', desc: '속도 설정.  기본값=50  /  100% = 360 deg/s\n예) rq_set_speed_norm(80) → 빠르게' },
      { cmd: 'rq_set_force_norm(force)', args: '0~100', desc: '힘 설정.  기본값=40  /  100% = 3.5 Nm\n예) rq_set_force_norm(30) → 약하게' },
    ],
  },
  {
    category: '제어',
    color: '#BF360C',
    commands: [
      { cmd: 'rq_reset()',             args: '', desc: '에러 리셋 후 재활성화.' },
      { cmd: 'rq_emergency_release()', args: '', desc: '즉시 정지. 비상 상황에서만 사용.' },
    ],
  },
  {
    category: '흐름 제어',
    color: '#37474F',
    commands: [
      { cmd: 'WAIT(ms)',     args: 'ms',  desc: '대기.  예) WAIT(500) → 0.5초  /  WAIT(1000) → 1초' },
      { cmd: 'REPEAT(n)',   args: 'n',   desc: 'n회 반복 시작. END로 닫아야 함.  예) REPEAT(3)' },
      { cmd: 'END',         args: '',    desc: 'REPEAT 블록 종료.' },
    ],
  },
  {
    category: '유틸리티',
    color: '#00695C',
    commands: [
      { cmd: 'LOG(메시지)', args: 'text', desc: '로그창에 메시지 출력.  예) LOG(동작 완료)' },
      { cmd: '# 주석',     args: '',     desc: '실행되지 않음.  예) # 그리핑 시작' },
    ],
  },
];

// ── 단위 변환 참고표 ────────────────────────────────────────────────────────────
const UNIT_TABLE = [
  { cmd: 'rq_move_and_wait_norm(0)',   reg: '1003=0',     real: '0.0도 (열림)' },
  { cmd: 'rq_move_and_wait_norm(50)',  reg: '1003=-1000', real: '-100.0도' },
  { cmd: 'rq_move_and_wait_norm(100)', reg: '1003=-2000', real: '-200.0도 (닫힘)' },
  { cmd: 'rq_set_speed_norm(25)',      reg: '1004=90',    real: '90 deg/s' },
  { cmd: 'rq_set_speed_norm(50)',      reg: '1004=180',   real: '180 deg/s' },
  { cmd: 'rq_set_speed_norm(100)',     reg: '1004=360',   real: '360 deg/s' },
  { cmd: 'rq_set_force_norm(25)',      reg: '1005=250',   real: '0.88 Nm' },
  { cmd: 'rq_set_force_norm(50)',      reg: '1005=500',   real: '1.75 Nm' },
  { cmd: 'rq_set_force_norm(100)',     reg: '1005=1000',  real: '3.5 Nm (정격)' },
];

// ── 설명서 모달 ────────────────────────────────────────────────────────────────
const ScriptHelpModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
    slotProps={{ paper: { sx: { borderRadius: 2, maxHeight: '88vh' } } }}>
    <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1, fontSize: '0.9rem', fontWeight: 700, color: '#0D1B2A' }}>
      📋 스크립트 명령어 설명서
      <IconButton size="small" onClick={onClose} sx={{ color: '#78909C' }}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </DialogTitle>
    <DialogContent sx={{ pt: 0 }}>

      {/* 기본 실행 순서 */}
      <Box sx={{ mb: 2.5 }}>
        <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#607D8B', mb: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          기본 실행 순서
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {[
            { step: '1', label: '초기화 (필수)',   code: 'rq_activate_and_wait()',                        color: '#1565C0', bg: '#DCEEFB' },
            { step: '2', label: '파라미터 설정',   code: 'rq_set_speed_norm(50)\nrq_set_force_norm(40)', color: '#6A1B9A', bg: '#EDE7F6' },
            { step: '3', label: '이동 실행',       code: 'rq_open_and_wait()\nrq_close_and_wait()\nrq_move_and_wait_norm(50)', color: '#2E7D32', bg: '#DCEDC8' },
            { step: '4', label: '반복 (선택)',     code: 'REPEAT(3)\n  rq_close_and_wait()\n  WAIT(500)\n  rq_open_and_wait()\nEND', color: '#37474F', bg: '#ECEFF1' },
          ].map(({ step, label, code, color, bg }, i) => (
            <Box key={step}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, mt: 0.3 }}>
                  {step}
                </Box>
                <Box sx={{ flex: 1, bgcolor: bg, borderRadius: 1.5, p: '6px 10px', border: `1px solid ${color}44` }}>
                  <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, color, mb: 0.3 }}>{label}</Typography>
                  <Box sx={{ fontFamily: CMD_FONT, fontSize: '0.71rem', fontWeight: 600, color, lineHeight: 1.8 }}>
                    {code.split('\n').map((line, j) => <Box key={j}>{line}</Box>)}
                  </Box>
                </Box>
              </Box>
              {i < 3 && <Box sx={{ pl: '9px', color: '#90A4AE', fontSize: 14, lineHeight: 1 }}>↓</Box>}
            </Box>
          ))}
        </Box>
      </Box>

      {/* 명령어 표 */}
      {COMMAND_DOCS.map(({ category, color, commands }) => (
        <Box key={category} sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color, mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {category}
          </Typography>
          <Box sx={{ border: '1px solid #CFD8DC', borderRadius: 1.5, overflow: 'hidden' }}>
            {commands.map(({ cmd, args, desc }, i) => (
              <Box key={cmd} sx={{
                display: 'grid', gridTemplateColumns: '200px 55px 1fr',
                px: 1.5, py: 1, alignItems: 'flex-start',
                bgcolor: i % 2 === 0 ? '#fff' : '#F5F7FA',
                borderBottom: i < commands.length - 1 ? '1px solid #E3EAF0' : 'none',
              }}>
                <Typography sx={{ fontSize: '0.69rem', fontFamily: CMD_FONT, fontWeight: 700, color: '#4527A0', letterSpacing: '-0.01em' }}>
                  {cmd}
                </Typography>
                <Typography sx={{ fontSize: '0.67rem', fontFamily: CMD_FONT, fontWeight: 700, color: '#BF360C' }}>
                  {args}
                </Typography>
                <Box>
                  {desc.split('\n').map((line, j) => (
                    <Typography key={j} sx={{ fontSize: '0.68rem', color: '#263238', fontWeight: 500, lineHeight: 1.6 }}>
                      {line}
                    </Typography>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ))}

      {/* 단위 변환 참고표 */}
      <Box sx={{ mb: 1 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#607D8B', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          단위 변환 참고표
        </Typography>
        <Box sx={{ border: '1px solid #CFD8DC', borderRadius: 1.5, overflow: 'hidden' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', px: 1.5, py: 0.6, bgcolor: '#F0F4F8', borderBottom: '1px solid #CFD8DC' }}>
            {['명령어', '레지스터', '실제값'].map(h => (
              <Typography key={h} sx={{ fontSize: '0.63rem', fontWeight: 700, color: '#546E7A' }}>{h}</Typography>
            ))}
          </Box>
          {UNIT_TABLE.map(({ cmd, reg, real }, i) => (
            <Box key={cmd} sx={{
              display: 'grid', gridTemplateColumns: '1fr 100px 100px',
              px: 1.5, py: 0.7,
              bgcolor: i % 2 === 0 ? '#fff' : '#F5F7FA',
              borderBottom: i < UNIT_TABLE.length - 1 ? '1px solid #E3EAF0' : 'none',
            }}>
              <Typography sx={{ fontSize: '0.67rem', fontFamily: CMD_FONT, fontWeight: 600, color: '#4527A0' }}>{cmd}</Typography>
              <Typography sx={{ fontSize: '0.67rem', fontFamily: CMD_FONT, fontWeight: 600, color: '#1565C0' }}>{reg}</Typography>
              <Typography sx={{ fontSize: '0.67rem', color: '#37474F', fontWeight: 500 }}>{real}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

    </DialogContent>
  </Dialog>
);

// ── Tooltips ──────────────────────────────────────────────────────────────────
const PosTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #E0EAF4', borderRadius: 1, p: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <Typography sx={{ fontSize: '0.65rem', color: '#90A4AE', mb: 0.3 }}>t = {Number(label).toFixed(1)} s</Typography>
      {payload.map((p: any) => (
        <Typography key={p.name} sx={{ fontSize: '0.7rem', color: p.color, fontWeight: 500 }}>
          {p.name}: {Math.round(p.value ?? 0)}
        </Typography>
      ))}
    </Box>
  );
};

const ADC_SERIES = [
  { key: 'adc0', color: '#1565C0' },
  { key: 'adc1', color: '#2E7D32' },
  { key: 'adc2', color: '#F9A825' },
  { key: 'adc3', color: '#7B1FA2' },
  { key: 'adc4', color: '#00838F' },
  { key: 'adc5', color: '#AD1457' },
] as const;

const ForceTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #E0EAF4', borderRadius: 1, p: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <Typography sx={{ fontSize: '0.65rem', color: '#90A4AE', mb: 0.3 }}>t = {Number(label).toFixed(1)} s</Typography>
      {payload.map((p: any) => (
        <Box key={p.name} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5 }}>
          <Typography sx={{ fontSize: '0.68rem', color: p.stroke }}>{p.name}</Typography>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 500, color: p.stroke }}>
            {p.name === 'Force' ? `${Number(p.value).toFixed(2)} Nm` : Number(p.value).toFixed(0)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

const LabelSwitch: React.FC<{ label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ label, checked, disabled, onChange }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <Typography sx={{ fontSize: '0.72rem', color: disabled ? '#C5D0D8' : '#546E7A', fontWeight: 500 }}>{label}</Typography>
    <Switch size="small" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
      sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#1976D2' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#90CAF9' } }} />
  </Box>
);

const ParamSlider: React.FC<{ label: string; value: number; disabled?: boolean; onChange: (v: number) => void }> = ({ label, value, disabled, onChange }) => (
  <Box>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Typography sx={{ fontSize: '0.67rem', color: '#90A4AE' }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: disabled ? '#C5D0D8' : '#37474F' }}>
        {value}<span style={{ fontSize: '0.58rem', color: '#B0BEC5', marginLeft: 2 }}>/255</span>
      </Typography>
    </Box>
    <Slider size="small" min={0} max={255} value={value} disabled={disabled} onChange={(_, v) => onChange(v as number)}
      sx={{ py: 0.5, color: disabled ? '#E0EAF4' : '#1976D2', '& .MuiSlider-thumb': { width: 11, height: 11, boxShadow: 'none' }, '& .MuiSlider-rail': { bgcolor: '#E8EDF2' }, '& .MuiSlider-track': { border: 'none' } }} />
  </Box>
);

interface Props {
  state: GripperState;
  updateState: (patch: Partial<GripperState>) => void;
  chartData: DataPoint[];
  isMoving: boolean;
}

const paperSx = { sx: { display: 'flex', flexDirection: 'column' as const, border: '1px solid #EEF2F7', borderRadius: 2, bgcolor: '#fff' } };
const axisStyle = { tick: { fontSize: 9, fill: '#C5D0D8' }, axisLine: false as const, tickLine: false as const };

const ControlTab: React.FC<Props> = ({ state, updateState, chartData, isMoving }) => {
  const forceData = chartData.map(d => ({ ...d, forceNm: mAtoNm(d.current) }));

  const statusColor = state.eStop       ? '#C62828'
    : state.activated  ? '#43A047'
    : state.connected  ? '#1976D2'
    :                    '#90A4AE';

  // ── 스크립트: localStorage에서 초기값 복원 ────────────────────────────────
  const [scriptText, setScriptText] = useState<string>(() => loadScript());

  const [logs,        setLogs]        = useState<string[]>([]);
  const [running,     setRunning]     = useState(false);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [helpOpen,    setHelpOpen]    = useState(false);
  const [suggestions, setSuggestions] = useState<typeof ALL_COMMANDS>([]);
  const [suggestionIdx, setSuggestionIdx] = useState(0);
  const [dropdownTop, setDropdownTop] = useState(4);

  const stopSignalRef     = useRef({ stopped: false });
  const logEndRef         = useRef<HTMLDivElement>(null);
  const textareaRef       = useRef<HTMLTextAreaElement>(null);
  const dropdownRef       = useRef<HTMLDivElement>(null);
  const stateRef          = useRef(state);
  const isKeyboardNavRef  = useRef(false);

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!dropdownRef.current || suggestions.length === 0) return;
    const items = dropdownRef.current.querySelectorAll('[data-suggestion-item]');
    const selected = items[suggestionIdx] as HTMLElement;
    selected?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [suggestionIdx, suggestions]);

  const updateDropdownTop = useCallback(() => {
    if (!textareaRef.current) return;
    const ta          = textareaRef.current;
    const cursor      = ta.selectionStart ?? 0;
    const lineNum     = ta.value.slice(0, cursor).split('\n').length - 1;
    const lineHeightPx = 12 * 1.6;
    const paddingTop  = 8;
    const top         = (lineNum + 1) * lineHeightPx + paddingTop - ta.scrollTop;
    setDropdownTop(Math.max(4, top));
  }, []);

  const addLog = (msg: string) => {
    const now = new Date();
    const ts  = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    setLogs(prev => [...prev.slice(-199), `[${ts}] ${msg}`]);
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  };

  const getCurrentWord = useCallback((val: string, cursor: number) => {
    const textBefore = val.slice(0, cursor);
    const lineStart  = textBefore.lastIndexOf('\n') + 1;
    return textBefore.slice(lineStart).trimStart();
  }, []);

  // ── textarea 변경: 자동저장 포함 ─────────────────────────────────────────
  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setScriptText(val);
    saveScript(val);          // ← localStorage 자동 저장
    setParseErrors([]);

    const cursor       = e.target.selectionStart ?? 0;
    const word         = getCurrentWord(val, cursor);
    const wordForMatch = word.replace(/\(.*$/, '');

    if (wordForMatch.length >= 2 && !wordForMatch.includes(' ')) {
      const matches = ALL_COMMANDS.filter(c => {
        const cmdBase = c.cmd.replace(/\(.*$/, '').toLowerCase();
        return cmdBase.startsWith(wordForMatch.toLowerCase()) && cmdBase !== wordForMatch.toLowerCase();
      });
      setSuggestions(matches);
      setSuggestionIdx(0);
      updateDropdownTop();
    } else {
      setSuggestions([]);
    }
  };

  const applySuggestion = useCallback((item: typeof ALL_COMMANDS[0]) => {
    if (!textareaRef.current) return;
    const cursor     = textareaRef.current.selectionStart;
    const val        = scriptText;
    const textBefore = val.slice(0, cursor);
    const lineStart  = textBefore.lastIndexOf('\n') + 1;
    const lineText   = textBefore.slice(lineStart);
    const indent     = lineText.match(/^(\s*)/)?.[1] ?? '';
    const currentWord = lineText.trimStart();
    const newVal     = val.slice(0, lineStart + indent.length) + item.cmd + val.slice(lineStart + indent.length + currentWord.length);

    setScriptText(newVal);
    saveScript(newVal);       // ← 자동완성 선택 시에도 저장
    setSuggestions([]);

    const insertedLen  = item.cmd.length;
    const cursorOffset = item.cursorInside ? insertedLen - 1 : insertedLen;
    const newCursor    = lineStart + indent.length + cursorOffset;
    setTimeout(() => {
      textareaRef.current?.setSelectionRange(newCursor, newCursor);
      textareaRef.current?.focus();
    }, 0);
  }, [scriptText]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length === 0) return;
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      applySuggestion(suggestions[suggestionIdx]);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      isKeyboardNavRef.current = true;
      setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      isKeyboardNavRef.current = true;
      setSuggestionIdx(i => Math.max(i - 1, 0));
    }
  };

  const handleRun = async () => {
    const { commands, errors } = parseScript(scriptText);
    setParseErrors(errors);
    if (errors.length > 0)   { addLog(`❌ 파싱 오류 ${errors.length}건 — 실행 중단`); return; }
    if (!state.connected)    { addLog('❌ 그리퍼가 연결되지 않았습니다'); return; }
    setLogs([]);
    setRunning(true);
    stopSignalRef.current = { stopped: false };
    addLog('▶ 스크립트를 시작합니다');
    try {
      await runScript(commands, {
        updateState,
        getState:   () => stateRef.current,
        onLog:      addLog,
        stopSignal: stopSignalRef.current,
      });
    } finally {
      setRunning(false);
    }
  };

  const handleStop = () => {
    stopSignalRef.current.stopped = true;
    setRunning(false);
  };

  // ── Clear: localStorage도 함께 비움 ──────────────────────────────────────
  const handleClear = () => {
    setScriptText('');
    saveScript('');           // ← localStorage 초기화
    setLogs([]);
    setParseErrors([]);
    setSuggestions([]);
    textareaRef.current?.focus();
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1.2, p: 1.5, overflow: 'hidden' }}>

      <ScriptHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* 상단: 차트 */}
      <Box sx={{ display: 'flex', gap: 1.2, flex: 1, minHeight: 0 }}>

        <Paper elevation={0} {...paperSx} sx={{ ...paperSx.sx, flex: 1, p: '12px 14px 6px' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#1976D2' }}>Position Echo / Actual</Typography>
            <Box sx={{ display: 'flex', gap: 1.2 }}>
              {[{ c: '#1976D2', l: 'Echo' }, { c: '#43A047', l: 'Actual' }].map(({ c, l }) => (
                <Box key={l} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Box sx={{ width: 14, height: 2, bgcolor: c, borderRadius: 1 }} />
                  <Typography sx={{ fontSize: '0.6rem', color: '#B0BEC5' }}>{l}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 2, right: 6, left: -14, bottom: 14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F4F7FA" vertical={false} />
                <XAxis dataKey="time" tickFormatter={v => `${Number(v).toFixed(0)}s`} {...axisStyle}
                  label={{ value: 'Time (s)', position: 'insideBottom', offset: -4, style: { fontSize: 9, fill: '#C5D0D8' } }} />
                <YAxis domain={[POS_MIN, POS_MAX]} tickCount={9} {...axisStyle} tickFormatter={v => `${v}`} />
                <Tooltip content={<PosTooltip />} />
                <ReferenceLine y={0} stroke="#E0EAF4" strokeWidth={1.5} />
                <Line type="monotoneX" dataKey="echo"   stroke="#1976D2" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Echo" />
                <Line type="monotoneX" dataKey="actual" stroke="#43A047" strokeWidth={1.5} dot={false} isAnimationActive={false} name="Actual" />
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

        <Paper elevation={0} {...paperSx} sx={{ ...paperSx.sx, flex: 1, p: '12px 14px 6px' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6 }}>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: '#1976D2' }}>Force & ADC</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, alignItems: 'center' }}>
              {[{ c: '#E64A19', l: 'Force' }, ...ADC_SERIES.map((s, i) => ({ c: s.color, l: `ADC${i}` }))].map(({ c, l }) => (
                <Box key={l} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <Box sx={{ width: 12, height: 2, bgcolor: c, borderRadius: 1 }} />
                  <Typography sx={{ fontSize: '0.58rem', color: '#B0BEC5' }}>{l}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forceData} margin={{ top: 2, right: 36, left: 2, bottom: 14 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F4F7FA" vertical={false} />
                <XAxis dataKey="time" tickFormatter={v => `${Number(v).toFixed(0)}s`} {...axisStyle}
                  label={{ value: 'Time (s)', position: 'insideBottom', offset: -4, style: { fontSize: 9, fill: '#C5D0D8' } }} />
                <YAxis domain={['auto', 'auto']} tickCount={9} {...axisStyle} tickFormatter={v => `${v}`} />
                <Tooltip content={<ForceTooltip />} />
                <ReferenceLine y={0} stroke="#E0EAF4" strokeWidth={1.5} />
                <Line type="monotoneX" dataKey="forceNm" stroke="#E64A19" strokeWidth={2} dot={false} isAnimationActive={false} name="Force" />
                {ADC_SERIES.map((s, i) => (
                  <Line key={s.key} type="monotoneX" dataKey={s.key} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} name={`ADC${i}`} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Box>
        </Paper>

      </Box>

      {/* 하단: 3분할 */}
      <Box sx={{ display: 'flex', gap: 1.2, flex: 1, minHeight: 0 }}>

        {/* 그리퍼 뷰어 */}
        <Paper elevation={0} {...paperSx} sx={{ ...paperSx.sx, flex: 3.5, p: '10px 12px' }}>
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <GripperViewer
              openRatio={state.positionActual / 255} tilt={0} spread={0}
              isMoving={isMoving} statusColor={statusColor}
              objectDetected={state.objectDetected}
              connected={state.connected} activated={state.activated} eStop={state.eStop}
            />
          </Box>
        </Paper>

        {/* 수동 제어 */}
        <Paper elevation={0} {...paperSx} sx={{ ...paperSx.sx, flex: 3, p: '12px 14px', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8, pb: 1, borderBottom: '1px solid #F0F4F8' }}>
            <LabelSwitch label="Activate" checked={state.activated}
              disabled={!state.connected || state.eStop}
              onChange={v => updateState({ activated: v, goToPosition: false })} />
            <LabelSwitch label="Go to Position" checked={state.goToPosition}
              disabled={!state.activated || state.eStop}
              onChange={v => updateState({ goToPosition: v })} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, py: 1 }}>
            {[{ label: 'OPEN', val: 0 }, { label: 'CLOSE', val: 255 }].map(({ label, val }) => {
              const active = state.positionRequest === val && state.goToPosition;
              return (
                <Button key={label} fullWidth size="small"
                  disabled={!state.goToPosition || state.eStop}
                  onClick={() => updateState({ positionRequest: val })}
                  sx={{
                    fontSize: '0.78rem', fontWeight: 200, py: 1, borderRadius: 1.5, boxShadow: 'none',
                    ...(active
                      ? { bgcolor: '#1976D2', color: '#fff', '&:hover': { bgcolor: '#1565C0', boxShadow: 'none' } }
                      : { bgcolor: '#F5F7FA', color: '#90A4AE', border: '1px solid #E8EDF2', '&:hover': { bgcolor: '#EEF2F7', boxShadow: 'none' } }),
                    '&.Mui-disabled': { bgcolor: '#F5F7FA', color: '#C5D0D8', border: '1px solid #EEF2F7' },
                  }}>
                  {label}
                </Button>
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2, flex: 1, justifyContent: 'center' }}>
            <ParamSlider label="Position" value={state.positionRequest}
              disabled={!state.goToPosition || state.eStop}
              onChange={v => updateState({ positionRequest: v })} />
            <ParamSlider label="Speed" value={state.speed}
              disabled={!state.activated || state.eStop}
              onChange={v => updateState({ speed: v })} />
            <ParamSlider label="Force" value={state.force}
              disabled={!state.activated || state.eStop}
              onChange={v => updateState({ force: v })} />
          </Box>
        </Paper>

        {/* 스크립트 에디터 */}
        <Paper elevation={0} {...paperSx} sx={{ ...paperSx.sx, flex: 3.5, p: '10px 12px', gap: 0.8 }}>

          {/* 헤더 */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#1A2A3A' }}>Script</Typography>
              <Button size="small" onClick={() => setHelpOpen(true)}
                sx={{ minWidth: 0, width: 20, height: 20, p: 0, borderRadius: '50%', bgcolor: '#EEF2F7', color: '#546E7A', fontSize: '0.65rem', fontWeight: 700, lineHeight: 1, '&:hover': { bgcolor: '#E3F2FD', color: '#1976D2' } }}>
                ?
              </Button>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.6 }}>
              <Button size="small" onClick={handleClear}
                sx={{ fontSize: '0.65rem', py: 0.2, px: 1, minWidth: 0, color: '#B0BEC5', '&:hover': { color: '#E53935' } }}>
                Clear
              </Button>
              {running ? (
                <Button size="small" onClick={handleStop}
                  sx={{ fontSize: '0.68rem', py: 0.3, px: 1.2, minWidth: 0, bgcolor: '#FFEBEE', color: '#C62828', borderRadius: 1.5, '&:hover': { bgcolor: '#FFCDD2' } }}>
                  ■ Stop
                </Button>
              ) : (
                <Button size="small" onClick={handleRun}
                  sx={{ fontSize: '0.68rem', py: 0.3, px: 1.2, minWidth: 0, bgcolor: '#E3F2FD', color: '#1976D2', borderRadius: 1.5, '&:hover': { bgcolor: '#BBDEFB' } }}>
                  ▶ Run
                </Button>
              )}
            </Box>
          </Box>

          {/* 파싱 오류 */}
          {parseErrors.length > 0 && (
            <Box sx={{ bgcolor: '#FFF3E0', borderRadius: 1, p: '4px 8px', flexShrink: 0 }}>
              {parseErrors.map((e, i) => (
                <Typography key={i} sx={{ fontSize: '0.62rem', color: '#BF360C', fontFamily: CMD_FONT, fontWeight: 600 }}>
                  Line {e.line}: {e.message}
                </Typography>
              ))}
            </Box>
          )}

          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}>

            {/* 텍스트 에디터 */}
            <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <textarea
                ref={textareaRef}
                value={scriptText}
                onChange={handleScriptChange}
                onKeyDown={handleKeyDown}
                onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                spellCheck={false}
                placeholder={'# 스크립트를 입력하세요\n# 예시:\nrq_activate_and_wait()\nrq_set_speed_norm(50)\nrq_set_force_norm(40)\nrq_open_and_wait()'}
                style={{
                  width: '100%', height: '100%', resize: 'none',
                  border: '1px solid #EEF2F7', borderRadius: 6,
                  padding: '8px 10px', fontSize: 12,
                  fontFamily: CMD_FONT, lineHeight: 1.6,
                  color: '#1A2A3A', background: '#FAFBFC',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />

              {/* 자동완성 드롭다운 */}
              {suggestions.length > 0 && (
                <Box ref={dropdownRef}
                  onMouseMove={() => { isKeyboardNavRef.current = false; }}
                  sx={{
                    position: 'absolute',
                    top: dropdownTop, left: 4, right: 4,
                    bgcolor: '#fff',
                    border: '1px solid #90CAF9',
                    borderRadius: 1.5,
                    boxShadow: '0 4px 20px rgba(25,118,210,0.15)',
                    zIndex: 100, maxHeight: 180, overflowY: 'auto',
                  }}>
                  {suggestions.map((s, i) => (
                    <Box key={s.cmd} data-suggestion-item="true"
                      onMouseEnter={() => { if (!isKeyboardNavRef.current) setSuggestionIdx(i); }}
                      onMouseDown={() => applySuggestion(s)}
                      sx={{
                        px: 1.5, py: 0.85, cursor: 'pointer',
                        bgcolor: i === suggestionIdx ? '#E3F2FD' : 'transparent',
                        borderLeft: i === suggestionIdx ? '3px solid #1565C0' : '3px solid transparent',
                        borderBottom: i < suggestions.length - 1 ? '1px solid #F0F4F8' : 'none',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                      <Typography sx={{ fontSize: '0.72rem', fontFamily: CMD_FONT, fontWeight: i === suggestionIdx ? 700 : 600, color: i === suggestionIdx ? '#1565C0' : '#4527A0' }}>
                        {s.cmd}
                      </Typography>
                      <Typography sx={{ fontSize: '0.63rem', color: i === suggestionIdx ? '#1565C0' : '#546E7A', ml: 1, fontWeight: i === suggestionIdx ? 600 : 400 }}>
                        {s.hint}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* 로그 */}
            <Box sx={{ height: 80, overflowY: 'auto', bgcolor: '#F0F4F8', borderRadius: 1.5, p: '4px 8px', flexShrink: 0 }}>
              {logs.length === 0 && (
                <Typography sx={{ fontSize: '0.62rem', color: '#B0BEC5', mt: 0.5 }}>실행 로그가 여기에 표시됩니다.</Typography>
              )}
              {logs.map((l, i) => (
                <Typography key={i} sx={{
                  fontSize: '0.62rem', fontFamily: CMD_FONT, lineHeight: 1.7,
                  color: l.includes('❌') ? '#E53935'
                    : l.includes('✔')    ? '#388E3C'
                    : l.includes('🚨')   ? '#C62828'
                    :                      '#37474F',
                }}>
                  {l}
                </Typography>
              ))}
              <div ref={logEndRef} />
            </Box>

          </Box>
        </Paper>
      </Box>
    </Box>
  );
};

export default ControlTab;