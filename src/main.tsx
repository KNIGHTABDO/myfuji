import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

// DEV-only probe hook (window.__myfuji) for headless measurement; tree-shaken from builds.
if (import.meta.env.DEV) void import('./debug');
