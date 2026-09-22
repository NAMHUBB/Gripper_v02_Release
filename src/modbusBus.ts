import { invoke } from '@tauri-apps/api/core';

// ── Modbus 호출 직렬화 ────────────────────────────────────────────────────────
// 프론트에서 폴링(모니터 읽기)과 쓰기(1000~1004)가 동시에 invoke 되면 Rust 쪽
// 뮤텍스가 순서만 보장하고 프레임 사이 간격은 보장하지 않는다. 슬레이브(STM32)는
// 응답 직후 바로 오는 다음 요청을 놓칠 수 있어(→ 800ms 타임아웃), 모든 Modbus 호출을
// 한 줄로 세우고 호출 사이에 짧은 간격을 둔다.

/** 연속 호출 사이 간격 (ms) — 펌웨어 RX DMA 재준비 시간 + RTU 3.5 char 침묵 */
const INTER_CALL_GAP_MS = 8;

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

let chain: Promise<void> = Promise.resolve();

/** Modbus 관련 Tauri 커맨드를 순서대로, 간격을 두고 실행한다. */
export const busInvoke = <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
  const run = chain.then(async () => {
    try {
      return await invoke<T>(cmd, args);
    } finally {
      await sleep(INTER_CALL_GAP_MS);
    }
  });
  // 실패해도 다음 호출은 계속 진행되도록 체인은 항상 resolve 시킨다.
  chain = run.then(() => undefined, () => undefined);
  return run;
};
