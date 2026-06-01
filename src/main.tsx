import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider, createTheme, CssBaseline, GlobalStyles } from '@mui/material';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976D2', light: '#42A5F5', dark: '#1565C0' },
    error:   { main: '#D32F2F' },
    success: { main: '#388E3C' },
    background: { default: '#F0F4F8', paper: '#FFFFFF' },
    text: { primary: '#1A2A3A', secondary: '#5A7A9A' },
    divider: '#E0EAF4',
  },
  typography: {
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    button: { textTransform: 'none', fontWeight: 500 },
    body2: { fontSize: '0.82rem' },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', border: '1px solid #E0EAF4' },
      },
    },
    MuiCheckbox: { styleOverrides: { root: { padding: '3px 6px' } } },
    MuiSlider: {
      styleOverrides: {
        root: { height: 4 },
        thumb: { width: 14, height: 14 },
        rail: { backgroundColor: '#CBD8E8' },
      },
    },
    MuiButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 500, fontSize: '0.82rem' } },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={{ '*': { userSelect: 'none' }, 'input, textarea': { userSelect: 'text' } }} />
      <App />
    </ThemeProvider>
  </React.StrictMode>
);