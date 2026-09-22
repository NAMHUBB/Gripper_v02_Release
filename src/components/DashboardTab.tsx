import React from 'react';
import { Box, Paper, Typography, Switch, Slider, Button } from '@mui/material';

import { GripperState, DataPoint } from '../App';
import LineChart from '../chart/LineChart';
import { torqueToNm, regToDeg, posToReg, speedToReg, forceToReg, UI_MAX, PERIOD_SEC } from '../constants';
import { REG, STATUS_BIT, STATUS_BITS, ADC_COUNT } from '../registers';
import { C } from '../theme';
import GripperViewer from './GripperViewer';
import ModbusMonitor from './ModbusMonitor';

// ── Dashboard 탭 ──────────────────────────────────────────────────────────────
// 한 화면에 Position 차트 / Torque & ADC0~5 차트 / URDF 뷰어 / 수동 제어 / Modbus 모니터를
// 모두 배치한다. (스크립트 편집기는 파일 하단에 주석 처리되어 있음)
//
//  ┌───────────────────────┬───────────────────────┬──────────────┐
//  │ Position (deg)        │ Torque (%) & ADC0~5   │              │
//  ├───────────────────────┼───────────────────────┤ Modbus       │
//  │ 3D Gripper (URDF)     │ Manual Control        │ Monitor      │
//  └───────────────────────┴───────────────────────┴──────────────┘
//
// 차트는 dmt-gripper-controller 의 Monitoring 차트와 같은 설정을 쓴다:
//  · y축 0 중심 ±range 고정(5 눈금) — 데이터에 맞춰 스케일이 바뀌지 않는다
//  · x축은 연결 시점 t = 0 부터 누적, nice-step 자동 눈금(데이터로거식)
//  · 의존성 없는 SVG · 호버 크로스헤어 + t/값 라벨 · Position 파랑 / Torque 빨강

/** Position 차트 y축: ±200 deg (0 = 열림, −200 = 닫힘) */
const POS_RANGE_DEG = 200;
/** Torque 차트 y축: ±100 % of rated */
const TORQUE_RANGE_PCT = 100;
/** ADC 우측 축 상한 (mV) — 3.3 V ADC 를 nice 눈금(0/1000/2000/3000/4000)으로 */
const ADC_AXIS_MAX_MV = 4000;

/** 우측 Modbus 모니터 컬럼 폭 (px) */
const MONITOR_WIDTH = 470;

// ── 소형 UI 조각 ──────────────────────────────────────────────────────────────
const DemoBadge: React.FC = () => (
  <Box sx={{ px: 0.7, py: '1px', borderRadius: 0.8, bgcolor: C.warnBg, border: `1px solid ${C.warnLine}`, lineHeight: 1 }}>
    <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: C.warn, letterSpacing: '0.08em' }}>
      DEMO
    </Typography>
  </Box>
);

const Legend: React.FC<{ items: { c: string; l: string }[] }> = ({ items }) => (
  <Box sx={{ display: 'flex', gap: 0.9, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }}>
    {items.map(({ c, l }) => (
      <Box key={l} sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
        <Box sx={{ width: 12, height: 2, bgcolor: c, borderRadius: 1 }} />
        <Typography sx={{ fontSize: '0.6rem', color: C.muted }}>{l}</Typography>
      </Box>
    ))}
  </Box>
);

const PanelTitle: React.FC<{ title: string; demo?: boolean; right?: React.ReactNode }> = ({ title, demo, right }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.6, flexShrink: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, flexShrink: 0 }}>
      <Typography noWrap sx={{ fontSize: '0.72rem', fontWeight: 700, color: C.title }}>{title}</Typography>
      {demo && <DemoBadge />}
    </Box>
    {right}
  </Box>
);

/** 읽기값 타일 — 값 글자는 통일 색, 시리즈 구분은 좌측 색띠로만 */
const Readout: React.FC<{ label: string; value: string; unit?: string; sub?: string; bar: string }> = ({ label, value, unit, sub, bar }) => (
  <Box sx={{ bgcolor: C.surfaceAlt, border: `1px solid ${C.lineSoft}`, borderLeft: `3px solid ${bar}`, borderRadius: 1.5, px: 1.2, py: 1, minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.6rem', color: C.sub, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</Typography>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.4, minWidth: 0, mt: 0.2 }}>
      <Typography noWrap sx={{ fontSize: '1.15rem', fontWeight: 700, color: C.text, fontFamily: C.mono, lineHeight: 1.2 }}>{value}</Typography>
      {unit && <Typography sx={{ fontSize: '0.64rem', color: C.muted }}>{unit}</Typography>}
    </Box>
    {sub && <Typography noWrap sx={{ fontSize: '0.62rem', color: C.muted, fontFamily: C.mono, lineHeight: 1.4, mt: 0.2 }}>{sub}</Typography>}
  </Box>
);

/** ADC 채널용 소형 읽기값 타일 — 6개가 한 줄에 들어가도록 값 글자를 줄였다 */
const ReadoutSmall: React.FC<{ label: string; value: string; unit: string; bar: string }> = ({ label, value, unit, bar }) => (
  <Box sx={{ bgcolor: C.surfaceAlt, border: `1px solid ${C.lineSoft}`, borderLeft: `3px solid ${bar}`, borderRadius: 1.5, px: 0.8, py: 0.6, minWidth: 0 }}>
    <Typography sx={{ fontSize: '0.56rem', color: C.sub, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</Typography>
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.3, minWidth: 0, mt: 0.1 }}>
      <Typography noWrap sx={{ fontSize: '0.86rem', fontWeight: 700, color: C.text, fontFamily: C.mono, lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.58rem', color: C.muted }}>{unit}</Typography>
    </Box>
  </Box>
);

/** 펌웨어 REG_ACTION_STATUS(2000) 비트 표시 */
const StatusBits: React.FC<{ status: number; connected: boolean }> = ({ status, connected }) => (
  <Box sx={{ display: 'flex', gap: 0.4 }}>
    {STATUS_BITS.map(b => {
      const on    = connected && (status & b.mask) !== 0;
      const isErr = b.key === 'gERR';
      return (
        <Box key={b.key} title={`${b.key} — ${b.title}`} sx={{
          px: 0.6, py: '1px', borderRadius: 0.8, lineHeight: 1.4,
          fontSize: '0.56rem', fontWeight: 700, fontFamily: C.mono, letterSpacing: '0.04em',
          bgcolor: on ? (isErr ? C.dangerBg : C.surfaceTint) : 'transparent',
          color:   on ? (isErr ? C.danger : C.accent) : C.faint,
          border:  `1px solid ${on ? (isErr ? '#EF9A9A' : '#BBDEFB') : C.lineSoft}`,
        }}>
          {b.label}
        </Box>
      );
    })}
  </Box>
);

const LabelSwitch: React.FC<{ label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }> = ({ label, checked, disabled, onChange }) => (
  <Box sx={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    px: 1.4, py: 0.8, borderRadius: 1.5,
    bgcolor: checked && !disabled ? C.surfaceTint : C.surfaceAlt,
    border: `1px solid ${checked && !disabled ? '#BBDEFB' : C.lineSoft}`,
  }}>
    <Typography sx={{ fontSize: '0.78rem', color: disabled ? C.faint : C.text, fontWeight: 600 }}>{label}</Typography>
    <Switch size="small" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)}
      sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: C.accent }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#90CAF9' } }} />
  </Box>
);

