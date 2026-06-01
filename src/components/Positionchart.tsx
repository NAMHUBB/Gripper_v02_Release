import React from 'react';
import { Paper, Box, Typography } from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { DataPoint } from '../App';

const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #E0EAF4', borderRadius: '4px', p: 1, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
      <Typography sx={{ fontSize: '0.68rem', color: '#5A7A9A', mb: 0.3 }}>t = {Number(label).toFixed(1)}s</Typography>
      {payload.map((p: any) => (
        <Typography key={p.name} sx={{ fontSize: '0.72rem', color: p.color, fontWeight: 500 }}>
          {p.name}: {Math.round(p.value)}
        </Typography>
      ))}
    </Box>
  );
};

const PositionChart: React.FC<{ chartData: DataPoint[] }> = ({ chartData }) => (
  <Paper sx={{ p: 2, bgcolor: '#fff', display: 'flex', flexDirection: 'column', height: '100%' }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, pb: 0.6, borderBottom: '1px solid #E0EAF4' }}>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: '#1976D2' }}>Position Echo / Actual</Typography>
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        {[{ label: 'Echo', color: '#1976D2' }, { label: 'Actual', color: '#388E3C' }].map(l => (
          <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 16, height: 2, bgcolor: l.color, borderRadius: 1 }} />
            <Typography sx={{ fontSize: '0.65rem', color: '#90A4AE' }}>{l.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
    <Box sx={{ flex: 1, minHeight: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" vertical={false} />
          <XAxis dataKey="time" tickFormatter={v => `${Number(v).toFixed(0)}s`}
            tick={{ fontSize: 9, fill: '#90A4AE' }} axisLine={false} tickLine={false}
            label={{ value: 'Time (s)', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: '#90A4AE' } }} />
          <YAxis domain={[0, 260]} tickCount={6} tick={{ fontSize: 9, fill: '#90A4AE' }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Line type="monotoneX" dataKey="echo" stroke="#1976D2" strokeWidth={2} dot={false} isAnimationActive={false} name="Echo" />
          <Line type="monotoneX" dataKey="actual" stroke="#388E3C" strokeWidth={1.5} strokeDasharray="4 2" dot={false} isAnimationActive={false} name="Actual" />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  </Paper>
);

export default PositionChart;