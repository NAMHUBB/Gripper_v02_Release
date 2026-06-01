import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import { invoke } from '@tauri-apps/api/core';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import ControlTab from './components/ControlTab';
import InformationTab from './components/InformationTab';
import ModbusTab from './components/ModbusTab';
import { setRegCache } from './scriptRunner'; // ← 레지스터 쓰기 캐시

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GripperState {
  connected:       boolean;
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

// ── 레지스터 쓰기 헬퍼: invoke + 캐시 동시 업데이트 ──────────────────────────
const writeReg = async (address: number, value: number): Promise<void> => {
  setRegCache(address, value);                                    // ← 캐시 즉시 반영
  await invoke('modbus_write_single_register', { address, value });
};

// ── App ───────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const [tab,          setTab]          = useState(0);
  const [eStopAlert,   setEStopAlert]   = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [state,        setState]        = useState<GripperState>(INITIAL_STATE);
  const [isMoving,     setIsMoving]     = useState(false);
  const [chartData,    setChartData]    = useState<DataPoint[]>(() =>
    Array.from({ length: MAX_PTS }, (_, i) => ({
      time: i * 0.2, echo: 0, actual: 0, current: 0,
      adc0: 0, adc1: 0, adc2: 0, adc3: 0, adc4: 0, adc5: 0,
    }))
  );

  const elapsedRef   = useRef(0);
  const sharedAdcRef = useRef<number[]>([0, 0, 0, 0, 0, 0]);

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
    if (!state.connected) return;
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
  }, [state.connected]);

  // ── 2. Activate → 레지스터 1000 ─────────────────────────────────────────
  // writeReg 사용 → invoke + 캐시 동시 업데이트
  useEffect(() => {
    if (!state.connected) return;
    const value = state.activated ? 1 : 0;
    writeReg(1000, value)
      .catch(err => console.error('Activate write error:', err));
  }, [state.connected, state.activated]);

  // ── 3. 위치·속도·힘 → rPOS 트리거 ──────────────────────────────────────
  useEffect(() => {
    if (!state.connected || !state.goToPosition || !state.activated) return;

    const write = async () => {
      const posReg   = posToReg(state.positionRequest);
      const speedReg = speedToReg(state.speed);
      const forceReg = forceToReg(state.force);

      await writeReg(1003, posReg);        // 위치
      await writeReg(1004, speedReg);      // 속도
      await writeReg(1005, forceReg);      // 힘
      await writeReg(1006, ACC_DEFAULT);   // 가속도
      await writeReg(1000, 17);            // rPOS ON  (010001)
      await writeReg(1000, 1);             // rPOS OFF (000001)
    };

    write().catch(err => console.error('Setpoint write error:', err));
  }, [
    state.connected, state.goToPosition, state.activated,
    state.positionRequest, state.speed, state.force,
  ]);

  // ── 핸들러 ───────────────────────────────────────────────────────────────
  const updateState = useCallback(
    (patch: Partial<GripperState>) => setState(s => ({ ...s, ...patch })), []
  );

  const handleConnect = useCallback(async () => {
    if (state.connected) {
      try { await invoke('modbus_disconnect'); } catch {}
      setState(s => ({ ...s, connected: false, activated: false, goToPosition: false, eStop: false }));
      setIsMoving(false);
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
        setState(s => ({ ...s, connected: true, eStop: false }));
        setConnectError(null);
      } catch (err) {
        setConnectError(typeof err === 'string' ? err : 'Connection failed');
      }
    }
  }, [state.connected, state.port, state.baudRate, state.slaveId, state.parity, state.stopBit]);

  // E-Stop: 1000 = 33 (rSTP=1)
  const handleEStop = useCallback(async () => {
    try { await writeReg(1000, 33); } catch {}
    setState(s => ({ ...s, eStop: true, goToPosition: false, currentActual: 0 }));
    setIsMoving(false);
    setEStopAlert(true);
  }, []);

  // E-Stop 해제: 1000 = 1 (rACT=1)
  const handleResumeFromEStop = useCallback(async () => {
    try { await writeReg(1000, 1); } catch {}
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