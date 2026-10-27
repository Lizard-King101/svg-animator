export interface PlaybackSample { time: number; evaluation: number; rigs: number; render: number; total: number; interval?: number; }
const percentile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

/** Opt-in, bounded observations. Frame intervals include browser scheduling/paint;
 * stage timings measure application work, not asynchronous rasterization or GPU time.
 */
export class PlaybackDiagnostics {
    active = false;
    private samples: PlaybackSample[] = [];
    private tasks: number[] = [];
    private observer?: PerformanceObserver;
    private lastFrame?: number;
    private cursor = 0;
    private refreshInterval?: number;
    private readonly capacity = 1800;

    start(refreshInterval?: number): void {
        this.refreshInterval = refreshInterval && Number.isFinite(refreshInterval) && refreshInterval > 0 ? refreshInterval : undefined;
        this.stop(); this.samples = []; this.tasks = []; this.cursor = 0; this.lastFrame = undefined; this.active = true;
        if(typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
            this.observer = new PerformanceObserver(list => {
                this.tasks.push(...list.getEntries().map(entry => entry.duration));
                if(this.tasks.length > this.capacity) this.tasks.splice(0, this.tasks.length - this.capacity);
            });
            this.observer.observe({ type: 'longtask' });
        }
    }
    stop(): void { this.active = false; this.observer?.disconnect(); this.observer = undefined; this.lastFrame = undefined; }
    resetClock(): void { this.lastFrame = undefined; }
    frame(time: number): number | undefined {
        if(!this.active) return;
        const interval = this.lastFrame === undefined ? undefined : time - this.lastFrame;
        this.lastFrame = time; return interval;
    }
    record(sample: PlaybackSample): void {
        if(!this.active) return;
        this.samples[this.cursor++ % this.capacity] = sample;
    }
    report() {
        const timings = (key: 'evaluation' | 'rigs' | 'render' | 'total') => {
            const values = this.samples.map(sample => sample[key]);
            return { p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99), maximum: Math.max(0, ...values) };
        };
        const intervals = this.samples.flatMap(sample => sample.interval === undefined ? [] : [sample.interval]);
        const refreshInterval = this.refreshInterval;
        const missed = refreshInterval ? intervals.reduce((sum, value) => sum + Math.max(0, Math.round(value / refreshInterval) - 1), 0) : undefined;
        return { samples: this.samples.length, evaluation: timings('evaluation'), rigs: timings('rigs'), render: timings('render'), total: timings('total'),
            refreshInterval: refreshInterval ?? null, observedMedianInterval: percentile(intervals, .5), intervalP99: percentile(intervals, .99), missedRefreshes: missed ?? null,
            missedRefreshPercent: missed === undefined ? null : intervals.length ? 100 * missed / (intervals.length + missed) : 0, longTasks: [...this.tasks] };
    }
}
