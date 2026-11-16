import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/press-start-2p/latin-400.css';
import '@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css';
import { App } from './App';
import { StudioPreview } from './design/StudioPreview';
import { installBrowserBridge } from './browserBridge';
import './styles.css';
import './studio.css';

const params = new URLSearchParams(location.search);
const requestedDesign = params.get('design');
const liveMode = params.get('live') === '1';
const isHostedPreview =
  (location.protocol === 'http:' || location.protocol === 'https:') &&
  !['127.0.0.1', 'localhost'].includes(location.hostname);
// 浏览器公开入口只有一套视觉：造境 refined。旧的 design 参数继续兼容，
// 但不再选择另一套设计；真实制作台只由显式 live=1 或桌面应用入口打开。
const showBrowserPreview = !liveMode && (requestedDesign !== null || isHostedPreview);
if (!showBrowserPreview) installBrowserBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {showBrowserPreview ? <StudioPreview /> : <App />}
  </StrictMode>,
);
