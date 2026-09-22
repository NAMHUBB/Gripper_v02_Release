import React, { useEffect, useRef, useState } from 'react';
import { axisTicks, buildTimeTicks } from './chartScale';
import { C } from '../theme';

// ── LineChart — 의존성 없는 SVG 라인 차트 (dmt-gripper-controller RS485Tab 이식) ──
//
//  · viewBox 폭 460 고정(원본과 동일한 글자·여백 비율), 높이는 컨테이너 비율에 맞춰 정한다 →
//    preserveAspectRatio="xMidYMid meet" 로 균일 스케일하되 레터박스 없이 패널을 꽉 채운다.
//  · y축: −yRange ~ +yRange 고정, 0 중심 5개 눈금. 데이터에 맞춰 스케일이 바뀌지 않는다.
//  · x축: t = 0 부터 누적 — 도메인이 경과 시간과 함께 자라고 눈금 간격은 nice step 으로
//         자동 조정된다 (0,2,4,6 → 0,5,10 → 0,10,20 …). 오래된 샘플을 버리지 않는다.
//  · 호버: 점선 크로스헤어 + 마커 + `t = x.xx s / 값` 라벨. 오른쪽 끝 근처에서는 라벨을
//         왼쪽으로 뒤집어 플롯 밖으로 나가지 않게 한다.
//  · 원본과의 차이: 시리즈를 여러 개 겹칠 수 있고(Echo/Actual), 단위가 다른 보조 시리즈
//         여러 개를 우측 축(0 ~ rightMax, 고정)에 놓을 수 있다(ADC0~5 mV). 글자 색은 앱의
//         블루 팔레트를 따른다.

export interface ChartSeries {
  key:    string;
  label:  string;
  data:   number[];         // y축 단위, 오래된 것부터
  color:  string;
  dash?:  string;           // strokeDasharray (Echo 등 지령선 구분용)
  width?: number;
  format?: (v: number) => string;
}

interface Props {
  /** 좌측 y축은 −yRange ~ +yRange 로 고정 */
  yRange:     number;
  yLabel:     string;
  series:     ChartSeries[];
  /** 우측 축 보조 시리즈들 (0 ~ max 고정, 같은 단위) */
  right?:     { label: string; max: number; series: ChartSeries[] };
  /** 샘플 간격 (초) — 일정한 샘플 주기를 가정 */
  periodSec:  number;
  xLabel?:    string;
}

// 원본과 동일한 캔버스 폭 · 여백 (높이는 컨테이너 비율에서 계산, 기본 240)
const W = 460;
const H_DEFAULT = 240;
const H_MIN = 180;
const H_MAX = 720;
const PAD_L = 46;
const PAD_R_BASE = 14;
const PAD_R_AXIS = 44;   // 우측 축이 있을 때
const PAD_T = 12;
const PAD_B = 34;

const fmtDefault = (v: number) => v.toFixed(1);

