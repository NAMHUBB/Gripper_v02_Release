import { invoke } from '@tauri-apps/api/core';
import { GripperState } from './App';

// ── 레지스터 쓰기 캐시 ─────────────────────────────────────────────────────────
// 스크립트가 마지막으로 쓴 Holding Register 값을 저장.
// ModbusTab이 하드웨어 에코 없이도 최신 값을 표시할 수 있도록 함.
const _regCache: Record<number, number> = {};

/** 마지막으로 쓴 레지스터 캐시 반환 */
export const getRegCache = (): Readonly<Record<number, number>> => ({ ..._regCache });

/** 외부(App.tsx 등)에서도 캐시를 업데이트할 때 사용 */
export const setRegCache = (addr: number, val: number): void => {
  _regCache[addr] = val;
};

// ╔══════════════════════════════════════════════════════════════════╗
// ... (사용설명서 주석 동일)
// ╚══════════════════════════════════════════════════════════════════╝

// ── 스크립트 영속성 ────────────────────────────────────────────────────────────
const SCRIPT_STORAGE_KEY = 'gripper_script_content';
export const saveScript = (text: string): void => {
  try { localStorage.setItem(SCRIPT_STORAGE_KEY, text); } catch { /* ignore */ }
};
export const loadScript = (): string => {
  try { return localStorage.getItem(SCRIPT_STORAGE_KEY) ?? ''; } catch { return ''; }
};

// ── 타입 정의 ──────────────────────────────────────────────────────────────────
export type Command =
  | { type: 'ACTIVATE' }
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'MOVE_NORM';  value: number }
  | { type: 'SPEED_NORM'; value: number }
  | { type: 'FORCE_NORM'; value: number }
  | { type: 'EMERGENCY' }
  | { type: 'RESET' }
  | { type: 'LOG';    message: string }
  | { type: 'WAIT';   ms: number }
  | { type: 'REPEAT'; count: number; block: Command[] }

export interface ParseError  { line: number; message: string }
export interface ParseResult { commands: Command[]; errors: ParseError[] }
type BlockFrame = { kind: 'REPEAT'; count: number; block: Command[] }

// ── 라인 파서 ──────────────────────────────────────────────────────────────────
function parseLine(raw: string): { name: string; args: string[] } {
  const line = raw.split('#')[0].trim();
  const parenMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)\s*$/);
  if (parenMatch) {
    const name   = parenMatch[1].toLowerCase();
    const argStr = parenMatch[2].trim();
    const args   = argStr ? argStr.split(/\s*,\s*|\s+/).filter(Boolean) : [];
    return { name, args };
  }
  const parts = line.split(/\s+/);
  return { name: parts[0].toLowerCase(), args: parts.slice(1) };
}

