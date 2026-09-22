import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import Header from './components/Header';
import StatusBar from './components/StatusBar';
import DashboardTab from './components/DashboardTab';
import DeviceTab from './components/DeviceTab';
import { setRegCache, getRegCache } from './regCache';          // ← 레지스터 쓰기 캐시
import { busInvoke, sleep } from './modbusBus';                  // ← Modbus 호출 직렬화
import { DemoSimulator, demoInputRegisters, DemoCommand } from './demoSource';
import { REG, ACTION_BIT, STATUS_BIT, MONITOR_BLOCK, FW, ADC_ADDRS, ADC_COUNT } from './registers';
import { posToReg, regToPos, speedToReg, forceToReg, POLL_MS, CHART_TICK_MS, PERIOD_SEC } from './constants';
import { C } from './theme';
// import { setScriptDemoMode } from './scriptRunner'; // ← 스크립트 기능 비활성화 (필요 시 복원)

// ── Types ─────────────────────────────────────────────────────────────────────
export interface GripperState {
  connected:       boolean;
  /** 장비 없이 시뮬레이션 데이터로 동작 중인지 여부 */
  demo:            boolean;
  /** 연결 시도 중 (포트 열기 대기) */
  connecting:      boolean;
  // 통신 설정 — 펌웨어는 8N1 고정
  port:            string;
  baudRate:        number;
  slaveId:         number;
  // 지령 (UI 0~255)
  activated:       boolean;
  goToPosition:    boolean;
  positionRequest: number;
  speed:           number;
  force:           number;
  // 읽기값
  positionEcho:    number;   // 0~255 (REG_POSITION_ECHO → 변환)
  positionActual:  number;   // 0~255 (REG_CURR_POSITION → 변환)
  torqueActual:    number;   // 0.1 %TR (REG_CURR_TORQUE)
  adc:             number[]; // mV · ADC0 ~ ADC5 (REG 2010 ~ 2015)
  actionStatus:    number;   // REG_ACTION_STATUS raw (gACT/gERR/gBRK/gRUN)
  faultCode:       number;   // REG_FAULT_STATUS raw (모터 에러코드)
  objectDetected:  boolean;  // 데모 전용 (펌웨어 미제공)
  eStop:           boolean;
}

export interface DataPoint {
  time:   number;
  echo:   number;   // 0~255
  actual: number;   // 0~255
  torque: number;   // 0.1 %TR
  adc:    number[]; // mV · ADC0 ~ ADC5
}

/** modbus_read_monitor_registers 응답 */
interface MonitorData {
  inputs:   number[];          // 2000 ~ 2015
  holdings: number[] | null;   // 1000 ~ 1004
}

/** 차트 샘플 상한 — 데이터로거처럼 t = 0 부터 누적하되, 메모리 보호용으로 2 시간에서 잘라낸다 */
const MAX_PTS = Math.round((2 * 3600 * 1000) / CHART_TICK_MS);
/** 연속 폴링 실패 시 연결 해제 판단 횟수 */
const MAX_POLL_FAILURES = 3;

/** ADC 전 채널 0 */
const ZERO_ADC: number[] = Array(ADC_COUNT).fill(0);

const INITIAL_STATE: GripperState = {
  connected:       false,
  demo:            false,
  connecting:      false,
  port:            '',
  baudRate:        FW.BAUD_RATE,
  slaveId:         FW.SLAVE_ID,
  activated:       false,
  goToPosition:    false,
  positionRequest: 0,
  speed:           128,
  force:           77,
  positionEcho:    0,
  positionActual:  0,
  torqueActual:    0,
  adc:             ZERO_ADC,
  actionStatus:    0,
  faultCode:       0,
  objectDetected:  false,
  eStop:           false,
};

// ── 차트 버퍼 ────────────────────────────────────────────────────────────────
// dmt-gripper-controller 의 useMonitoringData 와 동일한 방식:
//  · 앱이 켜진 순간 t = 0 에 0 샘플 하나로 시작하고, 50 ms 클록이 폴링과 무관하게 계속 돈다.
//  · 연결 전/해제 후에는 두 선이 0 기준선을 유지하고, 연결되면 마지막 읽기값을 그대로 이어 붙인다.
//  · 샘플은 버리지 않는다 — 시간축이 자라고 눈금 간격이 자동 조정된다 (메모리 상한만 둠).
const ZERO_SAMPLE: DataPoint = { time: 0, echo: 0, actual: 0, torque: 0, adc: ZERO_ADC };
const makeBlankChart = (): DataPoint[] => [ZERO_SAMPLE];
const appendSample = (prev: DataPoint[], pt: DataPoint): DataPoint[] =>
  prev.length >= MAX_PTS ? [...prev.slice(1), pt] : [...prev, pt];

