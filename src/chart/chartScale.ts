// ── 차트 축 계산 (dmt-gripper-controller 의 chartScale / buildTimeTicks 이식) ──

const NICE_FRACTIONS = [1, 2, 2.5, 5, 10];

/** rawStep 을 가장 가까운 "nice" 1/2/2.5/5/10 × 10^n 값으로 올림한다. */
export function niceStep(rawStep: number): number {
  if (rawStep <= 0) return NICE_FRACTIONS[0];
  const exponent = Math.floor(Math.log10(rawStep));
  const base     = Math.pow(10, exponent);
  const residual = rawStep / base;
  const fraction = NICE_FRACTIONS.find(f => residual <= f) ?? 10;
  return fraction * base;
}

/**
 * 0 을 중심으로 한 5개 눈금: +range, +range/2, 0, −range/2, −range.
 * 데이터에 맞춰 스케일이 바뀌지 않는다 — 계기판처럼 "선이 프레임 어디에 있는지"로
 * 읽을 수 있어야 하고, 두 번의 운전을 같은 높이로 비교할 수 있어야 하기 때문.
 */
export function axisTicks(range: number): number[] {
  return [range, range / 2, 0, -range / 2, -range];
}

/** 시간축에 대략 이 개수의 구간이 보이도록 눈금 간격을 고른다 (0,2,4,6 → 0,2.5,5,7.5,10 → 0,5,10,15). */
const TARGET_INTERVALS = 5;

/**
 * 0 부터 elapsedSec 까지(초과하지 않는) 자동 간격 시간 눈금.
 * 마지막 눈금은 실제 오른쪽 끝보다 앞에 놓일 수 있다 — 도메인은 매 샘플 자라므로
 * 데이터 선은 elapsedSec 자체를 도메인으로 써서 항상 오른쪽 끝에 닿는다.
 */
export function buildTimeTicks(elapsedSec: number, periodSec: number): number[] {
  const step  = niceStep(Math.max(elapsedSec, periodSec) / TARGET_INTERVALS);
  const count = Math.floor(elapsedSec / step);
  return Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}
