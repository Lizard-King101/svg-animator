import { Color } from "../../editor/objects/color.object";
import { GradientKind, GradientPaint, GradientSpreadMethod, GradientUnits } from "../../editor/objects/paint.object";
import { GradientPreset } from "../../_services/gradient-preset.service";

export interface PaintEditorCapabilities {
    mode: boolean;
    presets: boolean;
    metadata: boolean;
    stopStructure: boolean;
}

export const FULL_PAINT_EDITOR_CAPABILITIES: PaintEditorCapabilities = {
    mode: true,
    presets: true,
    metadata: true,
    stopStructure: true,
};

export const SOLID_ONLY_PAINT_EDITOR_CAPABILITIES: PaintEditorCapabilities = {
    mode: false,
    presets: false,
    metadata: false,
    stopStructure: false,
};

export const GRADIENT_STOPS_PAINT_EDITOR_CAPABILITIES: PaintEditorCapabilities = {
    mode: false,
    presets: false,
    metadata: false,
    stopStructure: false,
};

export type PaintEditorChange =
    | { type: "solid-color"; color: Color }
    | { type: "mode"; mode: "solid" | "gradient"; selectedStopId?: string }
    | { type: "kind"; kind: GradientKind }
    | { type: "metadata"; field: "units"; value: GradientUnits }
    | { type: "metadata"; field: "spreadMethod"; value: GradientSpreadMethod }
    | { type: "stop"; stopId: string; field: "color"; value: Color }
    | { type: "stop"; stopId: string; field: "offset" | "opacity"; value: number }
    | { type: "add-stop"; stopId: string }
    | { type: "remove-stop"; stopId: string }
    | { type: "apply-preset"; preset: GradientPreset }
    | { type: "save-preset"; gradient: GradientPaint }
    | { type: "delete-preset"; presetId: string };
