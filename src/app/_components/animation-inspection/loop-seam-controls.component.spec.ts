import { LoopSeamControlsComponent } from './loop-seam-controls.component';
import { TimelineEditorService } from '../../_services/timeline-editor.service';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { AnimationInspectionService } from '../../_services/animation-inspection.service';
import { AnimationTrack, createDefaultAnimation } from '../../editor/objects/animation.object';

describe('LoopSeamControlsComponent', () => {
    function setup() {
        const makeTrack = (id: string, property: string): AnimationTrack => ({
            id, property, targetId: 'shape', valueType: 'number',
            keyframes: [{ id: `${id}-start`, time: 0, value: 10 }, { id: `${id}-end`, time: 1, value: 20 }],
        });
        const x = makeTrack('x', 'transform.scaleX'), y = makeTrack('y', 'transform.scaleY');
        const offset = makeTrack('offset', 'transform.translateX');
        const timeline = {
            activeAnimation: { ...createDefaultAnimation(), tracks: [x, y, offset] },
            selectedKeyframeIds: new Set<string>(), selectedGraphProperty: 'transform.scale',
            graphTracks: () => [{ track: x }],
            animation: { allowsTarget: () => true, workArea: { start: 0, end: 1 }, currentTime: 0,
                pause: jasmine.createSpy('pause'), invalidate: jasmine.createSpy('invalidate'), previewAt: jasmine.createSpy('previewAt') },
        } as unknown as TimelineEditorService;
        const mutate = jasmine.createSpy('mutate').and.callFake((callback: () => void) => callback());
        const component = new LoopSeamControlsComponent(timeline, { mutate } as unknown as DocumentMutationService, {} as AnimationInspectionService);
        return { component, timeline, x, y, offset, mutate };
    }

    it('links both channels of the displayed uniform scale curve in one mutation', () => {
        const { component, x, y, offset, mutate } = setup();
        component.link();
        expect(x.loopSeam).toBeDefined();
        expect(y.loopSeam).toBeDefined();
        expect(offset.loopSeam).toBeUndefined();
        expect(x.keyframes[1].value).toBe(10);
        expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('uses selected keys ahead of a previously displayed scale curve', () => {
        const { component, timeline, offset, x, y } = setup();
        timeline.selectedKeyframeIds.add(offset.keyframes[0].id);
        component.source = 'end';
        component.link();
        expect(offset.keyframes[0].value).toBe(20);
        expect(offset.loopSeam).toBeDefined();
        expect(x.loopSeam).toBeUndefined();
        expect(y.loopSeam).toBeUndefined();
    });

    it('unlinks without changing the authored keys', () => {
        const { component, x, y } = setup();
        component.link();
        const keys = JSON.stringify([x.keyframes, y.keyframes]);
        component.unlink();
        expect(component.linkedCount).toBe(0);
        expect(JSON.stringify([x.keyframes, y.keyframes])).toBe(keys);
    });
});
