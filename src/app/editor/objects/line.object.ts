import { EditorService } from "src/app/_services/editor.service";
import { Point, PointSave } from "./point.object";

export interface LineSave {
    id: string;
    type: 'line' | 'bezier';
    points: PointSave[];
    controlStart?: PointSave;
    controlEnd?: PointSave;
}

export class Line {
    id: string;
    type: 'line' | 'bezier';
    points: Point[] = [];
    controlStart?: Point;
    controlEnd?: Point;

    constructor(private editor: EditorService, options?: LineOptions) {
        this.id = this.editor.ID;
        if(options) {
            this.type = options.type ? options.type : 'line';
            this.points = options.points ? options.points : [];
            this.controlStart = options.controlStart;
            this.controlEnd = options.controlEnd;
        } else {
            this.type = 'line';
        }
    }

    toSave(): LineSave {
        return {
            id: this.id,
            type: this.type,
            points: this.points.map((p) => p.toSave()),
            controlStart: this.controlStart?.toSave(),
            controlEnd: this.controlEnd?.toSave(),
        };
    }

    static fromSave(
        s: LineSave,
        editor: EditorService,
        resolvePoint: (ps: PointSave) => Point = Point.fromSave
    ): Line {
        const l = new Line(editor, {
            type: s.type,
            points: s.points.map(resolvePoint),
            controlStart: s.controlStart ? resolvePoint(s.controlStart) : undefined,
            controlEnd: s.controlEnd ? resolvePoint(s.controlEnd) : undefined,
        });
        (l as any).id = s.id;
        return l;
    }

    /*
    *   finds the angle of two connected Lines
    */
    angleBetween(line: Line): number {
        if(line.points.length == 2 && this.points.length == 2 && line.type == 'line' && this.type == 'line') {
            let c = this.getSharedPoint(line);
            if(c) {
                return this.getAngle(c) - line.getAngle(c);
            } else return 0;
        } else return 0;

    }

    /*
    *   Finds the shared point of two lines weather its the same reference point or same x,y point
    */
    getSharedPoint(line: Line): Point | false {
        for(let p of this.points) {
            for(let lp of line.points) {
                if(p == lp || (p.x == lp.x && p.y == lp.y)) {
                    return p;
                }
            }
        }
        return false;
    }

    /*
    *   Gets the angle of the line
    *   if a point is provided that the line includes it will use that point as the subtractor
    */
    getAngle(point?: Point): number {
        if(this.type == 'line' && this.points.length == 2) {
            let points = this.points;
            if(point) {
                let p = this.points[0]
                if(p == point || (p.x == point.x && p.y == point.y)) points = [...this.points].reverse();
            }
            let dx = points[0].x - points[1].x;
            let dy = points[0].y - points[1].y;
            return Math.atan2(dy, dx);
        } else return 0;
    }
}

export interface LineOptions {
    type?: 'line' | 'bezier';
    points?: Point[];
    controlStart?: Point;
    controlEnd?: Point;
}
