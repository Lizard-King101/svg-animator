import { Injectable } from "@angular/core";
import { Group } from "../editor/objects/elements/group.object";
import { TextElement } from "../editor/objects/elements/text.object";
import { Line } from "../editor/objects/line.object";
import { Shape } from "../editor/objects/elements/shape.object";
import { Path } from "../editor/objects/elements/path.object";
import { Point } from "../editor/objects/point.object";
import { AnyElement, SVG, SVGSave } from "../editor/objects/svg.object";
import { Tool } from "./tools/tool";

import { Tools } from "./tools/tools";
import { EditorPreferencesService } from "./editor-preferences.service";

@Injectable()
export class EditorService {
    tools: Tool[] = [];
    selectedTool?: Tool;

    svgs: SVG[] = [];
    selectedSVG?: SVG;

    selectedElement?: AnyElement;
    activeElement?: AnyElement;
    selectedPathAnchor?: Point;
    selectedPathLine?: Line;
    selectedPathLines: Line[] = [];
    contextMenu?: EditorContextMenu;

    private viewPort?: HTMLElement;

    settings: any = {
        snapDistance: 5
    }

    keysDown: KeysPressed = {};

    constructor(private preferences: EditorPreferencesService) {
        Tools.forEach((tool) => {
            let t = new tool(this);
            this.tools.push(t);
        })

        const preferredTool = this.findTool(this.preferences.tool);
        if(!preferredTool?.restoreSelection()) {
            this.tools[0]?.restoreSelection();
        }
    }

    rememberSelectedTool(preferenceKey: string) {
        this.preferences.setTool(preferenceKey);
    }

    private findTool(preferenceKey: string): Tool | undefined {
        const findIn = (tools: Tool[]): Tool | undefined => {
            for(const tool of tools) {
                if(tool.preferenceKey === preferenceKey) {
                    return tool;
                }

                const child = findIn(tool.children);
                if(child) {
                    return child;
                }
            }

            return undefined;
        };

        return findIn(this.tools);
    }

    deselectOther(tool: Tool) {
        this.tools.forEach((t) => {
            if(t != tool) {
                t.deselect();
            }
            t.showChildren = false;
        })
    }

    newSVG(width: number, height: number, name?: string) {
        this.selectedElement = undefined;
        this.activeElement = undefined;
        this.selectedPathAnchor = undefined;
        this.selectedPathLine = undefined;
        this.selectedPathLines = [];
        if(this.viewPort != undefined) {
            const position = this.preferences.canvasPosition ?? {
                x: (this.viewPort.clientWidth / 2) - (width / 2),
                y: (this.viewPort.clientHeight / 2) - (height / 2),
            };
            const svg = new SVG(this, {
                width,
                height,
                name,
                zoom: this.preferences.zoom,
                pos: new Point(position.x, position.y)
            });

            this.svgs.push(svg);
            this.selectedSVG = svg;
        }
    }

    loadSVG(save: SVGSave) {
        this.selectedElement = undefined;
        this.activeElement = undefined;
        this.selectedPathAnchor = undefined;
        this.selectedPathLine = undefined;
        this.selectedPathLines = [];
        const vw = this.viewPort?.clientWidth ?? 800;
        const vh = this.viewPort?.clientHeight ?? 600;
        const svg = SVG.fromSave(save, this, vw, vh);
        svg.zoom = this.preferences.zoom;
        const position = this.preferences.canvasPosition;
        if(position) {
            svg.pos = new Point(position.x, position.y);
        }
        this.svgs.push(svg);
        this.selectedSVG = svg;
    }

    setZoom(svg: SVG, zoom: number) {
        svg.zoom = zoom;
        this.preferences.setCanvasView(zoom, svg.pos);
    }

    rememberCanvasView(svg: SVG) {
        this.preferences.setCanvasView(svg.zoom, svg.pos);
    }

    selectSVG(id: string) {
        this.selectedElement = undefined;
        this.activeElement = undefined;
        this.selectedPathAnchor = undefined;
        this.selectedPathLine = undefined;
        this.selectedPathLines = [];
        for(let i = 0; i < this.svgs.length; i++) {
            let s = this.svgs[i];
            if(s.id == id) {
                this.selectedSVG = s;
                continue;
            }
        }
        this.tools.forEach((t) => {
            t.reset();
        })
        if(this.selectedSVG) {
            this.rememberCanvasView(this.selectedSVG);
        }
    }

    closeSVG(id: string) {
        console.log('Close: ', id);
        
        for(let i = 0; i < this.svgs.length; i++) {
            let s = this.svgs[i];
            if(s.id == id) {
                let chooseAnother = this.selectedSVG == s;
                console.log('Choose: ', chooseAnother);
                
                if(this.svgs.length - 1 <= 0) {
                    this.svgs = [];
                    this.selectedSVG = undefined
                    this.selectedElement = undefined;
                    this.activeElement = undefined;
                    this.selectedPathAnchor = undefined;
                    this.selectedPathLine = undefined;
                    this.selectedPathLines = [];
                } else {
                    this.svgs.splice(i, 1);
                    if(chooseAnother) {
                        this.selectedSVG = this.svgs[i] ? this.svgs[i] : this.svgs[i - 1];
                        this.selectedElement = undefined;
                        this.activeElement = undefined;
                        this.selectedPathAnchor = undefined;
                        this.selectedPathLine = undefined;
                        this.selectedPathLines = [];
                    }
                }
                console.log(this.svgs);
                
                continue;
            }
        }
        if(this.selectedSVG) {
            this.rememberCanvasView(this.selectedSVG);
        }
    }