const ParamSlider: React.FC<{ label: string; value: number; regText: string; disabled?: boolean; onChange: (v: number) => void }> = ({ label, value, regText, disabled, onChange }) => (
  <Box>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
      <Typography sx={{ fontSize: '0.7rem', color: disabled ? C.faint : C.sub, fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: disabled ? C.faint : C.text, fontFamily: C.mono }}>
        {value}<span style={{ fontSize: '0.58rem', color: C.muted, marginLeft: 2, fontWeight: 400 }}>/{UI_MAX}</span>
        <span style={{ fontSize: '0.6rem', color: C.muted, marginLeft: 8, fontWeight: 500 }}>{regText}</span>
      </Typography>
    </Box>
    <Slider size="small" min={0} max={UI_MAX} value={value} disabled={disabled} onChange={(_, v) => onChange(v as number)}
      sx={{ py: 1, color: disabled ? C.line : C.accent, '& .MuiSlider-thumb': { width: 12, height: 12, boxShadow: 'none' }, '& .MuiSlider-rail': { bgcolor: C.lineSoft }, '& .MuiSlider-track': { border: 'none' } }} />
  </Box>
);

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  state: GripperState;
  updateState: (patch: Partial<GripperState>) => void;
  chartData: DataPoint[];
  isMoving: boolean;
  /** Modbus 모니터 표시값 (App 이 폴링/시뮬레이션으로 채움) */
  regValues: Record<number, number>;
  regReadError: string | null;
  onFaultReset: () => Promise<void>;
}

const paperSx = {
  display: 'flex', flexDirection: 'column' as const, minHeight: 0, minWidth: 0,
  border: `1px solid ${C.line}`, borderRadius: 2, bgcolor: C.surface, boxShadow: 'none',
};

