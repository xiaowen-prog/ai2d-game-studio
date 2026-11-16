import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/press-start-2p/latin-400.css';
import '@vp-tw/cjk-web-fonts-fusion-pixel-font/dist/12px/proportional/zh_hans/Fusion-Pixel-12px-Proportional-Simplified-Chinese.css';
import { App } from './App';
import { StudioPreview } from './design/StudioPreview';
import { installBrowserBridge } from './browserBridge';
import './styles.css';
import './studio.css';

const requestedDesign = new URLSearchParams(location.search).get('design');
const liveMode = new URLSearchParams(location.search).get('live') === '1';
const isHostedPreview =
  (location.protocol === 'http:' || location.protocol === 'https:') &&
  !['127.0.0.1', 'localhost'].includes(location.hostname);
// 旧版设计方案曾允许跳过前置步骤。所有设计预览入口现在统一进入带门禁的 refined 预览，
// 保留历史链接可打开，但不再让旧页面绕过当前制作流程。
const design = requestedDesign ? 'refined' : (isHostedPreview ? 'refined' : null);
if (liveMode || design === null) installBrowserBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {liveMode || design === null ? <App /> : <StudioPreview />}
  </StrictMode>,
);
