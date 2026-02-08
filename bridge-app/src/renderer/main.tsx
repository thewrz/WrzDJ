import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/global.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
