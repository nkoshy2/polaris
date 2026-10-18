import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Store, StoreState } from './store';

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside <StoreContext.Provider>.');
  return store;
}

/** Subscribes the component to store changes and returns the latest state. */
export function useStoreState(): StoreState {
  const store = useStore();
  const [state, setState] = useState(store.getState());
  useEffect(() => {
    setState(store.getState());
    return store.subscribe(() => setState(store.getState()));
  }, [store]);
  return state;
}
