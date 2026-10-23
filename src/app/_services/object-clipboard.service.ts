import { Injectable } from '@angular/core';
import { ObjectClipboardFragment } from '../editor/object-clipboard';

/** App-session clipboard survives editor routes without retaining live document objects. */
@Injectable({ providedIn: 'root' })
export class ObjectClipboardService {
    fragment?: ObjectClipboardFragment;
    pasteCount = 0;

    set(fragment: ObjectClipboardFragment): void { this.fragment = fragment; this.pasteCount = 0; }
}
