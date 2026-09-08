import '../../app.css';
import App from './App.svelte';
import { mount } from 'svelte';
import { registerServiceWorker } from '../../lib/registerSw';

registerServiceWorker();
mount(App, { target: document.getElementById('app')! });