const LineChart: React.FC<Props> = ({ yRange, yLabel, series, right, periodSec, xLabel = 'Time (s)' }) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef  = useRef<SVGSVGElement>(null);
  // 커서 아래 샘플 인덱스 — 포인터가 벗어나면 null
  const [hover, setHover] = useState<number | null>(null);

  // 컨테이너 가로세로 비율 → viewBox 높이. (폭 460 기준이라 글자 크기는 원본과 같다)
  const [H, setH] = useState(H_DEFAULT);
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const apply = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setH(Math.round(Math.min(H_MAX, Math.max(H_MIN, (W * r.height) / r.width))));
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padR  = right ? PAD_R_AXIS : PAD_R_BASE;
  const plotW = W - PAD_L - padR;
  const plotH = H - PAD_T - PAD_B;

  const n = Math.max(0, ...series.map(s => s.data.length), ...(right?.series.map(s => s.data.length) ?? []));
  const elapsedSec = Math.max(0, (n - 1) * periodSec);
  const domainMax  = Math.max(elapsedSec, periodSec);
  const xTicks     = buildTimeTicks(elapsedSec, periodSec);

  const yTicks = axisTicks(yRange);
  const xOf = (i: number) => PAD_L + ((i * periodSec) / domainMax) * plotW;
  const yOf = (v: number) => PAD_T + (0.5 - v / (2 * yRange)) * plotH;
  const yOfRight = (v: number) => PAD_T + (1 - v / (right?.max ?? 1)) * plotH;

  // 샘플이 플롯 픽셀 수의 2배를 넘으면 렌더링만 간축한다 (데이터는 그대로 보존)
  const stride = Math.max(1, Math.ceil(n / (plotW * 2)));
  const toPoints = (data: number[], y: (v: number) => number) => {
    const pts: string[] = [];
    for (let i = 0; i < data.length; i += stride) pts.push(`${xOf(i).toFixed(1)},${y(data[i]).toFixed(1)}`);
    const last = data.length - 1;
    if (last >= 0 && last % stride !== 0) pts.push(`${xOf(last).toFixed(1)},${y(data[last]).toFixed(1)}`);
    return pts.join(' ');
  };

  /** 포인터 위치 → 가장 가까운 샘플 인덱스. SVG 는 컨테이너에 균일 스케일되므로 한 배율로 환산된다. */
  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || n === 0) return;
    const scale   = Math.min(box.width / W, box.height / H);          // xMidYMid meet
    const offsetX = (box.width - W * scale) / 2;
    const svgX    = (e.clientX - box.left - offsetX) / scale;
    const seconds = ((svgX - PAD_L) / plotW) * domainMax;
    const i       = Math.round(seconds / periodSec);
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const hoverRows = hover === null ? [] : [
    ...series.map(s => ({ label: s.label, color: s.color, text: (s.format ?? fmtDefault)(s.data[hover] ?? 0), y: yOf(s.data[hover] ?? 0) })),
    ...(right?.series ?? []).map(s => ({ label: s.label, color: s.color, text: (s.format ?? fmtDefault)(s.data[hover] ?? 0), y: yOfRight(s.data[hover] ?? 0) })),
  ];
  const hoverX = hover !== null ? xOf(hover) : 0;
  const labelW = 86;
  const labelH = 11 + hoverRows.length * 9;
  // 오른쪽 끝 근처에서는 라벨을 크로스헤어 왼쪽으로 뒤집는다
  const flip   = hoverX + labelW + 6 > W - padR;

  return (
    <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: '100%', height: '100%', display: 'flex' }}>
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ flex: 1, minHeight: 0, width: '100%', height: '100%', display: 'block' }}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* 가로 그리드 + 좌측 y 눈금 (+ 우측 축 눈금) */}
      {yTicks.map((t, i) => {
        const y  = PAD_T + (i / (yTicks.length - 1)) * plotH;
        const rv = right ? right.max * (1 - i / (yTicks.length - 1)) : 0;
        return (
          <g key={`y${i}`}>
            <line x1={PAD_L} y1={y} x2={W - padR} y2={y} stroke={C.grid} />
            <text x={PAD_L - 8} y={y + 4} fontSize="10" fill={C.muted} textAnchor="end">{t}</text>
            {right && (
              <text x={W - padR + 8} y={y + 4} fontSize="10" fill={C.muted} textAnchor="start">{Math.round(rv)}</text>
            )}
          </g>
        );
      })}

      {/* x 눈금 — 값 기준 위치 (마지막 눈금은 오른쪽 끝보다 앞일 수 있음, domainMax 참고) */}
      {xTicks.map((t, i) => {
        const x = PAD_L + (t / domainMax) * plotW;
        return (
          <text key={`x${i}`} x={x} y={H - PAD_B + 18} fontSize="10" fill={C.muted} textAnchor="middle">{t}</text>
        );
      })}

      {/* 축 */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke={C.line} />
      <line x1={PAD_L} y1={PAD_T + plotH} x2={W - padR} y2={PAD_T + plotH} stroke={C.line} />
      {right && <line x1={W - padR} y1={PAD_T} x2={W - padR} y2={PAD_T + plotH} stroke={C.line} />}

      {/* 데이터 선 */}
      {right?.series.map(s => s.data.length > 0 && (
        <polyline key={s.key} points={toPoints(s.data, yOfRight)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.2} strokeDasharray={s.dash} />
      ))}
      {series.map(s => s.data.length > 0 && (
        <polyline key={s.key} points={toPoints(s.data, yOf)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.4} strokeDasharray={s.dash} />
      ))}

      {/* 축 라벨 */}
      <text x={14} y={PAD_T + plotH / 2} fontSize="10" fill={C.sub} textAnchor="middle" transform={`rotate(-90 14 ${PAD_T + plotH / 2})`}>{yLabel}</text>
      {right && (
        <text x={W - 10} y={PAD_T + plotH / 2} fontSize="10" fill={C.sub} textAnchor="middle" transform={`rotate(90 ${W - 10} ${PAD_T + plotH / 2})`}>{right.label}</text>
      )}
      <text x={PAD_L + plotW / 2} y={H - 4} fontSize="10" fill={C.sub} textAnchor="middle">{xLabel}</text>

      {/* 호버: 크로스헤어 + 마커 + 시각/값 라벨 */}
      {hover !== null && (
        <g pointerEvents="none">
          <line x1={hoverX} y1={PAD_T} x2={hoverX} y2={PAD_T + plotH} stroke={C.muted} strokeDasharray="3 3" />
          {hoverRows.map(r => (
            <circle key={r.label} cx={hoverX} cy={r.y} r="3.2" fill={r.color} stroke="#fff" strokeWidth="1" />
          ))}
          <g transform={`translate(${flip ? hoverX - labelW - 5 : hoverX + 5}, ${PAD_T + 4})`}>
            <rect width={labelW} height={labelH} rx="2.5" fill="#ffffff" stroke={C.line} opacity="0.96" />
            <text x="5" y="8" fontSize="6" fill={C.sub}>t = {(hover * periodSec).toFixed(2)} s</text>
            {hoverRows.map((r, i) => (
              <text key={r.label} x="5" y={17 + i * 9} fontSize="6.6" fontWeight="600" fill={r.color}>
                {r.label} {r.text}
              </text>
            ))}
          </g>
        </g>
      )}
    </svg>
    </div>
  );
};

export default LineChart;
