import React from 'react';
import ReactDOM from 'react-dom/client';
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/jetbrains-mono';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* reducedMotion="user": respeta prefers-reduced-motion en todas las animaciones */}
    <MotionConfig reducedMotion="user" transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
      <LazyMotion features={domAnimation} strict>
        <App />
      </LazyMotion>
    </MotionConfig>
  </React.StrictMode>,
);
