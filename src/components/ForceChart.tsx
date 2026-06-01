import React from 'react';
import { Paper, Box, Typography } from '@mui/material';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';
import { DataPoint } from '../App';

const CustomTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #E0EAF4', borderRadius: '4px', p: 1, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
      <Typography sx={{ fontSize: '0.68rem', color: '#5A7A9A', mb: 0.3 }}>t = {Number(label).toFixed(1)}s</Typography>
      <Typography sx={{ fontSize: '0.72rem', color: '#E64A19', fontWeight: 500 }}>
        Force: {(payload[0]?.value ?? 0).toFixed(2)} Nm
      </Typography>
    </Box>
  );
};

const ForceChart: React.FC<{ chartData: DataPoint[] }> = ({ chartData }) => {
  const maxForce = Math.max(...chartData.map(d => d.current), 10);
  const yMax = Math.ceil(maxForce * 1.25);

  return (
    <Paper sx={{ p: 2, bgcolor: '#fff', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, pb: 0.6, borderBottom: '1px solid #E0EAF4' }}>
        <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: '#1976D2' }}>Force (Nm)</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 16, height: 2, bgcolor: '#E64A19', borderRadius: 1 }} />
          <Typography sx={{ fontSize: '0.65rem', color: '#90A4AE' }}>Force</Typography>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={v => `${Number(v).toFixed(0)}s`}
              tick={{ fontSize: 9, fill: '#90A4AE' }}
              axisLine={false}
              tickLine={false}
              label={{ value: 'Time (s)', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: '#90A4AE' } }}
            />
            <YAxis
              domain={[0, yMax]}
              tickCount={6}
              tick={{ fontSize: 9, fill: '#90A4AE' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `${v}`}
              unit=" Nm"
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={yMax * 0.8}
              stroke="#FFCDD2"
              strokeDasharray="4 2"
              label={{ value: 'Max', position: 'right', style: { fontSize: 8, fill: '#EF9A9A' } }}
            />
            <Line
              type="monotoneX"
              dataKey="current"
              stroke="#E64A19"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              name="Force"
            />
          </LineChart>
        </ResponsiveContainer>
      </Box>
    </Paper>
  );
};

export default ForceChart;