// ── 파서 ───────────────────────────────────────────────────────────────────────
export function parseScript(text: string): ParseResult {
  const lines        = text.split('\n');
  const errors: ParseError[]  = [];
  const commands: Command[]   = [];
  const blockStack: BlockFrame[] = [];

  const push = (cmd: Command) => {
    if (blockStack.length === 0) { commands.push(cmd); return; }
    blockStack[blockStack.length - 1].block.push(cmd);
  };

  const checkNorm = (val: number, cmd: string, ln: number): boolean => {
    if (isNaN(val) || val < 0 || val > 100) {
      errors.push({ line: ln, message: `${cmd}: 0~100 사이 숫자를 입력하세요. (입력값: ${val})` });
      return false;
    }
    return true;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const raw     = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;

    const logMatch = raw.match(/^log\s*\(([^)]*)\)\s*$/i) || raw.match(/^log\s+(.+)$/i);
    if (logMatch) { push({ type: 'LOG', message: logMatch[1].trim() }); continue; }

    const { name, args } = parseLine(raw);

    switch (name) {
      case 'rq_activate_and_wait': push({ type: 'ACTIVATE' });  break;
      case 'rq_open_and_wait':     push({ type: 'OPEN' });      break;
      case 'rq_close_and_wait':    push({ type: 'CLOSE' });     break;
      case 'rq_emergency_release': push({ type: 'EMERGENCY' }); break;
      case 'rq_reset':             push({ type: 'RESET' });     break;
      case 'rq_move_and_wait_norm': {
        const val = parseFloat(args[0] ?? '');
        if (checkNorm(val, 'rq_move_and_wait_norm', lineNum)) push({ type: 'MOVE_NORM', value: val });
        break;
      }
      case 'rq_set_speed_norm': {
        const val = parseFloat(args[0] ?? '');
        if (checkNorm(val, 'rq_set_speed_norm', lineNum)) push({ type: 'SPEED_NORM', value: val });
        break;
      }
      case 'rq_set_force_norm': {
        const val = parseFloat(args[0] ?? '');
        if (checkNorm(val, 'rq_set_force_norm', lineNum)) push({ type: 'FORCE_NORM', value: val });
        break;
      }
      case 'wait': {
        const ms = parseInt(args[0] ?? '', 10);
        if (isNaN(ms) || ms < 0) errors.push({ line: lineNum, message: 'WAIT: 0 이상의 숫자(ms)를 입력하세요.  예) WAIT(500)' });
        else push({ type: 'WAIT', ms });
        break;
      }
      case 'repeat': {
        const count = parseInt(args[0] ?? '', 10);
        if (isNaN(count) || count < 1) errors.push({ line: lineNum, message: 'REPEAT: 1 이상의 숫자를 입력하세요.  예) REPEAT(3)' });
        else blockStack.push({ kind: 'REPEAT', count, block: [] });
        break;
      }
      case 'end': {
        const top = blockStack[blockStack.length - 1];
        if (!top) errors.push({ line: lineNum, message: 'END에 대응하는 REPEAT가 없습니다.' });
        else { blockStack.pop(); push({ type: 'REPEAT', count: top.count, block: top.block }); }
        break;
      }
      case 'rq_move_and_wait':
        errors.push({ line: lineNum, message: 'rq_move_and_wait(0~255)는 지원하지 않습니다. → rq_move_and_wait_norm(0~100) 을 사용하세요.' });
        break;
      case 'rq_set_speed':
        errors.push({ line: lineNum, message: 'rq_set_speed(0~255)는 지원하지 않습니다. → rq_set_speed_norm(0~100) 을 사용하세요.' });
        break;
      case 'rq_set_force':
        errors.push({ line: lineNum, message: 'rq_set_force(0~255)는 지원하지 않습니다. → rq_set_force_norm(0~100) 을 사용하세요.' });
        break;
      case 'if':
        errors.push({ line: lineNum, message: 'IF rq_is_object_detected()는 현재 지원하지 않는 명령어입니다.' });
        break;
      case 'else':
      case 'endif':
        errors.push({ line: lineNum, message: `${lines[i].trim()}에 대응하는 IF 블록이 없습니다.` });
        break;
      default:
        if (name) errors.push({ line: lineNum, message: `알 수 없는 명령어: "${lines[i].trim().split(/[\s(]/)[0]}"` });
    }
  }

  for (const frame of blockStack)
    errors.push({ line: lines.length, message: `REPEAT(${frame.count}) 블록이 END 없이 끝났습니다.` });

  return { commands, errors };
}

// ── 단위 변환 ──────────────────────────────────────────────────────────────────
const POS_CLOSE   = -2000;
const POS_OPEN    =     0;
const SPEED_MAX   =   360;
const FORCE_MAX   =  1000;
const ACC_DEFAULT =    50;

const posNormToReg   = (pct: number): number => Math.round((pct / 100) * POS_CLOSE);
const speedNormToReg = (pct: number): number => Math.max(1, Math.round((pct / 100) * SPEED_MAX));
const forceNormToReg = (pct: number): number => Math.round((pct / 100) * FORCE_MAX);

// ── Modbus 헬퍼 ────────────────────────────────────────────────────────────────
// ↓ 캐시 업데이트를 invoke 전에 즉시 수행 (UI 반응성 향상)
const writeReg = async (address: number, value: number): Promise<void> => {
  _regCache[address] = value;   // ← 캐시 즉시 업데이트
  await invoke('modbus_write_single_register', { address, value });
};

const readInput = (address: number, quantity: number): Promise<number[]> =>
  invoke<number[]>('modbus_read_input_registers', { address, quantity });

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const pollUntil = async (
  check:      () => Promise<boolean>,
  timeoutMs  = 10_000,
  intervalMs =    100,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(intervalMs);
  }
  return false;
};

const triggerMove = async (pos: number, spd: number, frc: number): Promise<void> => {
  await writeReg(1003, pos);
  await writeReg(1004, spd);
  await writeReg(1005, frc);
  await writeReg(1006, ACC_DEFAULT);
  await writeReg(1000, 17);
  await writeReg(1000, 1);
};

const waitMoveDone = (stopSignal: { stopped: boolean }): Promise<boolean> =>
  pollUntil(async () => {
    if (stopSignal.stopped) return true;
    const r = await readInput(2000, 1);
    return (r[0] & 0x08) === 0;
  });

// ── 실행기 ─────────────────────────────────────────────────────────────────────
export interface RunnerOptions {
  updateState: (patch: Partial<GripperState>) => void;
  getState:    () => GripperState;
  onLog:       (msg: string) => void;
  stopSignal:  { stopped: boolean };
}

interface RunnerState { speedNorm: number; forceNorm: number }

