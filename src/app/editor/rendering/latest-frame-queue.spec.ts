import { FrameToken, LatestFrameQueue } from './latest-frame-queue';

describe('latest frame delivery', () => {
    let sent: { token: FrameToken; time: number }[], queue: LatestFrameQueue<number, number>;
    beforeEach(() => { sent = []; queue = new LatestFrameQueue(7, (token, time) => sent.push({ token, time })); });
    it('bounds previews to one in flight and one latest pending sample', async () => {
        const first = queue.request(0), skipped = queue.request(1), latest = queue.request(2.12345);
        expect(sent.length).toBe(1); expect(await skipped).toBeUndefined();
        queue.complete(sent[0].token, 0);
        expect(sent.map(item => item.time)).toEqual([0, 2.12345]);
        queue.complete(sent[1].token, 2.12345);
        expect(await first).toBe(0); expect(await latest).toBe(2.12345);
    });
    it('keeps final delivery as an acknowledged barrier', async () => {
        const first = queue.request(0), skipped = queue.request(1), final = queue.request(.87654321, true);
        expect(await skipped).toBeUndefined();
        await expectAsync(queue.request(4)).toBeRejectedWithError('Final frame is pending.');
        queue.complete(sent[0].token, 0); await first;
        expect(sent[1].time).toBe(.87654321);
        queue.complete(sent[1].token, .87654321); expect(await final).toBe(.87654321);
    });
    it('ignores old generation and duplicate responses without advancing the queue', async () => {
        const first = queue.request(1), second = queue.request(2);
        queue.complete({ generation: 6, id: 1 }, 99); queue.complete({ generation: 7, id: 999 }, 99);
        expect(sent.length).toBe(1);
        queue.complete(sent[0].token, 1); queue.complete(sent[0].token, 99);
        expect(sent.length).toBe(2);
        queue.complete(sent[1].token, 2); expect(await first).toBe(1); expect(await second).toBe(2);
    });
    it('cancels queued and sent delivery, then allows an exact restoration frame', async () => {
        const first = queue.request(1), final = queue.request(2, true); queue.cancel();
        expect(await first).toBeUndefined(); expect(await final).toBeUndefined();
        const restore = queue.request(0, true);
        queue.complete(sent[0].token, 1); expect(sent[1].time).toBe(0);
        queue.complete(sent[1].token, 0); expect(await restore).toBe(0);
    });
    it('rejects pending work on failure and never dispatches again', async () => {
        const first = queue.request(1), next = queue.request(2); queue.fail(new Error('device lost'));
        await expectAsync(first).toBeRejectedWithError('device lost'); await expectAsync(next).toBeRejectedWithError('device lost');
        await expectAsync(queue.request(3)).toBeRejectedWithError('device lost');
        queue.complete(sent[0].token, 1); expect(sent.length).toBe(1);
    });
    it('settles a synchronous transport failure', async () => {
        const failed = new LatestFrameQueue<number, number>(1, () => { throw new Error('closed'); });
        await expectAsync(failed.request(0)).toBeRejectedWithError('closed');
    });
});
