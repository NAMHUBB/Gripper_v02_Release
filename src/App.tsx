import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import ControlTab from './components/ControlTab';
import InformationTab from './components/InformationTab';
import ModbusTab from './components/ModbusTab';
import { setRegCache, setScriptDemoMode } from './scriptRunner'; // ← 레지스터 쓰기 캐시
import { DemoSimulator, demoInputRegisters, DemoCommand } from './demoSource';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GripperState {
  connected:       boolean;
  /** 장비 없이 시뮬레이션 데이터로 동작 중인지 여부 */
  demo:            boolean;
  port:            string;
  baudRate:        number;
  stopBit:         '1' | '2';
  parity:          'None' | 'Even' | 'Odd';
  slaveId:         number;
  termResistor:    boolean;
  activated:       boolean;
  goToPosition:    boolean;
  positionRequest: number;
  speed:           number;
  force:           number;
  positionEcho:    number;
  positionActual:  number;
  currentActual:   number;
  objectDetected:  boolean;
  fault:           string | null;
  eStop:           boolean;
}

export interface DataPoint {
  time:    number;
  echo:    number;
  actual:  number;
  current: number;
  adc0: number; adc1: number; adc2: number;
  adc3: number; adc4: number; adc5: number;
}

interface PlotData {
  positionEcho:   number;
  positionActual: number;
  forceActual:    number;
}

const MAX_PTS     = 255;
const ACC_DEFAULT = 50;

const INITIAL_STATE: GripperState = {
  connected:       false,
  demo:            false,
  port:            '',
  baudRate:        115200,
  stopBit:         '1',
  parity:          'None',
  slaveId:         1,
  termResistor:    false,
  activated:       false,
  goToPosition:    false,
  positionRequest: 0,
  speed:           128,
  force:           77,
  positionEcho:    0,
  positionActual:  0,
  currentActual:   0,
  objectDetected:  false,
  fault:           null,
  eStop:           false,
};

// ── 단위 변환 ─────────────────────────────────────────────────────────────────
const posToReg   = (v: number) => Math.round((v / 255) * -2000);
const speedToReg = (v: number) => Math.max(1, Math.round((v / 255) * 360));
const forceToReg = (v: number) => Math.round((v / 255) * 1000);

// ── 빈 차트 버퍼 ─────────────────────────────────────────────────────────────
const makeBlankChart = (): DataPoint[] =>
  Array.from({ length: MAX_PTS }, (_, i) => ({
    time: i * 0.2, echo: 0, actual: 0, current: 0,
    adc0: 0, adc1: 0, adc2: 0, adc3: 0, adc4: 0, adc5: 0,
  }));

// ── 레지스터 쓰기 헬퍼: invoke + 캐시 동시 업데이트 ──────────────────────────
// demo=true 이면 실제 시리얼 통신 없이 캐시만 갱신한다.
const writeReg = async (address: number, value: number, demo = false): Promise<void> => {
  setRegCache(address, value);                                    // ← 캐시 즉시 반영
  if (demo) return;
  await invoke('modbus_write_single_register', { address, value });
};