async function execCommands(
  commands: Command[],
  opts: RunnerOptions,
  rs: RunnerState,
): Promise<void> {
  const { updateState, onLog, stopSignal } = opts;

  for (const cmd of commands) {
    if (stopSignal.stopped) { onLog('⏹ 스크립트 중지됨'); return; }

    try {
      switch (cmd.type) {

        case 'ACTIVATE': {
          onLog('🔌 rq_activate_and_wait() → 1000=1 (rACT=1)');
          await writeReg(1000, 1);
          const ok = await pollUntil(async () => {
            if (stopSignal.stopped) return true;
            const r = await readInput(2000, 1);
            return (r[0] & 0x01) === 1;
          });
          onLog(ok ? '  ✅ 준비 완료 (gACT=1)' : '  ⚠️ 타임아웃: 10초 내 응답 없음');
          break;
        }

        case 'OPEN': {
          const sp = speedNormToReg(rs.speedNorm);
          const fo = forceNormToReg(rs.forceNorm);
          onLog(`🔓 rq_open_and_wait() → 1003=${POS_OPEN}  1004=${sp}  1005=${fo}  1006=${ACC_DEFAULT}`);
          await triggerMove(POS_OPEN, sp, fo);
          const ok = await waitMoveDone(stopSignal);
          onLog(ok ? '  ✅ 열림 완료 (gRUN=0)' : '  ⚠️ 타임아웃');
          break;
        }

        case 'CLOSE': {
          const sp = speedNormToReg(rs.speedNorm);
          const fo = forceNormToReg(rs.forceNorm);
          onLog(`🔒 rq_close_and_wait() → 1003=${POS_CLOSE}  1004=${sp}  1005=${fo}  1006=${ACC_DEFAULT}`);
          await triggerMove(POS_CLOSE, sp, fo);
          const ok = await waitMoveDone(stopSignal);
          onLog(ok ? '  ✅ 닫힘 완료 (gRUN=0)' : '  ⚠️ 타임아웃');
          break;
        }

        case 'MOVE_NORM': {
          const pos = posNormToReg(cmd.value);
          const sp  = speedNormToReg(rs.speedNorm);
          const fo  = forceNormToReg(rs.forceNorm);
          onLog(`📐 rq_move_and_wait_norm(${cmd.value}%) → 1003=${pos}  1004=${sp}  1005=${fo}  1006=${ACC_DEFAULT}`);
          await triggerMove(pos, sp, fo);
          const ok = await waitMoveDone(stopSignal);
          onLog(ok ? `  ✅ ${cmd.value}% 이동 완료 (gRUN=0)` : '  ⚠️ 타임아웃');
          break;
        }

        case 'SPEED_NORM': {
          rs.speedNorm = cmd.value;
          const sp = speedNormToReg(cmd.value);
          await writeReg(1004, sp);
          onLog(`⚡ rq_set_speed_norm(${cmd.value}%) → 1004=${sp} deg/s`);
          break;
        }

        case 'FORCE_NORM': {
          rs.forceNorm = cmd.value;
          const fo = forceNormToReg(cmd.value);
          await writeReg(1005, fo);
          onLog(`💪 rq_set_force_norm(${cmd.value}%) → 1005=${fo} (${(cmd.value * 3.5 / 100).toFixed(2)} Nm)`);
          break;
        }

        case 'RESET': {
          onLog('🔄 rq_reset() → 1000=3 (rRST ON)');
          await writeReg(1000, 3);
          await sleep(100);
          await writeReg(1000, 1);
          onLog('  ✅ 리셋 완료 (1000: 3 → 1)');
          break;
        }

        case 'EMERGENCY': {
          await writeReg(1000, 33);
          updateState({ eStop: true });
          onLog('🚨 rq_emergency_release() → 1000=33 (rSTP=1) 즉시 정지');
          break;
        }

        case 'LOG':   onLog(`💬 ${cmd.message}`); break;
        case 'WAIT':  onLog(`⏳ WAIT(${cmd.ms}ms)`); await sleep(cmd.ms); break;

        case 'REPEAT':
          for (let i = 0; i < cmd.count; i++) {
            if (stopSignal.stopped) return;
            onLog(`🔁 REPEAT ${i + 1} / ${cmd.count}`);
            await execCommands(cmd.block, opts, rs);
          }
          break;
      }
    } catch (err) {
      onLog(`❌ 오류 발생: ${err}`);
      throw err;
    }
  }
}

export async function runScript(commands: Command[], opts: RunnerOptions): Promise<void> {
  const rs: RunnerState = { speedNorm: 50, forceNorm: 40 };
  await execCommands(commands, opts, rs);
  if (!opts.stopSignal.stopped) opts.onLog('✔ 스크립트 실행 완료');
}