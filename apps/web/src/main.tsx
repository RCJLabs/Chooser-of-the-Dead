import { App, CrashGuard } from '@cots/ui';
import { render } from 'preact';
import '@cots/ui/styles.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element');
// Anything that breaks the screen is caught here, the game's own effects included (docs/tech-spec.md §63).
render(
  <CrashGuard>
    <App />
  </CrashGuard>,
  root,
);
