// ── 레지스터 쓰기 캐시 ─────────────────────────────────────────────────────────
// App이 마지막으로 쓴 Holding Register(1000~1007) 값을 저장.
// ModbusMonitor가 하드웨어 에코 없이도(데모 모드 포함) 최신 값을 표시할 수 있도록 함.
// (원래 scriptRunner.ts 에 있던 기능 — 스크립트 비활성화와 무관하게 필요하여 분리)
const _regCache: Record<number, number> = {};

/** 마지막으로 쓴 레지스터 캐시 반환 */
export const getRegCache = (): Readonly<Record<number, number>> => ({ ..._regCache });

/** 외부(App.tsx 등)에서 캐시를 업데이트할 때 사용 */
export const setRegCache = (addr: number, val: number): void => {
  _regCache[addr] = val;
};
