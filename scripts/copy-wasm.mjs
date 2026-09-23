// Copies the MediaPipe vision WASM runtime into public/ so the app runs
// fully offline, with no CDN at runtime.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
const src = 'node_modules/@mediapipe/tasks-vision/wasm';
const dst = 'public/mediapipe';
if (!existsSync(src)) { console.warn('[copy-wasm] @mediapipe/tasks-vision not installed yet'); process.exit(0); }
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log('[copy-wasm] MediaPipe runtime copied to', dst);
