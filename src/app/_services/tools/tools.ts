import { Paths } from "./paths.tool";
import { SelectTool } from "./select.tool";
import { Shapes } from "./shape.tool";
import { TextTool } from "./text.tool";
import { Tool } from "./tool";
import { CropTool } from "./crop.tool";

export const Tools: Array<typeof Tool> = [
    SelectTool,
    Paths,
    Shapes,
    TextTool,
    CropTool,
]
