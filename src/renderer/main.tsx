import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/press-start-2p/latin-400.css';
import '@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css';
import { App } from './App';
import { DesignPreview } from './design/DesignPreview';
import { StudioPreview } from './design/StudioPreview';
import { installBrowserBridge } from './browserBridge';
import './styles.css';
import './studio.css';

const design = new URLSearchParams(location.search).get('design');
if (design === null) installBrowserBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {design === null ? <App /> : design === 'refined' ? <StudioPreview /> : <DesignPreview initial={design} />}
  </StrictMode>,
);
