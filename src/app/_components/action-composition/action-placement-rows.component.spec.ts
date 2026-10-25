import { ActionPlacementRowsComponent } from './action-placement-rows.component';

describe('placement timing fields', () => {
    it('commits on blur, cancels with Escape, and rejects blank fields without coercing them to zero', () => {
        const placement = { id: 'p', actionId: 'a', start: 1, rate: 2 };
        const actions = { action: () => ({ name: 'Move', animation: { duration: 3 } }),
            retime: jasmine.createSpy(), move: jasmine.createSpy() };
        const component = new ActionPlacementRowsComponent(actions as never, {} as never);
        const input = document.createElement('input'); input.type = 'number';
        input.value = '4';
        const event = { target: input } as unknown as Event;
        component.change(placement, 'rate', event);
        expect(actions.retime).toHaveBeenCalledWith(placement, { rate: 4 }); expect(input.value).toBe('2');
        actions.retime.calls.reset(); input.value = '9';
        component.key(placement, 'rate', { target: input, key: 'Escape', preventDefault: () => {}, stopPropagation: () => {} } as unknown as KeyboardEvent);
        component.change(placement, 'rate', event); expect(actions.retime).not.toHaveBeenCalled();
        input.value = ''; component.change(placement, 'sourceStart', event);
        expect(actions.retime).toHaveBeenCalledWith(placement, { sourceStart: NaN });
    });
});
