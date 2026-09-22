import React from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import { GripperState } from '../App';
import { C } from '../theme';
import robotIcon from '../assets/robot_icon.png';

interface Props {
  tab:           number;
  setTab:        (t: number) => void;
  state:         GripperState;
  onConnect:     () => Promise<void>;
  onEStop:       () => Promise<void>;
  onResumeEStop: () => Promise<void>;
}

/** Dashboard: 실시간 제어/모니터 · Device: 연결 설정 + 모터/레지스터 정보 */
const TABS = ['Dashboard', 'Device'];

const Header: React.FC<Props> = ({
  tab, setTab, state, onConnect, onEStop, onResumeEStop,
}) => {
  const { connected, connecting, eStop, demo } = state;

  const statusLabel = eStop ? 'E-STOP' : connected ? (demo ? 'Demo' : 'Online') : connecting ? 'Connecting' : 'Offline';
  const statusColor = eStop ? C.danger : connected ? (demo ? C.warn : C.ok) : C.sub;
  const statusDot   = eStop ? C.danger : connected ? (demo ? C.warn : C.ok) : C.faint;

  return (
    <Box sx={{
      display:      'flex',
      alignItems:   'center',
      height:       52,
      px:           2.5,
      bgcolor:      C.surface,
      borderBottom: `1px solid ${C.line}`,
      flexShrink:   0,
      userSelect:   'none',
    }}>

      {/* ── 로고 ──────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 1 }}>
        <Box
          component="img"
          src={robotIcon}
          alt="Gripper Icon"
          sx={{ width: 34, height: 34, flexShrink: 0, objectFit: 'contain' }}
        />
        <Typography sx={{
          fontSize:      '0.9rem',
          fontWeight:    700,
          color:         C.text,
          letterSpacing: '-0.01em',
          whiteSpace:    'nowrap',
        }}>
          Gripper Control
        </Typography>
      </Box>

      {/* ── 탭 네비게이션 ─────────────────────────────────────────── */}
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
                color:      active ? C.accent : C.sub,
                transition: 'color 0.15s',
                '&:hover':  { color: C.accent },
                '&::after': {
                  content:      '""',
                  position:     'absolute',
                  bottom:       0,
                  left:         0,
                  right:        0,
                  height:       2,
                  bgcolor:      active ? C.accent : 'transparent',
                  borderRadius: '2px 2px 0 0',
                },
              }}
            >
              {label}
            </Box>
          );
        })}
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* ── 우측: 포트 · Connect / E-STOP / 상태 ─────────────────── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>

        {/* 현재 포트 · baud (Device 탭에서 변경) */}
        <Typography sx={{ fontSize: '0.7rem', color: C.muted, fontFamily: C.mono, mr: 0.5, maxWidth: 260 }} noWrap title={state.port}>
          {state.port || 'no port'} · {state.baudRate} · ID {state.slaveId}
        </Typography>

        {/* Connect / Disconnect */}
        <Button
          size="small"
          variant="contained"
          onClick={onConnect}
          disabled={eStop || connecting}
          disableElevation
          sx={{
            fontSize:     '0.78rem',
            fontWeight:   600,
            height:       34,
            px:           2.2,
            borderRadius: 1.5,
            bgcolor:      connected ? C.surfaceTint : C.accent,
            color:        connected ? C.accent : '#fff',
            border:       connected ? `1px solid ${C.line}` : 'none',
            '&:hover': {
              bgcolor:   connected ? '#D6E6F7' : C.title,
              boxShadow: 'none',
            },
            '&.Mui-disabled': {
              bgcolor: C.surfaceAlt,
              color:   C.faint,
            },
          }}
        >
          {connected ? 'Disconnect' : connecting ? 'Connecting…' : 'Connect'}
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
              color:        C.danger,
              bgcolor:      C.dangerBg,
              '&:hover': { bgcolor: '#FFCDD2', borderColor: C.danger },
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
            startIcon={<PowerSettingsNewIcon sx={{ fontSize: '14px !important', color: '#E57373' }} />}
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
              '&:hover': { bgcolor: C.dangerBg, borderColor: '#EF9A9A' },
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
              width: 7, height: 7, borderRadius: '50%',
              bgcolor: statusDot, ml: '8px !important', flexShrink: 0,
            }} />
          }
          sx={{
            height:     28,
            fontSize:   '0.72rem',
            fontWeight: 600,
            color:      statusColor,
            bgcolor:    connected && demo && !eStop ? C.warnBg : C.surface,
            border:     `1px solid ${connected && demo && !eStop ? C.warnLine : C.line}`,
            '& .MuiChip-icon':  { mr: 0 },
            '& .MuiChip-label': { px: 1 },
          }}
        />

      </Box>
    </Box>
  );
};

export default Header;
