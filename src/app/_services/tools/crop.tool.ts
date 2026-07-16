import { IconName } from "@fortawesome/fontawesome-common-types";
import { EditorService } from "../editor.service";
import { Tool } from "./tool";

/** Palette activator only; CanvasCropService owns the staged interaction. */
export class CropTool extends Tool {
    override readonly preferenceKey = "crop";
    override icon: IconName = "crop-simple";

    constructor(editor: EditorService) { super(editor); }
}
