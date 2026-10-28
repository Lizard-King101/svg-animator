/** Lab-only opt-in. No saved-document fields or inert editor preference. The editor
 * remains SVG until its capability and interaction gates are ready for rollout. */
class ExperimentalGpuSetting {
    private value = false;
    private listeners = new Set<(enabled: boolean) => void>();
    revision = 0;
    get enabled(): boolean { return this.value; }
    set(enabled: boolean): void {
        if(enabled === this.value) return;
        this.value = enabled; this.revision++;
        for(const listener of this.listeners) listener(enabled);
    }
    subscribe(listener: (enabled: boolean) => void): () => void {
        this.listeners.add(listener); return () => this.listeners.delete(listener);
    }
}
export const experimentalGpu = new ExperimentalGpuSetting();
