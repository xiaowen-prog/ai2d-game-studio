import { useState } from 'react';

export function HomeScene() {
  const [mode, setMode] = useState<'side' | 'top'>('side');
  return (
    <aside className="home-scene" aria-label="玩法示意">
      <header><span>造境 / 玩法示意</span><span aria-hidden="true">◇</span></header>
      <svg viewBox="0 0 440 282" aria-hidden="true">
        <defs>
          <pattern id="scene-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0v24" fill="none" stroke="#759bee" strokeOpacity=".15" />
          </pattern>
          <radialGradient id="scene-light">
            <stop stopColor="#273f86" /><stop offset="1" stopColor="#10182d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="440" height="282" fill="url(#scene-light)" />
        <rect width="440" height="282" fill="url(#scene-grid)" />
        {mode === 'side' ? (
          <g key="side" className="home-scene-layer">
            <path d="m26 224 92-71 70 40 72-82 154 113" fill="#162851" stroke="#2e4a83" />
            <path d="M24 237h126v-22h65v-41h76v-44h105v14H305v44h-76v41h-65v22H24z" fill="#3c5a9b" stroke="#9cc9ff" />
            <path d="M85 219Q115 151 158 192T247 151Q268 109 326 111" fill="none" stroke="#b6d7ff" strokeDasharray="4 8" />
            <path d="m104 195 12 12-12 12-12-12z" fill="#f6d494" className="home-scene-spark" />
            <path d="M351 130V86l30 11-30 11" fill="#e6caa2" stroke="#ffebc8" />
          </g>
        ) : (
          <g key="top" className="home-scene-layer">
            <path d="M65 96h70V63h170v33h70v99h-70v34H135v-34H65z" fill="#233967" stroke="#8eb8ff" />
            <circle cx="220" cy="145" r="60" fill="none" stroke="#8eb8ff" strokeDasharray="4 8" />
            <path d="M220 92v106m-53-53h106" stroke="#8eb8ff" opacity=".55" />
            <path d="m220 131 14 14-14 14-14-14z" fill="#f6d494" className="home-scene-spark" />
            <g fill="#94baff"><circle cx="142" cy="110" r="6"/><circle cx="304" cy="116" r="6"/><circle cx="281" cy="194" r="6"/></g>
          </g>
        )}
      </svg>
      <div className="home-scene-switch" role="group" aria-label="切换玩法示意">
        <button type="button" aria-pressed={mode === 'side'} onClick={() => setMode('side')}>横版闯关</button>
        <button type="button" aria-pressed={mode === 'top'} onClick={() => setMode('top')}>俯视打怪</button>
      </div>
    </aside>
  );
}