const DashboardTab: React.FC<Props> = ({ state, updateState, chartData, isMoving, regValues, regReadError, onFaultReset }) => {
  // 차트 시리즈 — 펌웨어 공학 단위로 변환 (deg / % of rated / mV)
  const echoDeg   = chartData.map(d => regToDeg(posToReg(d.echo)));
  const actualDeg = chartData.map(d => regToDeg(posToReg(d.actual)));
  const torquePct = chartData.map(d => d.torque / 10);
  // ADC0 ~ ADC5 — 채널별 시리즈 (우측 축, mV)
  const adcSeries = Array.from({ length: ADC_COUNT }, (_, ch) => ({
    key: `adc${ch}`, label: `ADC${ch}`, color: C.seriesAdcCh[ch] ?? C.seriesAdc,
    data: chartData.map(d => d.adc[ch] ?? 0), width: 1.0,
    format: (v: number) => `${v.toFixed(0)} mV`,
  }));
  const forceNm   = torqueToNm(state.torqueActual);
  const fault     = (state.actionStatus & STATUS_BIT.gERR) !== 0;

  const statusColor = state.eStop      ? C.danger
    : fault            ? C.danger
    : state.activated  ? C.ok
    : state.connected  ? C.accent
    :                    C.muted;
  const statusText = state.eStop ? 'E-STOP' : fault ? `FAULT 0x${state.faultCode.toString(16).toUpperCase().padStart(4, '0')}`
    : state.activated ? 'Active' : state.connected ? 'Online' : 'Offline';

  return (
    <Box sx={{
      height: '100%', p: 1.5, overflow: 'hidden',
      display: 'grid', gap: 1.2,
      gridTemplateColumns: `minmax(0, 1fr) ${MONITOR_WIDTH}px`,
    }}>

      {/* ══ 좌측: 차트 2개 + (뷰어 / 수동 제어) ══════════════════════════════ */}
      <Box sx={{ display: 'grid', gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 1.2, minHeight: 0, minWidth: 0 }}>

        {/* Position 차트 — deg, ±200 고정 */}
        <Paper elevation={0} sx={{ ...paperSx, p: '12px 14px 6px' }}>
          <PanelTitle title="Position (deg)" demo={state.demo}
            right={<Legend items={[{ c: C.seriesActual, l: 'Actual' }, { c: C.seriesEcho, l: 'Echo (cmd)' }]} />} />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <LineChart
              yRange={POS_RANGE_DEG}
              yLabel="Position (deg)"
              periodSec={PERIOD_SEC}
              series={[
                { key: 'echo',   label: 'Echo',   data: echoDeg,   color: C.seriesEcho,   dash: '4 3', width: 1.2, format: v => `${v.toFixed(1)}°` },
                { key: 'actual', label: 'Actual', data: actualDeg, color: C.seriesActual,  width: 1.4,             format: v => `${v.toFixed(1)}°` },
              ]}
            />
          </Box>
        </Paper>

        {/* Torque 차트 — % of rated, ±100 고정 · ADC0~5 는 우측 축 (0~4000 mV) */}
        <Paper elevation={0} sx={{ ...paperSx, p: '12px 14px 6px' }}>
          <PanelTitle title="Torque (%) & ADC (mV)" demo={state.demo}
            right={<Legend items={[{ c: C.seriesTorque, l: 'Torque' }, ...adcSeries.map(s => ({ c: s.color, l: s.label }))]} />} />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <LineChart
              yRange={TORQUE_RANGE_PCT}
              yLabel="Motor Torque (%/rated)"
              periodSec={PERIOD_SEC}
              series={[
                { key: 'torque', label: 'Torque', data: torquePct, color: C.seriesTorque, width: 1.4, format: v => `${v.toFixed(1)} %` },
              ]}
              right={{ label: 'ADC (mV)', max: ADC_AXIS_MAX_MV, series: adcSeries }}
            />
          </Box>
        </Paper>

        {/* 3D 그리퍼 뷰어 (URDF) */}
        <Paper elevation={0} sx={{ ...paperSx, p: '10px 12px' }}>
          <PanelTitle title="3D Gripper" />
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <GripperViewer
              openRatio={state.positionActual / UI_MAX} tilt={0} spread={0}
              isMoving={isMoving} statusColor={statusColor}
              objectDetected={state.objectDetected}
              connected={state.connected} activated={state.activated} eStop={state.eStop}
            />
          </Box>
        </Paper>

        {/* 수동 제어 */}
        <Paper elevation={0} sx={{ ...paperSx, p: '12px 14px', justifyContent: 'space-between', gap: 0.9 }}>
          <PanelTitle title="Manual Control" demo={state.demo}
            right={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <StatusBits status={state.actionStatus} connected={state.connected} />
                <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: statusColor }}>● {statusText}</Typography>
              </Box>
            } />

          {/* 실시간 읽기값 — 펌웨어 단위 병기 */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 0.8 }}>
            <Readout label="Echo"   value={String(state.positionEcho)}   sub={`${regToDeg(regValues[REG.POSITION_ECHO] ?? posToReg(state.positionEcho)).toFixed(1)}°`}   bar={C.seriesEcho} />
            <Readout label="Actual" value={String(state.positionActual)} sub={`${regToDeg(regValues[REG.CURR_POSITION] ?? posToReg(state.positionActual)).toFixed(1)}°`} bar={C.seriesActual} />
            <Readout label="Torque" value={forceNm.toFixed(2)} unit="Nm" sub={`${state.torqueActual} ‰ TR`} bar={C.seriesTorque} />
          </Box>
          {/* ADC0 ~ ADC5 읽기값 (mV) */}
          <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(${ADC_COUNT}, minmax(0, 1fr))`, gap: 0.6 }}>
            {adcSeries.map((s, ch) => (
              <ReadoutSmall key={s.key} label={s.label} value={String(Math.round(state.adc[ch] ?? 0))} unit="mV" bar={s.color} />
            ))}
          </Box>

          {/* Activate / Go to Position */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.8 }}>
            <LabelSwitch label="Activate" checked={state.activated}
              disabled={!state.connected || state.eStop}
              onChange={v => updateState({ activated: v, goToPosition: false })} />
            <LabelSwitch label="Go to Position" checked={state.goToPosition}
              disabled={!state.activated || state.eStop}
              onChange={v => updateState({ goToPosition: v })} />
          </Box>

          {/* OPEN / CLOSE (+ Fault Reset) */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            {[{ label: 'OPEN', val: 0 }, { label: 'CLOSE', val: UI_MAX }].map(({ label, val }) => {
              const active = state.positionRequest === val && state.goToPosition;
              return (
                <Button key={label} fullWidth size="small"
                  disabled={!state.goToPosition || state.eStop}
                  onClick={() => updateState({ positionRequest: val })}
                  sx={{
                    fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.08em',
                    py: 1.8, borderRadius: 1.5, boxShadow: 'none',
                    ...(active
                      ? { bgcolor: C.accent, color: '#fff', '&:hover': { bgcolor: C.title, boxShadow: 'none' } }
                      : { bgcolor: C.surfaceAlt, color: C.sub, border: `1px solid ${C.line}`, '&:hover': { bgcolor: C.surfaceTint, boxShadow: 'none' } }),
                    '&.Mui-disabled': { bgcolor: C.surfaceAlt, color: C.faint, border: `1px solid ${C.lineSoft}` },
                  }}>
                  {label}
                </Button>
              );
            })}
            {fault && (
              <Button size="small" onClick={() => { onFaultReset(); }}
                sx={{
                  flexShrink: 0, fontSize: '0.72rem', fontWeight: 700, px: 1.6, borderRadius: 1.5,
                  bgcolor: C.dangerBg, color: C.danger, border: '1px solid #EF9A9A',
                  '&:hover': { bgcolor: '#FFCDD2' },
                }}>
                Reset Fault
              </Button>
            )}
          </Box>

          {/* Position / Speed / Force — 레지스터 값 병기 */}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
            <ParamSlider label="Position" value={state.positionRequest}
              regText={`1003 = ${posToReg(state.positionRequest)} (${regToDeg(posToReg(state.positionRequest)).toFixed(1)}°)`}
              disabled={!state.goToPosition || state.eStop}
              onChange={v => updateState({ positionRequest: v })} />
            <ParamSlider label="Speed" value={state.speed}
              regText={`1004 = ${speedToReg(state.speed)} deg/s`}
              disabled={!state.activated || state.eStop}
              onChange={v => updateState({ speed: v })} />
            <ParamSlider label="Force" value={state.force}
              regText={`1005 = ${forceToReg(state.force)} (${torqueToNm(forceToReg(state.force)).toFixed(2)} Nm)`}
              disabled={!state.activated || state.eStop}
              onChange={v => updateState({ force: v })} />
          </Box>
        </Paper>

        {/* 스크립트 편집기 — 비활성화 (파일 하단 ScriptPanel 주석 블록 참고)
        <ScriptPanel state={state} updateState={updateState} />
        */}
      </Box>

      {/* ══ 우측: Modbus 모니터 (레지스터 테이블) ═══════════════════════════ */}
      <ModbusMonitor
        connected={state.connected}
        demo={state.demo}
        baudRate={state.baudRate}
        values={regValues}
        readError={regReadError}
      />
    </Box>
  );
};

export default DashboardTab;


// ─────────────────────────────────────────────────────────────────────────────
// ↓↓↓  스크립트 편집기 (ScriptPanel) — 전체 주석 처리 / 현재 미사용  ↓↓↓
// ─────────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//  ScriptPanel — 스크립트 편집기 (현재 비활성화)
//
//  기존 ControlTab 의 스크립트 편집기(자동완성 / 설명서 모달 / 실행 로그)를
//  독립 컴포넌트로 묶어 둔 것입니다. 다시 사용하려면:
//    1) src/scriptRunner.ts 의 주석을 해제 (파일 상단 안내 참고)
//    2) 이 블록의 선행 `// ` 를 제거
//    3) DashboardTab 상단 import 에 아래 항목 추가
//         import { useRef, useState, useCallback, useEffect } from 'react';
//         import { Dialog, DialogTitle, DialogContent, IconButton } from '@mui/material';
//         import CloseIcon from '@mui/icons-material/Close';
//         import { parseScript, runScript, saveScript, loadScript } from '../scriptRunner';
//    4) 레이아웃의 `<ScriptPanel state={state} updateState={updateState} />` 주석 해제
//       (좌측 그리드를 3열로 바꾸거나 별도 탭으로 배치)
// ═══════════════════════════════════════════════════════════════════════════════
// const CMD_FONT = '"Consolas", "Courier New", monospace';
//
// // ── 자동완성 목록 (지원 명령어만) ─────────────────────────────────────────────
// const ALL_COMMANDS = [
//   { cmd: 'rq_activate_and_wait()', hint: '서보 ON + 준비 대기',        cursorInside: false },
//   { cmd: 'rq_open_and_wait()',     hint: '완전 열기 (0%)',              cursorInside: false },
//   { cmd: 'rq_close_and_wait()',    hint: '완전 닫기 (100%)',            cursorInside: false },
//   { cmd: 'rq_move_and_wait_norm()',hint: '위치 이동 % (0~100)',         cursorInside: true  },
//   { cmd: 'rq_set_speed_norm()',    hint: '속도 설정 % (0~100)',         cursorInside: true  },
//   { cmd: 'rq_set_force_norm()',    hint: '힘 설정 % (0~100)',           cursorInside: true  },
//   { cmd: 'rq_reset()',             hint: '에러 리셋 + 재활성화',         cursorInside: false },
//   { cmd: 'rq_emergency_release()', hint: '즉시 정지 (비상)',             cursorInside: false },
//   { cmd: 'LOG()',                  hint: '로그 출력',                    cursorInside: true  },
//   { cmd: 'WAIT()',                 hint: '대기 (ms)',                    cursorInside: true  },
//   { cmd: 'REPEAT()',               hint: 'n회 반복 시작',                cursorInside: true  },
//   { cmd: 'END',                    hint: 'REPEAT 종료',                 cursorInside: false },
// ];
//
// // ── 설명서 데이터 (지원 명령어만) ─────────────────────────────────────────────
// const COMMAND_DOCS = [
//   {
//     category: '초기화',
//     color: '#1565C0',
//     commands: [
//       { cmd: 'rq_activate_and_wait()', args: '',       desc: '서보 ON 후 준비 완료까지 자동 대기. 스크립트 첫 줄에 필수.' },
//     ],
//   },
//   {
//     category: '이동 명령',
//     color: '#2E7D32',
//     commands: [
//       { cmd: 'rq_open_and_wait()',          args: '',        desc: '완전 열기 (0%). 이동 완료 후 다음 명령 실행.' },
//       { cmd: 'rq_close_and_wait()',         args: '',        desc: '완전 닫기 (100%). 이동 완료 후 다음 명령 실행.' },
//       { cmd: 'rq_move_and_wait_norm(pos)',  args: '0~100',   desc: '지정 % 위치로 이동.  예) rq_move_and_wait_norm(50) → 중간' },
//     ],
//   },
//   {
//     category: '파라미터 설정',
//     color: '#6A1B9A',
//     commands: [
//       { cmd: 'rq_set_speed_norm(speed)', args: '0~100', desc: '속도 설정.  기본값=50  /  100% = 360 deg/s\n예) rq_set_speed_norm(80) → 빠르게' },
//       { cmd: 'rq_set_force_norm(force)', args: '0~100', desc: '힘 설정.  기본값=40  /  100% = 3.5 Nm\n예) rq_set_force_norm(30) → 약하게' },
//     ],
//   },
//   {
//     category: '제어',
//     color: '#BF360C',
//     commands: [
//       { cmd: 'rq_reset()',             args: '', desc: '에러 리셋 후 재활성화.' },
//       { cmd: 'rq_emergency_release()', args: '', desc: '즉시 정지. 비상 상황에서만 사용.' },
//     ],
//   },
//   {
//     category: '흐름 제어',
//     color: '#37474F',
//     commands: [
//       { cmd: 'WAIT(ms)',     args: 'ms',  desc: '대기.  예) WAIT(500) → 0.5초  /  WAIT(1000) → 1초' },
//       { cmd: 'REPEAT(n)',   args: 'n',   desc: 'n회 반복 시작. END로 닫아야 함.  예) REPEAT(3)' },
//       { cmd: 'END',         args: '',    desc: 'REPEAT 블록 종료.' },
//     ],
//   },
//   {
//     category: '유틸리티',
//     color: '#00695C',
//     commands: [
//       { cmd: 'LOG(메시지)', args: 'text', desc: '로그창에 메시지 출력.  예) LOG(동작 완료)' },
//       { cmd: '# 주석',     args: '',     desc: '실행되지 않음.  예) # 그리핑 시작' },
//     ],
//   },
// ];
//
// // ── 단위 변환 참고표 ────────────────────────────────────────────────────────────
// const UNIT_TABLE = [
//   { cmd: 'rq_move_and_wait_norm(0)',   reg: '1003=0',     real: '0.0도 (열림)' },
//   { cmd: 'rq_move_and_wait_norm(50)',  reg: '1003=-1000', real: '-100.0도' },
//   { cmd: 'rq_move_and_wait_norm(100)', reg: '1003=-2000', real: '-200.0도 (닫힘)' },
//   { cmd: 'rq_set_speed_norm(25)',      reg: '1004=90',    real: '90 deg/s' },
//   { cmd: 'rq_set_speed_norm(50)',      reg: '1004=180',   real: '180 deg/s' },
//   { cmd: 'rq_set_speed_norm(100)',     reg: '1004=360',   real: '360 deg/s' },
//   { cmd: 'rq_set_force_norm(25)',      reg: '1005=250',   real: '0.88 Nm' },
//   { cmd: 'rq_set_force_norm(50)',      reg: '1005=500',   real: '1.75 Nm' },
//   { cmd: 'rq_set_force_norm(100)',     reg: '1005=1000',  real: '3.5 Nm (정격)' },
// ];
//
// // ── 설명서 모달 ────────────────────────────────────────────────────────────────
// const ScriptHelpModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
//   <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
//     slotProps={{ paper: { sx: { borderRadius: 2, maxHeight: '88vh' } } }}>
//     <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1, fontSize: '0.9rem', fontWeight: 700, color: '#0D1B2A' }}>
//       📋 스크립트 명령어 설명서
//       <IconButton size="small" onClick={onClose} sx={{ color: '#78909C' }}>
//         <CloseIcon fontSize="small" />
//       </IconButton>
//     </DialogTitle>
//     <DialogContent sx={{ pt: 0 }}>
//
//       {/* 기본 실행 순서 */}
//       <Box sx={{ mb: 2.5 }}>
//         <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#607D8B', mb: 1, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
//           기본 실행 순서
//         </Typography>
//         <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
//           {[
//             { step: '1', label: '초기화 (필수)',   code: 'rq_activate_and_wait()',                        color: '#1565C0', bg: '#DCEEFB' },
//             { step: '2', label: '파라미터 설정',   code: 'rq_set_speed_norm(50)\nrq_set_force_norm(40)', color: '#6A1B9A', bg: '#EDE7F6' },
//             { step: '3', label: '이동 실행',       code: 'rq_open_and_wait()\nrq_close_and_wait()\nrq_move_and_wait_norm(50)', color: '#2E7D32', bg: '#DCEDC8' },
//             { step: '4', label: '반복 (선택)',     code: 'REPEAT(3)\n  rq_close_and_wait()\n  WAIT(500)\n  rq_open_and_wait()\nEND', color: '#37474F', bg: '#ECEFF1' },
//           ].map(({ step, label, code, color, bg }, i) => (
//             <Box key={step}>
//               <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
//                 <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0, mt: 0.3 }}>
//                   {step}
//                 </Box>
//                 <Box sx={{ flex: 1, bgcolor: bg, borderRadius: 1.5, p: '6px 10px', border: `1px solid ${color}44` }}>
//                   <Typography sx={{ fontSize: '0.63rem', fontWeight: 700, color, mb: 0.3 }}>{label}</Typography>
//                   <Box sx={{ fontFamily: CMD_FONT, fontSize: '0.71rem', fontWeight: 600, color, lineHeight: 1.8 }}>
//                     {code.split('\n').map((line, j) => <Box key={j}>{line}</Box>)}
//                   </Box>
//                 </Box>
//               </Box>
//               {i < 3 && <Box sx={{ pl: '9px', color: '#90A4AE', fontSize: 14, lineHeight: 1 }}>↓</Box>}
//             </Box>
//           ))}
//         </Box>
//       </Box>
//
//       {/* 명령어 표 */}
//       {COMMAND_DOCS.map(({ category, color, commands }) => (
//         <Box key={category} sx={{ mb: 2 }}>
//           <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color, mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
//             {category}
//           </Typography>
//           <Box sx={{ border: '1px solid #CFD8DC', borderRadius: 1.5, overflow: 'hidden' }}>
//             {commands.map(({ cmd, args, desc }, i) => (
//               <Box key={cmd} sx={{
//                 display: 'grid', gridTemplateColumns: '200px 55px 1fr',
//                 px: 1.5, py: 1, alignItems: 'flex-start',
//                 bgcolor: i % 2 === 0 ? '#fff' : '#F5F7FA',
//                 borderBottom: i < commands.length - 1 ? '1px solid #E3EAF0' : 'none',
//               }}>
//                 <Typography sx={{ fontSize: '0.69rem', fontFamily: CMD_FONT, fontWeight: 700, color: '#4527A0', letterSpacing: '-0.01em' }}>
//                   {cmd}
//                 </Typography>
//                 <Typography sx={{ fontSize: '0.67rem', fontFamily: CMD_FONT, fontWeight: 700, color: '#BF360C' }}>
//                   {args}
//                 </Typography>
//                 <Box>
//                   {desc.split('\n').map((line, j) => (
//                     <Typography key={j} sx={{ fontSize: '0.68rem', color: '#263238', fontWeight: 500, lineHeight: 1.6 }}>
//                       {line}
//                     </Typography>
//                   ))}
//                 </Box>
//               </Box>
//             ))}
//           </Box>
//         </Box>
//       ))}
//
//       {/* 단위 변환 참고표 */}
//       <Box sx={{ mb: 1 }}>
//         <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: '#607D8B', mb: 0.8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
//           단위 변환 참고표
//         </Typography>
//         <Box sx={{ border: '1px solid #CFD8DC', borderRadius: 1.5, overflow: 'hidden' }}>
//           <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 100px 100px', px: 1.5, py: 0.6, bgcolor: '#F0F4F8', borderBottom: '1px solid #CFD8DC' }}>
//             {['명령어', '레지스터', '실제값'].map(h => (
//               <Typography key={h} sx={{ fontSize: '0.63rem', fontWeight: 700, color: '#546E7A' }}>{h}</Typography>
//             ))}
//           </Box>
//           {UNIT_TABLE.map(({ cmd, reg, real }, i) => (
//             <Box key={cmd} sx={{
//               display: 'grid', gridTemplateColumns: '1fr 100px 100px',
//               px: 1.5, py: 0.7,
//               bgcolor: i % 2 === 0 ? '#fff' : '#F5F7FA',
//               borderBottom: i < UNIT_TABLE.length - 1 ? '1px solid #E3EAF0' : 'none',
//             }}>
//               <Typography sx={{ fontSize: '0.67rem', fontFamily: CMD_FONT, fontWeight: 600, color: '#4527A0' }}>{cmd}</Typography>
//               <Typography sx={{ fontSize: '0.67rem', fontFamily: CMD_FONT, fontWeight: 600, color: '#1565C0' }}>{reg}</Typography>
//               <Typography sx={{ fontSize: '0.67rem', color: '#37474F', fontWeight: 500 }}>{real}</Typography>
//             </Box>
//           ))}
//         </Box>
//       </Box>
//
//     </DialogContent>
//   </Dialog>
// );
//
// // ── 스크립트 편집기 패널 ───────────────────────────────────────────────────────
// interface ScriptPanelProps {
//   state: GripperState;
//   updateState: (patch: Partial<GripperState>) => void;
// }
//
// const ScriptPanel: React.FC<ScriptPanelProps> = ({ state, updateState }) => {
//   // ── 스크립트: localStorage에서 초기값 복원 ────────────────────────────────
//   const [scriptText, setScriptText] = useState<string>(() => loadScript());
//
//   const [logs,        setLogs]        = useState<string[]>([]);
//   const [running,     setRunning]     = useState(false);
//   const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
//   const [helpOpen,    setHelpOpen]    = useState(false);
//   const [suggestions, setSuggestions] = useState<typeof ALL_COMMANDS>([]);
//   const [suggestionIdx, setSuggestionIdx] = useState(0);
//   const [dropdownTop, setDropdownTop] = useState(4);
//
//   const stopSignalRef     = useRef({ stopped: false });
//   const logEndRef         = useRef<HTMLDivElement>(null);
//   const textareaRef       = useRef<HTMLTextAreaElement>(null);
//   const dropdownRef       = useRef<HTMLDivElement>(null);
//   const stateRef          = useRef(state);
//   const isKeyboardNavRef  = useRef(false);
//
//   useEffect(() => { stateRef.current = state; }, [state]);
//
//   useEffect(() => {
//     if (!dropdownRef.current || suggestions.length === 0) return;
//     const items = dropdownRef.current.querySelectorAll('[data-suggestion-item]');
//     const selected = items[suggestionIdx] as HTMLElement;
//     selected?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
//   }, [suggestionIdx, suggestions]);
//
//   const updateDropdownTop = useCallback(() => {
//     if (!textareaRef.current) return;
//     const ta          = textareaRef.current;
//     const cursor      = ta.selectionStart ?? 0;
//     const lineNum     = ta.value.slice(0, cursor).split('\n').length - 1;
//     const lineHeightPx = 12 * 1.6;
//     const paddingTop  = 8;
//     const top         = (lineNum + 1) * lineHeightPx + paddingTop - ta.scrollTop;
//     setDropdownTop(Math.max(4, top));
//   }, []);
//
//   const addLog = (msg: string) => {
//     const now = new Date();
//     const ts  = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
//     setLogs(prev => [...prev.slice(-199), `[${ts}] ${msg}`]);
//     setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
//   };
//
//   const getCurrentWord = useCallback((val: string, cursor: number) => {
//     const textBefore = val.slice(0, cursor);
//     const lineStart  = textBefore.lastIndexOf('\n') + 1;
//     return textBefore.slice(lineStart).trimStart();
//   }, []);
//
//   // ── textarea 변경: 자동저장 포함 ─────────────────────────────────────────
//   const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
//     const val = e.target.value;
//     setScriptText(val);
//     saveScript(val);          // ← localStorage 자동 저장
//     setParseErrors([]);
//
//     const cursor       = e.target.selectionStart ?? 0;
//     const word         = getCurrentWord(val, cursor);
//     const wordForMatch = word.replace(/\(.*$/, '');
//
//     if (wordForMatch.length >= 2 && !wordForMatch.includes(' ')) {
//       const matches = ALL_COMMANDS.filter(c => {
//         const cmdBase = c.cmd.replace(/\(.*$/, '').toLowerCase();
//         return cmdBase.startsWith(wordForMatch.toLowerCase()) && cmdBase !== wordForMatch.toLowerCase();
//       });
//       setSuggestions(matches);
//       setSuggestionIdx(0);
//       updateDropdownTop();
//     } else {
//       setSuggestions([]);
//     }
//   };
//
//   const applySuggestion = useCallback((item: typeof ALL_COMMANDS[0]) => {
//     if (!textareaRef.current) return;
//     const cursor     = textareaRef.current.selectionStart;
//     const val        = scriptText;
//     const textBefore = val.slice(0, cursor);
//     const lineStart  = textBefore.lastIndexOf('\n') + 1;
//     const lineText   = textBefore.slice(lineStart);
//     const indent     = lineText.match(/^(\s*)/)?.[1] ?? '';
//     const currentWord = lineText.trimStart();
//     const newVal     = val.slice(0, lineStart + indent.length) + item.cmd + val.slice(lineStart + indent.length + currentWord.length);
//
//     setScriptText(newVal);
//     saveScript(newVal);       // ← 자동완성 선택 시에도 저장
//     setSuggestions([]);
//
//     const insertedLen  = item.cmd.length;
//     const cursorOffset = item.cursorInside ? insertedLen - 1 : insertedLen;
//     const newCursor    = lineStart + indent.length + cursorOffset;
//     setTimeout(() => {
//       textareaRef.current?.setSelectionRange(newCursor, newCursor);
//       textareaRef.current?.focus();
//     }, 0);
//   }, [scriptText]);
//
//   const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
//     if (suggestions.length === 0) return;
//     if (e.key === 'Tab' || e.key === 'Enter') {
//       e.preventDefault();
//       applySuggestion(suggestions[suggestionIdx]);
//     } else if (e.key === 'Escape') {
//       setSuggestions([]);
//     } else if (e.key === 'ArrowDown') {
//       e.preventDefault();
//       isKeyboardNavRef.current = true;
//       setSuggestionIdx(i => Math.min(i + 1, suggestions.length - 1));
//     } else if (e.key === 'ArrowUp') {
//       e.preventDefault();
//       isKeyboardNavRef.current = true;
//       setSuggestionIdx(i => Math.max(i - 1, 0));
//     }
//   };
//
//   const handleRun = async () => {
//     const { commands, errors } = parseScript(scriptText);
//     setParseErrors(errors);
//     if (errors.length > 0)   { addLog(`❌ 파싱 오류 ${errors.length}건 — 실행 중단`); return; }
//     if (!state.connected)    { addLog('❌ 그리퍼가 연결되지 않았습니다'); return; }
//     setLogs([]);
//     setRunning(true);
//     stopSignalRef.current = { stopped: false };
//     addLog('▶ 스크립트를 시작합니다');
//     try {
//       await runScript(commands, {
//         updateState,
//         getState:   () => stateRef.current,
//         onLog:      addLog,
//         stopSignal: stopSignalRef.current,
//       });
//     } finally {
//       setRunning(false);
//     }
//   };
//
//   const handleStop = () => {
//     stopSignalRef.current.stopped = true;
//     setRunning(false);
//   };
//
//   // ── Clear: localStorage도 함께 비움 ──────────────────────────────────────
//   const handleClear = () => {
//     setScriptText('');
//     saveScript('');           // ← localStorage 초기화
//     setLogs([]);
//     setParseErrors([]);
//     setSuggestions([]);
//     textareaRef.current?.focus();
//   };
//
//   return (
//     <Paper elevation={0} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid #EEF2F7', borderRadius: 2, bgcolor: '#fff', boxShadow: 'none', p: '10px 12px', gap: 0.8 }}>
//
//       <ScriptHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
//
//       {/* 헤더 */}
//       <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
//         <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
//           <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: '#1A2A3A' }}>Script</Typography>
//           <Button size="small" onClick={() => setHelpOpen(true)}
//             sx={{ minWidth: 0, width: 20, height: 20, p: 0, borderRadius: '50%', bgcolor: '#EEF2F7', color: '#546E7A', fontSize: '0.65rem', fontWeight: 700, lineHeight: 1, '&:hover': { bgcolor: '#E3F2FD', color: '#1976D2' } }}>
//             ?
//           </Button>
//         </Box>
//         <Box sx={{ display: 'flex', gap: 0.6 }}>
//           <Button size="small" onClick={handleClear}
//             sx={{ fontSize: '0.65rem', py: 0.2, px: 1, minWidth: 0, color: '#B0BEC5', '&:hover': { color: '#E53935' } }}>
//             Clear
//           </Button>
//           {running ? (
//             <Button size="small" onClick={handleStop}
//               sx={{ fontSize: '0.68rem', py: 0.3, px: 1.2, minWidth: 0, bgcolor: '#FFEBEE', color: '#C62828', borderRadius: 1.5, '&:hover': { bgcolor: '#FFCDD2' } }}>
//               ■ Stop
//             </Button>
//           ) : (
//             <Button size="small" onClick={handleRun}
//               sx={{ fontSize: '0.68rem', py: 0.3, px: 1.2, minWidth: 0, bgcolor: '#E3F2FD', color: '#1976D2', borderRadius: 1.5, '&:hover': { bgcolor: '#BBDEFB' } }}>
//               ▶ Run
//             </Button>
//           )}
//         </Box>
//       </Box>
//
//       {/* 파싱 오류 */}
//       {parseErrors.length > 0 && (
//         <Box sx={{ bgcolor: '#FFF3E0', borderRadius: 1, p: '4px 8px', flexShrink: 0 }}>
//           {parseErrors.map((e, i) => (
//             <Typography key={i} sx={{ fontSize: '0.62rem', color: '#BF360C', fontFamily: CMD_FONT, fontWeight: 600 }}>
//               Line {e.line}: {e.message}
//             </Typography>
//           ))}
//         </Box>
//       )}
//
//       <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
//
//         {/* 텍스트 에디터 */}
//         <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
//           <textarea
//             ref={textareaRef}
//             value={scriptText}
//             onChange={handleScriptChange}
//             onKeyDown={handleKeyDown}
//             onBlur={() => setTimeout(() => setSuggestions([]), 150)}
//             spellCheck={false}
//             placeholder={'# 스크립트를 입력하세요\n# 예시:\nrq_activate_and_wait()\nrq_set_speed_norm(50)\nrq_set_force_norm(40)\nrq_open_and_wait()'}
//             style={{
//               width: '100%', height: '100%', resize: 'none',
//               border: '1px solid #EEF2F7', borderRadius: 6,
//               padding: '8px 10px', fontSize: 12,
//               fontFamily: CMD_FONT, lineHeight: 1.6,
//               color: '#1A2A3A', background: '#FAFBFC',
//               outline: 'none', boxSizing: 'border-box',
//             }}
//           />
//
//           {/* 자동완성 드롭다운 */}
//           {suggestions.length > 0 && (
//             <Box ref={dropdownRef}
//               onMouseMove={() => { isKeyboardNavRef.current = false; }}
//               sx={{
//                 position: 'absolute',
//                 top: dropdownTop, left: 4, right: 4,
//                 bgcolor: '#fff',
//                 border: '1px solid #90CAF9',
//                 borderRadius: 1.5,
//                 boxShadow: '0 4px 20px rgba(25,118,210,0.15)',
//                 zIndex: 100, maxHeight: 180, overflowY: 'auto',
//               }}>
//               {suggestions.map((s, i) => (
//                 <Box key={s.cmd} data-suggestion-item="true"
//                   onMouseEnter={() => { if (!isKeyboardNavRef.current) setSuggestionIdx(i); }}
//                   onMouseDown={() => applySuggestion(s)}
//                   sx={{
//                     px: 1.5, py: 0.85, cursor: 'pointer',
//                     bgcolor: i === suggestionIdx ? '#E3F2FD' : 'transparent',
//                     borderLeft: i === suggestionIdx ? '3px solid #1565C0' : '3px solid transparent',
//                     borderBottom: i < suggestions.length - 1 ? '1px solid #F0F4F8' : 'none',
//                     display: 'flex', justifyContent: 'space-between', alignItems: 'center',
//                   }}>
//                   <Typography sx={{ fontSize: '0.72rem', fontFamily: CMD_FONT, fontWeight: i === suggestionIdx ? 700 : 600, color: i === suggestionIdx ? '#1565C0' : '#4527A0' }}>
//                     {s.cmd}
//                   </Typography>
//                   <Typography sx={{ fontSize: '0.63rem', color: i === suggestionIdx ? '#1565C0' : '#546E7A', ml: 1, fontWeight: i === suggestionIdx ? 600 : 400 }}>
//                     {s.hint}
//                   </Typography>
//                 </Box>
//               ))}
//             </Box>
//           )}
//         </Box>
//
//         {/* 로그 */}
//         <Box sx={{ height: 80, overflowY: 'auto', bgcolor: '#F0F4F8', borderRadius: 1.5, p: '4px 8px', flexShrink: 0 }}>
//           {logs.length === 0 && (
//             <Typography sx={{ fontSize: '0.62rem', color: '#B0BEC5', mt: 0.5 }}>실행 로그가 여기에 표시됩니다.</Typography>
//           )}
//           {logs.map((l, i) => (
//             <Typography key={i} sx={{
//               fontSize: '0.62rem', fontFamily: CMD_FONT, lineHeight: 1.7,
//               color: l.includes('❌') ? '#E53935'
//                 : l.includes('✔')    ? '#388E3C'
//                 : l.includes('🚨')   ? '#C62828'
//                 :                      '#37474F',
//             }}>
//               {l}
//             </Typography>
//           ))}
//           <div ref={logEndRef} />
//         </Box>
//
//       </Box>
//     </Paper>
//   );
// };
// ─────────────────────────────────────────────────────────────────────────────
// ↑↑↑  스크립트 편집기 (ScriptPanel) 끝  ↑↑↑
// ─────────────────────────────────────────────────────────────────────────────
