import React from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { GripperState } from '../App';
import robotIcon from '../assets/robot_icon.png'; // 이미지 경로를 실제 위치에 맞게 수정하세요

interface Props {
  tab:           number;
  setTab:        (t: number) => void;
  state:         GripperState;
  onConnect:     () => Promise<void>;
  onEStop:       () => Promise<void>;
  onResumeEStop: () => Promise<void>;
}

const TABS = ['Control', 'Modbus', 'Information'];

const Header: React.FC<Props> = ({
  tab, setTab, state, onConnect, onEStop, onResumeEStop,
}) => {
  const { connected, eStop, demo } = state;

  const statusLabel = eStop ? 'E-STOP' : connected ? (demo ? 'Demo' : 'Online') : 'Offline';
  const statusColor = eStop ? '#C62828' : connected ? (demo ? '#EF6C00' : '#2E7D32') : '#757575';
  const statusDot   = eStop ? '#C62828' : connected ? (demo ? '#FB8C00' : '#43A047') : '#9E9E9E';

  return (
    <Box sx={{
      display:      'flex',
      alignItems:   'center',
      height:       52,
      px:           2.5,
      bgcolor:      '#fff',
      borderBottom: '1px solid #E0EAF4',
      flexShrink:   0,
      userSelect:   'none',
    }}>

      {/* ── 로고 ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
        {/* ### 아이콘 - 로봇 암 이미지 */}
        <Box
          component="img"
          src={robotIcon}
          alt="Gripper Icon"
          sx={{ width: 34, height: 34, flexShrink: 0, objectFit: 'contain' }}
        />
        <Typography sx={{
          fontSize:      '0.9rem',
          fontWeight:    700,
          color:         '#1A2A3A',
          letterSpacing: '-0.01em',
          whiteSpace:    'nowrap',
        }}>
          Gripper Control
        </Typography>
      </Box>

      {/* ── 탭 네비게이션 (로고 바로 옆) ─────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
        {TABS.map((label, i) => {
          const active = tab === i;
          return (
            <Box
              key={label}
              onClick={() => setTab(i)}
              sx={{
                display:    'flex',
                alignItems: 'center',
                px:         2,
                cursor:     'pointer',
                position:   'relative',
                fontSize:   '0.82rem',
                fontWeight: active ? 700 : 500,
                color:      active ? '#1976D2' : '#78909C',
                transition: 'color 0.15s',
                '&:hover':  { color: '#1976D2' },
                '&::after': {
                  content:      '""',
                  position:     'absolute',
                  bottom:       0,
                  left:         0,
                  right:        0,
                  height:       2,
                  bgcolor:      active ? '#1976D2' : 'transparent',
                  borderRadius: '2px 2px 0 0',
                },
              }}
            >
              {label}
            </Box>
          );
        })}
      </Box>

      {/* ── 가운데 여백 ───────────────────────────────────────────── */}
      <Box sx={{ flex: 1 }} />

      {/* ── 우측: Connect / E-STOP / 상태 ────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>

        {/* Connect / Disconnect */}
        <Button
          size="small"
          variant="contained"
          onClick={onConnect}
          disabled={eStop}
          disableElevation
          sx={{
            fontSize:     '0.78rem',
            fontWeight:   600,
            height:       34,
            px:           2.2,
            borderRadius: 1.5,
            bgcolor:      connected ? '#E3F2FD' : '#1976D2',
            color:        connected ? '#1976D2' : '#fff',
            border:       connected ? '1px solid #90CAF9' : 'none',
            '&:hover': {
              bgcolor:   connected ? '#BBDEFB' : '#1565C0',
              boxShadow: 'none',
            },
            '&.Mui-disabled': {
              bgcolor: '#F5F5F5',
              color:   '#BDBDBD',
            },
          }}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </Button>

        {/* E-STOP / Resume */}
        {eStop ? (
          <Button
            size="small"
            variant="outlined"
            onClick={onResumeEStop}
            disableElevation
            sx={{
              fontSize:     '0.75rem',
              fontWeight:   700,
              height:       34,
              px:           1.8,
              borderRadius: 1.5,
              borderColor:  '#E57373',
              color:        '#C62828',
              bgcolor:      '#FFEBEE',
              '&:hover': {
                bgcolor:     '#FFCDD2',
                borderColor: '#C62828',
              },
            }}
          >
            Resume
          </Button>
        ) : (
          <Button
            size="small"
            variant="outlined"
            onClick={onEStop}
            disableElevation
            startIcon={
              <PowerSettingsNewIcon sx={{ fontSize: '14px !important', color: '#E57373' }} />
            }
            sx={{
              fontSize:     '0.75rem',
              fontWeight:   600,
              height:       34,
              px:           1.6,
              borderRadius: 1.5,
              borderColor:  '#FFCDD2',
              color:        '#E57373',
              bgcolor:      '#FFF5F5',
              '& .MuiButton-startIcon': { mr: 0.5 },
              '&:hover': {
                bgcolor:     '#FFEBEE',
                borderColor: '#EF9A9A',
              },
            }}
          >
            E-STOP
          </Button>
        )}

        {/* 상태 칩 */}
        <Chip
          size="small"
          label={statusLabel}
          icon={
            <Box sx={{
              width:        7,
              height:       7,
              borderRadius: '50%',
              bgcolor:      statusDot,
              ml:           '8px !important',
              flexShrink:   0,
            }} />
          }
          sx={{
            height:     28,
            fontSize:   '0.72rem',
            fontWeight: 500,
            color:      statusColor,
            bgcolor:    connected && demo && !eStop ? '#FFF8F0' : '#fff',
            border:     `1px solid ${connected && demo && !eStop ? '#FFCC80' : '#E0EAF4'}`,
            '& .MuiChip-icon':  { mr: 0 },
            '& .MuiChip-label': { px: 1 },
          }}
        />

      </Box>
    </Box>
  );
};

export default Header;