// ── 레지스터 쓰기 헬퍼: invoke + 캐시 동시 업데이트 ──────────────────────────
// demo=true 이면 실제 시리얼 통신 없이 캐시만 갱신한다.
const writeReg = async (address: number, value: number, demo = false): Promise<void> => {
  setRegCache(address, value);                                    // ← 캐시 즉시 반영
  if (demo) return;
  await busInvoke('modbus_write_single_register', { address, value });
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ── App ───────────────────────────────────────────────────────────────────────
const App: React.FC = () => {
  const [tab,          setTab]          = useState(0);
  const [eStopAlert,   setEStopAlert]   = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [demoNotice,   setDemoNotice]   = useState<string | null>(null);
  const [state,        setState]        = useState<GripperState>(INITIAL_STATE);
  const [chartData,    setChartData]    = useState<DataPoint[]>(makeBlankChart);
  const [ports,        setPorts]        = useState<string[]>([]);

  /** Modbus 모니터에 표시할 레지스터 값 (라이브 폴링 또는 데모 시뮬레이션) */
  const [regValues,    setRegValues]    = useState<Record<number, number>>({});
  const [regReadError, setRegReadError] = useState<string | null>(null);

  const demoSimRef = useRef(new DemoSimulator());
  const stateRef   = useRef(state);

  useEffect(() => { stateRef.current = state; }, [state]);
  // useEffect(() => { setScriptDemoMode(state.demo); }, [state.demo]); // ← 스크립트 비활성화

  /** 펌웨어 상태 비트에서 파생 */
  const isMoving = (state.actionStatus & STATUS_BIT.gRUN) !== 0;

  // ── 0. 시리얼 포트 목록 ────────────────────────────────────────────────────
  const refreshPorts = useCallback(async () => {
    try {
      const list = await busInvoke<string[]>('modbus_list_serial_ports');
      setPorts(list);
      setState(s => (s.port === '' && list.length > 0 ? { ...s, port: list[0] } : s));
    } catch (err) {
      // 브라우저 미리보기(Tauri 런타임 없음) 등에서는 목록을 얻을 수 없다
      console.warn('Serial port list error:', err);
      setPorts([]);
    }
  }, []);

  useEffect(() => { refreshPorts(); }, [refreshPorts]);

  // ── 1. 실시간 폴링 — 모니터 블록 한 번에 읽기 ───────────────────────────
  // 입력 2000~2015(16) → 프레임 간격 → 홀딩 1000~1004(5). 한 사이클이 끝난 뒤에만
  // 다음 사이클을 예약해 요청이 겹치지 않도록 한다. (Rust 쪽 타임아웃 800ms)
  useEffect(() => {
    if (!state.connected || state.demo) return;

    let cancelled = false;
    let failures  = 0;

    const applySample = (inputs: number[], holdings: number[] | null) => {
      const status   = inputs[REG.ACTION_STATUS - MONITOR_BLOCK.inputAddress] ?? 0;
      const fault    = inputs[REG.FAULT_STATUS  - MONITOR_BLOCK.inputAddress] ?? 0;
      const echoReg  = inputs[REG.POSITION_ECHO - MONITOR_BLOCK.inputAddress] ?? 0;
      const posReg   = inputs[REG.CURR_POSITION - MONITOR_BLOCK.inputAddress] ?? 0;
      const torque   = inputs[REG.CURR_TORQUE   - MONITOR_BLOCK.inputAddress] ?? 0;
      const adc      = ADC_ADDRS.map(addr => inputs[addr - MONITOR_BLOCK.inputAddress] ?? 0);

      const next: Record<number, number> = {
        [REG.ACTION_STATUS]: status,
        [REG.FAULT_STATUS]:  fault,
        [REG.POSITION_ECHO]: echoReg,
        [REG.CURR_POSITION]: posReg,
        [REG.CURR_TORQUE]:   torque,
        ...Object.fromEntries(ADC_ADDRS.map((addr, ch) => [addr, adc[ch]])),
      };
      if (holdings) {
        const base = MONITOR_BLOCK.holdingAddress;
        for (const addr of [REG.ACTION_REQUEST, REG.POSITION_REQUEST, REG.SPEED_REQUEST, REG.FORCE_REQUEST, REG.ACC_REQUEST]) {
          next[addr] = holdings[addr - base] ?? 0;
        }
      }
      setRegValues(next);

      // 차트는 별도 클록(1-c)이 stateRef 에서 샘플한다
      setState(prev => ({
        ...prev,
        positionEcho: regToPos(echoReg), positionActual: regToPos(posReg),
        torqueActual: torque, adc,
        actionStatus: status, faultCode: fault,
      }));
    };

    const loop = async () => {
      while (!cancelled) {
        const started = performance.now();
        try {
          const data = await busInvoke<MonitorData>('modbus_read_monitor_registers', MONITOR_BLOCK);
          if (cancelled) break;
          failures = 0;
          applySample(data.inputs, data.holdings);
          setRegReadError(null);
        } catch (err) {
          if (cancelled) break;
          failures += 1;
          const msg = errText(err);
          console.error('Poll error:', msg);
          setRegReadError(msg);
          if (failures >= MAX_POLL_FAILURES) {
            // 진단 메시지(TX/RX 바이트)는 Rust 쪽 에러 문자열에 들어 있다
            setConnectError(`통신 끊김 — ${msg}`);
            try { await busInvoke('modbus_disconnect'); } catch { /* ignore */ }
            setState(s => ({ ...s, connected: false, activated: false, goToPosition: false, actionStatus: 0 }));
            break;
          }
        }
        const elapsed = performance.now() - started;
        await sleep(Math.max(0, POLL_MS - elapsed));
      }
    };

    loop();
    return () => { cancelled = true; };
  }, [state.connected, state.demo]);

  // ── 1-c. 차트 클록 (50 ms · 항상 동작) ────────────────────────────────────
  // 폴링 결과가 갱신되어도 타이머를 재시작하지 않는다 — 클록은 자기 리듬을 지키고
  // 마지막 읽기값(stateRef)만 집어 간다. 연결이 없으면 0 을 이어 붙여 기준선을 유지한다.
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      const live = s.connected;
      setChartData(prev => appendSample(prev, {
        time:   prev.length * PERIOD_SEC,
        echo:   live ? s.positionEcho   : 0,
        actual: live ? s.positionActual : 0,
        torque: live ? s.torqueActual   : 0,
        adc:    live ? s.adc            : ZERO_ADC,
      }));
    }, CHART_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // ── 1-b. 데모 시뮬레이션 ─────────────────────────────────────────────────
  // 장비가 없을 때 사인파 기반 시뮬레이션 데이터로 동일한 차트/모니터를 채운다.
  useEffect(() => {
    if (!state.connected || !state.demo) return;

    const DT = POLL_MS / 1000;
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
      const inputs = demoInputRegisters(sample, cmd);
      // 입력 레지스터는 시뮬레이션 값, 홀딩 레지스터는 쓰기 캐시를 그대로 반영
      setRegValues({ ...inputs, ...getRegCache() });

      setState(prev => ({
        ...prev,
        positionEcho:   sample.positionEcho,
        positionActual: sample.positionActual,
        torqueActual:   sample.torqueActual,
        adc:            sample.adc,
        actionStatus:   inputs[REG.ACTION_STATUS],
        faultCode:      0,
        objectDetected: sample.objectDetected,
      }));

    }, DT * 1000);

    return () => clearInterval(iv);
  }, [state.connected, state.demo]);

  // ── 2. Activate → 레지스터 1000 (rACT) ───────────────────────────────────
  useEffect(() => {
    if (!state.connected) return;
    const value = state.activated ? ACTION_BIT.rACT : 0;
    writeReg(REG.ACTION_REQUEST, value, state.demo)
      .catch(err => console.error('Activate write error:', err));
  }, [state.connected, state.demo, state.activated]);

  // ── 3. 위치·속도·힘 → rPOS 상승 엣지로 MoveJ 트리거 ─────────────────────
  useEffect(() => {
    if (!state.connected || !state.goToPosition || !state.activated) return;

    const write = async () => {
      const d = state.demo;
      await writeReg(REG.POSITION_REQUEST, posToReg(state.positionRequest), d);   // 0.1 deg
      await writeReg(REG.SPEED_REQUEST,    speedToReg(state.speed),          d);   // deg/s (≥1)
      await writeReg(REG.FORCE_REQUEST,    forceToReg(state.force),          d);   // 0.1 %TR
      await writeReg(REG.ACC_REQUEST,      FW.ACC_DEFAULT,                   d);   // deg/s²
      await writeReg(REG.ACTION_REQUEST,   ACTION_BIT.rACT | ACTION_BIT.rPOS, d);  // rPOS ON  (010001 = 17)
      await writeReg(REG.ACTION_REQUEST,   ACTION_BIT.rACT,                   d);  // rPOS OFF (000001 = 1)
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

  // 차트 버퍼는 데이터로거처럼 연결/해제와 무관하게 계속 누적한다 (리셋하지 않음)
  const resetReadings = () => {
    setRegValues({});
    setRegReadError(null);
  };

  /** 장비 없이 데모(시뮬레이션) 모드로 진입 */
  const startDemo = useCallback((reason: string) => {
    demoSimRef.current.reset();
    resetReadings();

    // 홀딩 레지스터 초기값을 캐시에 심어 Modbus 모니터에도 값이 보이도록 한다.
    const s = stateRef.current;
    setRegCache(REG.ACTION_REQUEST,   ACTION_BIT.rACT);
    setRegCache(REG.POSITION_REQUEST, posToReg(s.positionRequest));
    setRegCache(REG.SPEED_REQUEST,    speedToReg(s.speed));
    setRegCache(REG.FORCE_REQUEST,    forceToReg(s.force));
    setRegCache(REG.ACC_REQUEST,      FW.ACC_DEFAULT);

    setState(prev => ({
      ...prev,
      connected: true, demo: true, connecting: false, eStop: false,
      activated: true, goToPosition: false,
      positionEcho: 0, positionActual: 0, torqueActual: 0, adc: ZERO_ADC,
      actionStatus: STATUS_BIT.gACT | STATUS_BIT.gBRK, faultCode: 0,
      objectDetected: false,
    }));
    setDemoNotice(reason);
  }, []);

  const handleConnect = useCallback(async () => {
    if (state.connected) {
      if (!state.demo) { try { await busInvoke('modbus_disconnect'); } catch { /* ignore */ } }
      setState(s => ({
        ...s, connected: false, demo: false, connecting: false,
        activated: false, goToPosition: false, eStop: false,
        actionStatus: 0, faultCode: 0, objectDetected: false,
      }));
      resetReadings();
      return;
    }

    setState(s => ({ ...s, connecting: true }));
    try {
      await busInvoke('modbus_connect', {
        config: { comPort: state.port, baudRate: state.baudRate, slaveId: state.slaveId },
      });
      resetReadings();
      setState(s => ({ ...s, connected: true, demo: false, connecting: false, eStop: false }));
      setConnectError(null);
    } catch (err) {
      // 장비/포트가 없으면 데모 모드로 대체하여 시뮬레이션 그래프를 표시한다.
      const msg = errText(err);
      console.warn('Connection failed → demo mode:', msg);
      startDemo(msg);
    }
  }, [state.connected, state.demo, state.port, state.baudRate, state.slaveId, startDemo]);

  // E-Stop: 1000 = rACT | rSTP (33) → 펌웨어 StopJ
  const handleEStop = useCallback(async () => {
    try { await writeReg(REG.ACTION_REQUEST, ACTION_BIT.rACT | ACTION_BIT.rSTP, stateRef.current.demo); } catch { /* ignore */ }
    setState(s => ({ ...s, eStop: true, goToPosition: false }));
    setEStopAlert(true);
  }, []);

  // E-Stop 해제: 1000 = rACT (1)
  const handleResumeFromEStop = useCallback(async () => {
    try { await writeReg(REG.ACTION_REQUEST, ACTION_BIT.rACT, stateRef.current.demo); } catch { /* ignore */ }
    setState(s => ({ ...s, eStop: false }));
  }, []);

  // Fault Reset: rRST 상승 엣지 (rACT 유지) → 펌웨어가 gERR/에러코드 래치 해제
  const handleFaultReset = useCallback(async () => {
    const s    = stateRef.current;
    const base = s.activated ? ACTION_BIT.rACT : 0;
    try {
      await writeReg(REG.ACTION_REQUEST, base | ACTION_BIT.rRST, s.demo);
      await writeReg(REG.ACTION_REQUEST, base, s.demo);
    } catch (err) {
      console.error('Fault reset write error:', err);
    }
  }, []);

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: C.app, overflow: 'hidden' }}>

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
          <DashboardTab
            state={state}
            updateState={updateState}
            chartData={chartData}
            isMoving={isMoving}
            regValues={regValues}
            regReadError={regReadError}
            onFaultReset={handleFaultReset}
          />
        )}
        {tab === 1 && (
          <DeviceTab
            state={state}
            updateState={updateState}
            ports={ports}
            onRefreshPorts={refreshPorts}
          />
        )}
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
        open={!!demoNotice} autoHideDuration={6000}
        onClose={() => setDemoNotice(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="info" onClose={() => setDemoNotice(null)} sx={{ fontWeight: 600, maxWidth: 720 }}>
          장비에 연결할 수 없어 DEMO 모드로 실행합니다 — 시뮬레이션 데이터가 표시됩니다.
          {demoNotice && (
            <Box component="span" sx={{ display: 'block', fontWeight: 400, fontSize: '0.78rem', mt: 0.4, fontFamily: C.mono, wordBreak: 'break-all' }}>
              {demoNotice}
            </Box>
          )}
        </Alert>
      </Snackbar>

      <Snackbar
        open={!!connectError} autoHideDuration={8000}
        onClose={() => setConnectError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="warning" onClose={() => setConnectError(null)} sx={{ fontWeight: 600, maxWidth: 720, wordBreak: 'break-all' }}>
          {connectError}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default App;
