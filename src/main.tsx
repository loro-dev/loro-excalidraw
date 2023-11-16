// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).process = { env: { NODE_ENV: 'development' } };

import { Theme } from '@radix-ui/themes';
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'


ReactDOM.createRoot(document.getElementById('root')!).render(
  <Theme>
    <App />
  </Theme>
)
