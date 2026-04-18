import { PenTool } from "./pen.tool";
import { SelectTool } from "./select.tool";
import { Shapes } from "./shape.tool";
import { TextTool } from "./text.tool";
import { Tool } from "./tool";

export const Tools: Array<typeof Tool> = [
    SelectTool,
    PenTool,
    Shapes,
    TextTool,
]