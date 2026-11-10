import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {InternationalizationProvider} from '@astryxdesign/core/i18n';
import zhCN from '@astryxdesign/core/locales/zh-CN.generated.js';
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './focus-ring.css';
import {defaultThemeSlug, themes} from '../astryx-themes.js';
import App from './App.jsx';

const THEME_KEY = 'bonvoyage-theme';

function readMode() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    /* Private mode can block storage. */
  }
  return 'system';
}

function Root() {
  const [mode, setMode] = useState(readMode);

  function changeMode(next) {
    setMode(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* Ignore. */
    }
  }

  return (
    <Theme theme={themes[defaultThemeSlug]} mode={mode}>
      <InternationalizationProvider locale="zh-CN" messages={{'zh-CN': zhCN}}>
        <App onModeChange={changeMode} />
      </InternationalizationProvider>
    </Theme>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