    setViewPort(viewPortElement: HTMLElement) {
        this.viewPort = viewPortElement;
    }

    toCanvasPoint(x: number, y: number): Point;
    toCanvasPoint(point: Point): Point;
    toCanvasPoint(xOrPoint: Point|number, y?: number): Point {
        let point: Point;
        if(y != null) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                point = new Point(x,y);
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            if(xOrPoint instanceof Point) {
                point = xOrPoint;
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
        if(this.viewPort && this.selectedSVG) {
            let canvas: HTMLElement = <HTMLElement>this.viewPort.firstChild
            let rect = canvas.getBoundingClientRect();
            let p = new Point(
                +((point.x - rect.left) / this.selectedSVG.zoom).toFixed(2),
                +((point.y - rect.top)  / this.selectedSVG.zoom).toFixed(2)
            );
            return p;
        }
        return point;
    }

    toViewportPoint(x: number, y: number): Point;
    toViewportPoint(point: Point): Point;
    toViewportPoint(xOrPoint: Point|number, y?: number): Point {
        let point: Point;
        if(y != null) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                point = new Point(x,y);
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            if(xOrPoint instanceof Point) {
                point = xOrPoint;
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
        if(this.viewPort) {
            return point.subtract(this.viewPort.offsetLeft, this.viewPort.offsetTop);
        } else return point;
    }

    elementIsPath(element: any): boolean {
        return element instanceof Path;
    }

    elementIsShape(element: any): boolean {
        return element instanceof Shape;
    }

    elementIsText(element: any): boolean {
        return element instanceof TextElement;
    }

    shapeIsRectangle(element: any): boolean {
        return element instanceof Shape && element.type == 'rectangle';
    }

    shapeIsEllipse(element: any): boolean {
        return element instanceof Shape && element.type == 'ellipse';
    }

    toolType() {

    }

    findElement(id: string): AnyElement | false {
        if(this.selectedSVG) {
            const foundElement = this.findElementInList(this.selectedSVG.elements, id);
            if(foundElement) return foundElement;
            for(let element of this.selectedSVG.tempElements) {
                if(element.id == id) {
                    return element;
                }
            }
            return false;
        } else {
            return false;
        }
    }

    removeElement(id: string) {
        if(this.selectedSVG) {
            this.removeElementFromList(this.selectedSVG.elements, id);
            for(let i = 0; i < this.selectedSVG.tempElements.length; i++) {
                if(this.selectedSVG.tempElements[i].id == id) {
                    this.selectedSVG.tempElements.splice(i, 1);
                }
            }
        }
    }

    private findElementInList(elements: AnyElement[], id: string): AnyElement | undefined {
        for(const element of elements) {
            if(element.id == id) {
                return element;
            }

            if(element instanceof Group && element.visible && !element.locked) {
                const found = this.findElementInList(element.elements, id);
                if(found) {
                    return found;
                }
            }
        }

        return undefined;
    }

    private groupContainsElement(group: Group, id: string): boolean {
        return group.elements.some((element) => {
            if(element.id == id) {
                return true;
            }

            return element instanceof Group && this.groupContainsElement(element, id);
        });
    }

    private removeElementFromList(elements: AnyElement[], id: string): boolean {
        for(let i = 0; i < elements.length; i++) {
            const element = elements[i];
            if(element.id == id) {
                elements.splice(i, 1);
                return true;
            }

            if(element instanceof Group && this.removeElementFromList(element.elements, id)) {
                return true;
            }
        }

        return false;
    }

    openContextMenu(x: number, y: number, items: EditorContextMenuItem[]) {
        this.contextMenu = {
            x,
            y,
            items,
        };
    }

    closeContextMenu() {
        this.contextMenu = undefined;
    }

    runContextMenuItem(item: EditorContextMenuItem) {
        if(!item.action) {
            return;
        }

        item.action();
        this.closeContextMenu();
    }

    keyPressed(key: string) {
        this.keysDown[key] = true;
        this.selectedTool?.keyPressed(key);
    }

    keyReleased(key: string) {
        delete this.keysDown[key];
        this.selectedTool?.keyReleased(key);
    }

    get inspectedElement() {
        return this.selectedElement ?? this.activeElement;
    }

    get ID() {
        return Math.random().toString(36).substr(2, 9);
    }
}

export interface Color {
    r: number;
    g: number;
    b: number;
}

interface KeysPressed {
    [key:string]: boolean;
}

export interface EditorContextMenu {
    x: number;
    y: number;
    items: EditorContextMenuItem[];
    infoTitle?: string;
    infoLines?: string[];
}

export interface EditorContextMenuItem {
    label: string;
    shortcut?: string;
    action?: () => void;
    children?: EditorContextMenuItem[];
}
