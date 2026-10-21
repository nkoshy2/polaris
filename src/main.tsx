import { render } from 'preact';
import { StoreContext } from './state/context';
import { Store } from './state/store';
import type { KeyValueStore } from './storage/repository';
import { App } from './ui/App';
import '@fontsource/figtree/400.css';
import '@fontsource/figtree/600.css';
import '@fontsource/figtree/700.css';
import './styles.css';

function storage(): KeyValueStore {
  try {
    return window.localStorage;
  } catch {
    // Accessing localStorage throws when site data is blocked. Polaris still
    // runs (in memory only) and shows a "changes aren't being saved" banner.
    const blocked = () => {
      throw new Error('Browser storage is blocked for this page.');
    };
    return { getItem: blocked, setItem: blocked, removeItem: blocked };
  }
}

const store = new Store(storage());

render(
  <StoreContext.Provider value={store}>
    <App />
  </StoreContext.Provider>,
  document.getElementById('app')!,
);
