import React, { useEffect, useState } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { GripperState } from '../App';
import { STATUS_BIT } from '../registers';
import { C } from '../theme';

interface Props { state: GripperState; isMoving: boolean }

const StatusBar: React.FC<Props> = ({ state, isMoving }) => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const fault = (state.actionStatus & STATUS_BIT.gERR) !== 0;

  return (
    <Box sx={{
      bgcolor: C.surface, borderTop: `1px solid ${C.line}`,
      px: 2, py: 0.7,
      display: 'flex', alignItems: 'center', gap: 3,
      position: 'relative',
    }}>
      {/* Moving indicator */}
      {isMoving && (
        <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2 }}>
          <LinearProgress sx={{ height: 2, bgcolor: 'transparent', '& .MuiLinearProgress-bar': { bgcolor: C.accent } }} />
        </Box>
      )}

      {/* Left: connection info */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography sx={{
          fontSize: '0.72rem', fontWeight: 600,
          color: !state.connected ? C.muted : state.demo ? C.warn : C.ok,
        }}>
          {state.connected ? (state.demo ? 'Connected (Demo)' : 'Connected') : 'Disconnected'}
        </Typography>

        <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontFamily: C.mono }}>
          {state.baudRate} bps · 8N1 · ID {state.slaveId}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{
            width: 6, height: 6, borderRadius: '50%',
            bgcolor: fault ? C.danger : isMoving ? C.accent : state.activated ? C.ok : C.faint,
          }} />
          <Typography sx={{ fontSize: '0.72rem', color: fault ? C.danger : C.sub, fontWeight: fault ? 700 : 500 }}>
            {fault ? `Fault 0x${state.faultCode.toString(16).toUpperCase().padStart(4, '0')}`
              : isMoving ? 'Moving' : state.activated ? 'Idle' : 'Inactive'}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Right: time + copyright */}
      <Typography sx={{ fontSize: '0.72rem', color: C.muted, fontFamily: C.mono }}>
        {time.toLocaleTimeString()}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: C.faint }}>
        © All rights reserved.
      </Typography>
    </Box>
  );
};

export default StatusBar;
