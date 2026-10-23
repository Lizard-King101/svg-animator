import { isEditableEventTarget } from './editable-event-target';

/** Capture transient canvas-tool keys without stealing text or focused button activation. */
export function bindToolKeyboard(enabled: () => boolean, key: (key: string) => void, beforeHistory?: () => void): () => void {
    const listeners = new AbortController();
    document.addEventListener('keydown', event => {
        if(!enabled() || isEditableEventTarget(event.target)) return;
        if(event.ctrlKey || event.metaKey) {
            if(['z', 'y'].includes(event.key.toLowerCase())) beforeHistory?.();
            return;
        }
        if(event.key === 'Enter' && event.target instanceof Element && event.target.closest('button, a, [role="button"]')) return;
        if(event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault(); event.stopImmediatePropagation(); key(event.key);
        }
    }, { capture: true, signal: listeners.signal });
    return () => listeners.abort();
}
