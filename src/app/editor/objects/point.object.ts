
export interface PointSave {
    id: string;
    x: number;
    y: number;
}

export class Point {
    id: string;
    x: number;
    y: number;

    constructor(x: number, y: number, id?: string) {
        this.id = id ?? Math.random().toString(36).substr(2, 9);
        this.x = x;
        this.y = y;
    }

    toSave(): PointSave {
        return { id: this.id, x: this.x, y: this.y };
    }

    static fromSave(s: PointSave): Point {
        return new Point(s.x, s.y, s.id);
    }

    distanceFrom(x: number, y: number): number;
    distanceFrom(point: Point): number;
    distanceFrom(xOrPoint: Point|number, y?: number): number {
        if(y) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                let a = this.x - x;
                let b = this.y - y;
                return Math.sqrt(a*a + b*b);
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            let point = xOrPoint;
            if(point instanceof Point) {
                let a = this.x - point.x;
                let b = this.y - point.y;
                return Math.sqrt(a*a + b*b);
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
    }

    add(x: number, y: number): Point;
    add(point: Point): Point;
    add(xOrPoint: Point|number, y?: number): Point {
        if(y != null) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                return new Point(this.x + x, this.y + y);
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            let point = xOrPoint;
            if(point instanceof Point) {
                return new Point(this.x + point.x, this.y + point.y);
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
    }

    addTo(x: number, y: number): void;
    addTo(point: Point): void;
    addTo(xOrPoint: Point|number, y?: number): void {
        if(y != null) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                this.x += x
                this.y += y
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            let point = xOrPoint;
            if(point instanceof Point) {
                this.x += point.x;
                this.y += point.y;
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
    }

    subtract(x: number, y: number): Point;
    subtract(point: Point): Point;
    subtract(xOrPoint: Point|number, y?: number): Point {
        if(y != null) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                return new Point(this.x - x, this.y - y);
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            let point = xOrPoint;
            if(point instanceof Point) {
                return new Point(this.x - point.x, this.y - point.y);
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
    }

    subtractTo(x: number, y: number): void;
    subtractTo(point: Point): void;
    subtractTo(xOrPoint: Point|number, y?: number): void {
        if(y != null) {
            let x = xOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                this.x -= x;
                this.y -= y;
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            let point = xOrPoint;
            if(point instanceof Point) {
                this.x -= point.x;
                this.y -= point.y;
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
    }

    divide(devisor: number): Point;
    divide(x: number, y: number): Point;
    divide(point: Point): Point;
    divide(divOrXOrPoint: Point|number, y?: number): Point {
        if(y != null) {
            let x = divOrXOrPoint;
            if(typeof x == 'number' && typeof y == 'number') {
                return new Point(this.x / x, this.y / y);
            } else {
                throw new Error('Mis match of x y types');
            }
        } else {
            if(divOrXOrPoint instanceof Point) {
                let point = divOrXOrPoint;
                return new Point(this.x / point.x, this.y / point.y);
            } else if(typeof divOrXOrPoint == 'number'){
                let divisor  = divOrXOrPoint;
                return new Point(this.x / divisor, this.y / divisor);
            } else {
                throw new Error('Mis match type or missing argument');
            }
        }
    }
}