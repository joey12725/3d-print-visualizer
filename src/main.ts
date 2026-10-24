import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });

if (import.meta.env.DEV) {
  // handy for poking at state from the console
  import('./lib/state.svelte').then(({ app }) => ((window as unknown as { __app: unknown }).__app = app));
}