// ── App ───────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const [tab,          setTab]          = useState(0);
  const [eStopAlert,   setEStopAlert]   = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [state,        setState]        = useState<GripperState>(INITIAL_STATE);
  const [isMoving,     setIsMoving]     = useState(false);
  const [demoNotice,   setDemoNotice]   = useState(false);
  const [demoRegs,     setDemoRegs]     = useState<Record<number, number>>({});
  const [chartData,    setChartData]    = useState<DataPoint[]>(makeBlankChart);

  const elapsedRef   = useRef(0);
  const sharedAdcRef = useRef<number[]>([0, 0, 0, 0, 0, 0]);
  const demoSimRef   = useRef(new DemoSimulator());
  const stateRef     = useRef(state);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { setScriptDemoMode(state.demo); }, [state.demo]);

  const handleSharedAdcUpdate = useCallback((adc: number[]) => {
    sharedAdcRef.current = [
      adc[0] ?? 0, adc[1] ?? 0, adc[2] ?? 0,
      adc[3] ?? 0, adc[4] ?? 0, adc[5] ?? 0,
    ];
  }, []);

  // ── 0. 앱 시작: COM 포트 자동 감지 ─────────────────────────────────────────
  useEffect(() => {
    invoke<string[]>('modbus_list_serial_ports')
      .then(ports => { if (ports.length > 0) setState(s => ({ ...s, port: ports[0] })); })
      .catch(err => console.error('Serial port list error:', err));
  }, []);

  // ── 1. 실시간 폴링 (200ms) ───────────────────────────────────────────────
  useEffect(() => {
    if (!state.connected || state.demo) return;
    const iv = setInterval(async () => {
      try {
        const data = await invoke<PlotData>('modbus_read_plot_registers');
        const adc  = sharedAdcRef.current;
        elapsedRef.current += 0.2;
        const t = elapsedRef.current;
        setState(prev => {
          setIsMoving(Math.abs(data.positionActual - prev.positionActual) > 1);
          return {
            ...prev,
            positionEcho:   data.positionEcho,
            positionActual: data.positionActual,
            currentActual:  data.forceActual,
          };
        });
        setChartData(prev => [
          ...prev.slice(-(MAX_PTS - 1)),
          {
            time: t,
            echo: data.positionEcho, actual: data.positionActual, current: data.forceActual,
            adc0: adc[0], adc1: adc[1], adc2: adc[2],
            adc3: adc[3], adc4: adc[4], adc5: adc[5],
          },
        ]);
      } catch (err) {
        console.error('Poll error:', err);
        setState(s => ({ ...s, connected: false, activated: false, goToPosition: false }));
        setIsMoving(false);
      }
    }, 200);
    return () => clearInterval(iv);
  }, [state.connected, state.demo]);

  // ── 1-b. 데모 시뮬레이션 (200ms) ─────────────────────────────────────────
  // 장비가 없을 때 사인파 기반 시뮬레이션 데이터로 동일한 차트를 채운다.
  useEffect(() => {
    if (!state.connected || !state.demo) return;

    const DT = 0.2;
    const iv = setInterval(() => {
      const s: GripperState = stateRef.current;
      const cmd: DemoCommand = {
        activated:       s.activated,
        goToPosition:    s.goToPosition,
        eStop:           s.eStop,
        positionRequest: s.positionRequest,
        speed:           s.speed,
        force:           s.force,
      };

      const sample = demoSimRef.current.step(DT, cmd);
      sharedAdcRef.current = sample.adc;
      setDemoRegs(demoInputRegisters(sample, cmd));

      elapsedRef.current += DT;
      const t = elapsedRef.current;

      setState(prev => {
        setIsMoving(Math.abs(sample.positionActual - prev.positionActual) > 1);
        return {
          ...prev,
          positionEcho:   sample.positionEcho,
          positionActual: sample.positionActual,
          currentActual:  sample.currentActual,
          objectDetected: sample.objectDetected,
        };
      });

      setChartData(prev => [
        ...prev.slice(-(MAX_PTS - 1)),
        {
          time: t,
          echo: sample.positionEcho, actual: sample.positionActual, current: sample.currentActual,
          adc0: sample.adc[0], adc1: sample.adc[1], adc2: sample.adc[2],
          adc3: sample.adc[3], adc4: sample.adc[4], adc5: sample.adc[5],
        },
      ]);
    }, DT * 1000);

    return () => clearInterval(iv);
  }, [state.connected, state.demo]);

  // ── 2. Activate → 레지스터 1000 ─────────────────────────────────────────
  // writeReg 사용 → invoke + 캐시 동시 업데이트
  useEffect(() => {
    if (!state.connected) return;
    const value = state.activated ? 1 : 0;
    writeReg(1000, value, state.demo)
      .catch(err => console.error('Activate write error:', err));
  }, [state.connected, state.demo, state.activated]);

  // ── 3. 위치·속도·힘 → rPOS 트리거 ──────────────────────────────────────
  useEffect(() => {
    if (!state.connected || !state.goToPosition || !state.activated) return;

    const write = async () => {
      const posReg   = posToReg(state.positionRequest);
      const speedReg = speedToReg(state.speed);
      const forceReg = forceToReg(state.force);

      const d = state.demo;
      await writeReg(1003, posReg,      d);   // 위치
      await writeReg(1004, speedReg,    d);   // 속도
      await writeReg(1005, forceReg,    d);   // 힘
      await writeReg(1006, ACC_DEFAULT, d);   // 가속도
      await writeReg(1000, 17,          d);   // rPOS ON  (010001)
      await writeReg(1000, 1,           d);   // rPOS OFF (000001)
    };

    write().catch(err => console.error('Setpoint write error:', err));
  }, [
    state.connected, state.demo, state.goToPosition, state.activated,
    state.positionRequest, state.speed, state.force,
  ]);

  // ── 핸들러 ───────────────────────────────────────────────────────────────
  const updateState = useCallback(
    (patch: Partial<GripperState>) => setState(s => ({ ...s, ...patch })), []
  );

  /** 장비 없이 데모(시뮬레이션) 모드로 진입 */
  const startDemo = useCallback(() => {
    demoSimRef.current.reset();
    elapsedRef.current = 0;
    sharedAdcRef.current = [0, 0, 0, 0, 0, 0];
    setChartData(makeBlankChart());

    // 홀딩 레지스터 초기값을 캐시에 심어 Modbus 모니터에도 값이 보이도록 한다.
    const s = stateRef.current;
    setRegCache(1000, 1);
    setRegCache(1003, posToReg(s.positionRequest));
    setRegCache(1004, speedToReg(s.speed));
    setRegCache(1005, forceToReg(s.force));
    setRegCache(1006, ACC_DEFAULT);

    setState(prev => ({
      ...prev,
      connected: true, demo: true, eStop: false,
      activated: true, goToPosition: false,
      positionEcho: 0, positionActual: 0, currentActual: 0,
      objectDetected: false, fault: null,
    }));
    setDemoNotice(true);
  }, []);

  const handleConnect = useCallback(async () => {
    if (state.connected) {
      if (!state.demo) { try { await invoke('modbus_disconnect'); } catch {} }
      setState(s => ({ ...s, connected: false, demo: false, activated: false, goToPosition: false, eStop: false }));
      setIsMoving(false);
      setDemoRegs({});
      elapsedRef.current = 0;
    } else {
      try {
        await invoke('modbus_connect', {
          config: {
            comPort:  state.port,
            baudRate: state.baudRate,
            slaveId:  state.slaveId,
            parity:   state.parity,
            stopBits: Number(state.stopBit),
          },
        });
        elapsedRef.current = 0;
        setChartData(makeBlankChart());
        setState(s => ({ ...s, connected: true, demo: false, eStop: false }));
        setConnectError(null);
      } catch (err) {
        // 장비/포트가 없으면 데모 모드로 대체하여 시뮬레이션 그래프를 표시한다.
        console.warn('Connection failed → demo mode:', err);
        startDemo();
      }
    }
  }, [state.connected, state.demo, state.port, state.baudRate, state.slaveId, state.parity, state.stopBit, startDemo]);

  // E-Stop: 1000 = 33 (rSTP=1)
  const handleEStop = useCallback(async () => {
    try { await writeReg(1000, 33, stateRef.current.demo); } catch {}
    setState(s => ({ ...s, eStop: true, goToPosition: false, currentActual: 0 }));
    setIsMoving(false);
    setEStopAlert(true);
  }, []);

  // E-Stop 해제: 1000 = 1 (rACT=1)
  const handleResumeFromEStop = useCallback(async () => {
    try { await writeReg(1000, 1, stateRef.current.demo); } catch {}
    setState(s => ({ ...s, eStop: false }));
  }, []);

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#F0F4F8', overflow: 'hidden' }}>

      <Header
        tab={tab}
        setTab={setTab}
        state={state}
        onConnect={handleConnect}
        onEStop={handleEStop}
        onResumeEStop={handleResumeFromEStop}
      />

      <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {tab === 0 && (
          <ControlTab
            state={state}
            updateState={updateState}
            chartData={chartData}
            isMoving={isMoving}
          />
        )}
        {/* ModbusTab: 항상 마운트 유지 (폴링 끊김 방지) */}
        <Box sx={{ display: tab === 1 ? 'flex' : 'none', height: '100%', flexDirection: 'column' }}>
          <ModbusTab
            state={state}
            updateState={updateState}
            onAdcValuesUpdate={handleSharedAdcUpdate}
            demoRegisters={demoRegs}
          />
        </Box>
        {tab === 2 && <InformationTab />}
      </Box>

      <StatusBar state={state} isMoving={isMoving} />

      <Snackbar
        open={eStopAlert} autoHideDuration={3000}
        onClose={() => setEStopAlert(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setEStopAlert(false)} sx={{ fontWeight: 600 }}>
          Emergency Stop activated — All motion halted.
        </Alert>
      </Snackbar>

      <Snackbar
        open={demoNotice} autoHideDuration={4000}
        onClose={() => setDemoNotice(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setDemoNotice(false)} sx={{ fontWeight: 600 }}>
          장비를 찾을 수 없어 DEMO 모드로 실행합니다 — 시뮬레이션 데이터가 표시됩니다.
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!connectError} autoHideDuration={4000}
        onClose={() => setConnectError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setConnectError(null)} sx={{ fontWeight: 600 }}>
          {connectError}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default App;