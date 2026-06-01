import React, { useEffect, useState } from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { GripperState } from '../App';

interface Props { state: GripperState; isMoving: boolean }

const StatusBar: React.FC<Props> = ({ state, isMoving }) => {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <Box sx={{
      bgcolor: '#fff', borderTop: '1px solid #E0EAF4',
      px: 2, py: 0.7,
      display: 'flex', alignItems: 'center', gap: 3,
      position: 'relative',
    }}>
      {/* Moving indicator */}
      {isMoving && (
        <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2 }}>
          <LinearProgress sx={{ height: 2, bgcolor: 'transparent', '& .MuiLinearProgress-bar': { bgcolor: '#1976D2' } }} />
        </Box>
      )}

      {/* Left: connection info */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography sx={{ fontSize: '0.72rem', color: state.connected ? '#388E3C' : '#90A4AE', fontWeight: 500 }}>
          {state.connected ? 'Connected' : 'Disconnected'}
        </Typography>

        <Typography sx={{ fontSize: '0.72rem', color: '#B0BEC5' }}>
          Baud: {state.baudRate}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{
            width: 6, height: 6, borderRadius: '50%',
            bgcolor: isMoving ? '#1976D2' : state.activated ? '#43A047' : '#B0BEC5',
          }} />
          <Typography sx={{ fontSize: '0.72rem', color: '#B0BEC5' }}>
            {isMoving ? 'Moving' : state.activated ? 'Idle' : 'Inactive'}
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Right: time + copyright */}
      <Typography sx={{ fontSize: '0.72rem', color: '#B0BEC5' }}>
        {time.toLocaleTimeString()}
      </Typography>
      <Typography sx={{ fontSize: '0.7rem', color: '#B0BEC5' }}>
        © All rights reserved.
      </Typography>
    </Box>
  );
};

export default StatusBar;