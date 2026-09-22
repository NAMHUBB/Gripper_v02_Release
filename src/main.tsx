import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ThemeProvider, createTheme, CssBaseline, GlobalStyles } from '@mui/material';
import { C } from './theme';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: C.accent, light: '#42A5F5', dark: C.title },
    error:   { main: C.danger },
    success: { main: C.ok },
    warning: { main: C.warn },
    background: { default: C.app, paper: C.surface },
    text: { primary: C.text, secondary: C.sub, disabled: C.faint },
    divider: C.line,
  },
  typography: {
    fontFamily: C.font,
    button: { textTransform: 'none', fontWeight: 500 },
    body2: { fontSize: '0.82rem' },
  },
  shape: { borderRadius: 6 },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none', boxShadow: '0 1px 4px rgba(15,47,85,0.06)', border: `1px solid ${C.line}` },
      },
    },
    MuiCheckbox: { styleOverrides: { root: { padding: '3px 6px' } } },
    MuiSlider: {
      styleOverrides: {
        root: { height: 4 },
        thumb: { width: 14, height: 14 },
        rail: { backgroundColor: C.lineSoft },
      },
    },
    MuiButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 500, fontSize: '0.82rem' } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { color: C.text } },
    },
    MuiTooltip: {
      styleOverrides: { tooltip: { backgroundColor: C.text, fontSize: '0.68rem' } },
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