import { BenchmarkRun } from '../../../../scripts/renderer-lab/benchmark-run';

describe('renderer benchmark lifetime', () => {
    it('bounds sample storage and accepts extended runs', () => {
        for(const count of [NaN, 29, 7201, 30.5]) expect(() => new BenchmarkRun(count)).toThrowError(/samples/);
        const run = new BenchmarkRun(7200); expect(run.samples).toBe(7200); run.dispose();
    });
    it('cancels a pending frame and rejects further samples', async () => {
        const run = new BenchmarkRun(30), cancel = spyOn(window, 'cancelAnimationFrame').and.callThrough();
        const frame = run.frame(); run.cancel();
        await expectAsync(frame).toBeRejectedWithError(/cancelled/);
        expect(cancel).toHaveBeenCalled(); expect(() => run.frame()).toThrowError(/cancelled/); run.dispose();
    });
    it('stops on hidden-tab transitions and removes its visibility listener', () => {
        const hidden = spyOnProperty(document, 'hidden', 'get').and.returnValue(false);
        const remove = spyOn(document, 'removeEventListener').and.callThrough(), run = new BenchmarkRun(30);
        hidden.and.returnValue(true); document.dispatchEvent(new Event('visibilitychange'));
        expect(() => run.check()).toThrowError(/hidden/); run.dispose();
        expect(remove).toHaveBeenCalledWith('visibilitychange', jasmine.any(Function));
    });
    it('cancels a GPU drain wait immediately and safely consumes its later rejection', async () => {
        const run = new BenchmarkRun(30);
        let reject!: (error: Error) => void;
        const work = new Promise<void>((_, fail) => reject = fail), waiting = run.wait(work);
        run.cancel(); await expectAsync(waiting).toBeRejectedWithError(/cancelled/);
        reject(new Error('Late device failure')); await Promise.resolve(); run.dispose();
    });
});
