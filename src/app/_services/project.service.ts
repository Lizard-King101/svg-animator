import { Injectable } from '@angular/core';
import { SVGSave } from '../editor/objects/svg.object';
import {
    migrateProjectDatabase,
    ProjectDatabaseV1,
    runtimeProjects,
    storeRuntimeProjects,
} from '../editor/migrations/document-migrations';

export interface ProjectRecord {
    id: string;
    name: string;
    thumbnail: string;
    createdAt: number;
    updatedAt: number;
    svgData: SVGSave;
}

const DEFAULT_PROJECT = [
    { "id": "98a1xamfr", "name": "Banner", "thumbnail": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"100\" viewBox=\"0 0 1200 100\">\n  <path d=\"M  -2.49 59.73 C 192.91 37.209999999999994 645.42 18.749999999999996 832.15 41 C 1018.88 63.25 969.1499999999999 74.57000000000001 1202.04 68.92\" fill=\"none\" stroke=\"#40405e\" stroke-width=\"50\"/>\n  <path d=\"M  -1.8399999999999992 70.9 C 189.99000000000004 68.07999999999996 408.9099999999999 77.30000000000001 626.67 65.94000000000003 C 844.43 54.57999999999999 879.5600000000002 26.400000000000006 1200.43 27.74\" fill=\"none\" stroke=\"#535379\" stroke-width=\"50\" stroke-linecap=\"round\"/>\n  <path d=\"M  -4.959999999999913 20.409999999999993 C 89.09000000000007 15.279999999999983 285.41000000000054 27.830000000000013 481.86000000000007 57.33 C 678.3099999999996 86.82999999999998 967.4766666666668 82.52 1203.26 84.27\" fill=\"none\" stroke=\"#4a4a6d\" stroke-width=\"30\"/>\n  <text x=\"375.32000000000005\" y=\"22.4\" font-size=\"64\" font-family=\"system-ui\" font-weight=\"800\" fill=\"#ffffff\" dominant-baseline=\"hanging\">\n    <tspan>SVG Animator</tspan>\n  </text>\n</svg>", "createdAt": 1776447802728, "updatedAt": 1776450663397, "svgData": { "id": "98a1xamfr", "name": "Banner", "elements": [{ "type": "path", "id": "7hmkprd2b", "name": "Path 7hmk", "visible": true, "locked": false, "closed": false, "settings": { "stroke_width": 50, "fill_enabled": false, "fill": "#ff0000", "stroke": "#40405e", "line_cap": null, "line_join": null }, "lines": [{ "id": "pz1rmvg8v", "type": "bezier", "points": [{ "id": "z479ezoos", "x": -2.49, "y": 59.73 }, { "id": "ggztfim0k", "x": 832.15, "y": 41 }], "controlStart": { "id": "cbwkhsr9h", "x": 192.91, "y": 37.209999999999994 }, "controlEnd": { "id": "dctilsgx3", "x": 645.42, "y": 18.749999999999996 } }, { "id": "xramfpn47", "type": "bezier", "points": [{ "id": "ggztfim0k", "x": 832.15, "y": 41 }, { "id": "ycxfkf22z", "x": 1202.04, "y": 68.92 }], "controlStart": { "id": "n7lm8lc3i", "x": 1018.88, "y": 63.25 }, "controlEnd": { "id": "vq9zz7l95", "x": 969.1499999999999, "y": 74.57000000000001 } }] }, { "type": "path", "id": "9megh1rqj", "name": "Path 9meg", "visible": true, "locked": false, "closed": false, "settings": { "stroke_width": 50, "fill_enabled": false, "fill": "#ff0000", "stroke": "#535379", "line_cap": "round", "line_join": null }, "lines": [{ "id": "0m5d5m7fl", "type": "bezier", "points": [{ "id": "gsvvjipxb", "x": -1.8399999999999992, "y": 70.9 }, { "id": "fwab2y6yl", "x": 626.67, "y": 65.94000000000003 }], "controlStart": { "id": "6efi2ruk2", "x": 189.99000000000004, "y": 68.07999999999996 }, "controlEnd": { "id": "hfbl5vhxg", "x": 408.9099999999999, "y": 77.30000000000001 } }, { "id": "5d4jir6rq", "type": "bezier", "points": [{ "id": "fwab2y6yl", "x": 626.67, "y": 65.94000000000003 }, { "id": "1181hxjgk", "x": 1200.43, "y": 27.74 }], "controlStart": { "id": "zuckt28nw", "x": 844.43, "y": 54.57999999999999 }, "controlEnd": { "id": "fk01tzd56", "x": 879.5600000000002, "y": 26.400000000000006 } }] }, { "type": "path", "id": "5txqaq244", "name": "Path 5txq", "visible": true, "locked": false, "closed": false, "settings": { "stroke_width": 30, "fill_enabled": false, "fill": "#ff0000", "stroke": "#4a4a6d", "line_cap": null, "line_join": null }, "lines": [{ "id": "d57yc6gbu", "type": "bezier", "points": [{ "id": "1sxccphld", "x": -4.959999999999913, "y": 20.409999999999993 }, { "id": "5cb21uy1z", "x": 481.86000000000007, "y": 57.33 }], "controlStart": { "id": "jap5sta1b", "x": 89.09000000000007, "y": 15.279999999999983 }, "controlEnd": { "id": "fi5x41ci7", "x": 285.41000000000054, "y": 27.830000000000013 } }, { "id": "65j0u0e73", "type": "bezier", "points": [{ "id": "5cb21uy1z", "x": 481.86000000000007, "y": 57.33 }, { "id": "taowvhasp", "x": 1203.26, "y": 84.27 }], "controlStart": { "id": "smfkwse8f", "x": 678.3099999999996, "y": 86.82999999999998 }, "controlEnd": { "id": "7tc9ejut3", "x": 967.4766666666668, "y": 82.52 } }] }, { "type": "text", "id": "wn0qc9obt", "name": "Text wn0q", "visible": true, "locked": false, "position": { "id": "pl8azeqqm", "x": 375.32000000000005, "y": 22.4 }, "settings": { "content": "SVG Animator", "font_family": "system-ui", "font_size": 64, "font_weight": "800", "text_align": "start", "color": "#ffffff" } }], "width": 1200, "height": 100 } },
     { "id": "m23lvh511", "name": "favicon", "thumbnail": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"500\" height=\"500\" viewBox=\"0 0 500 500\">\n  <rect x=\"23.010000000000005\" y=\"25.08\" width=\"450\" height=\"450\" rx=\"60\" ry=\"60\" fill=\"#0f172a\" stroke=\"#2dd4bf\" stroke-width=\"0\"/>\n  <path d=\"M  82.15000000000008 475.2500000000001 L 246.49000000000007 475.06000000000006 C 202.6500000000001 375.26333333333343 181.87666666666684 306.21000000000004 222.9600000000001 252.63000000000005 C 264.04333333333335 199.05000000000007 368.3766666666667 210.03999999999996 473.09000000000003 246.55 L 473.01000000000005 93.14 C 361.7466666666668 57.93999999999999 194.1333333333335 42.923333333333304 113.77000000000008 129.34 C 33.40666666666669 215.75666666666677 35.49333333333341 362.85333333333347 82.15000000000008 475.2500000000001 Z\" fill=\"#71e3f4\" stroke=\"#cecece\" stroke-width=\"0\"/>\n  <ellipse cx=\"182.70000000000002\" cy=\"195.68999999999997\" rx=\"125\" ry=\"125\" fill=\"#f8fafc\" stroke=\"#0f172a\" stroke-width=\"50\"/>\n</svg>", "createdAt": 1776364616842, "updatedAt": 1776454407908, "svgData": { "id": "m23lvh511", "name": "favicon", "elements": [{ "type": "shape", "id": "i6rt39ue5", "name": "background", "visible": true, "locked": true, "shapeType": "rectangle", "position": { "id": "yrudpg9fr", "x": 23.010000000000005, "y": 25.08 }, "settings": { "width": 450, "height": 450, "stroke_width": 0, "stroke": "#2dd4bf", "fill": "#0f172a", "corner_radius": 60 } }, { "type": "path", "id": "vqly05kte", "name": "path", "visible": true, "locked": false, "closed": true, "settings": { "stroke_width": 0, "fill_enabled": true, "fill": "#71e3f4", "stroke": "#cecece", "line_cap": null, "line_join": null }, "lines": [{ "id": "vgy5thpz3", "type": "line", "points": [{ "id": "3jxk4mg2a", "x": 82.15000000000008, "y": 475.2500000000001 }, { "id": "xxtwc73z1", "x": 246.49000000000007, "y": 475.06000000000006 }] }, { "id": "fatz95pwo", "type": "bezier", "points": [{ "id": "xxtwc73z1", "x": 246.49000000000007, "y": 475.06000000000006 }, { "id": "0qk6s4dnq", "x": 222.9600000000001, "y": 252.63000000000005 }], "controlStart": { "id": "dk5u4unz7", "x": 202.6500000000001, "y": 375.26333333333343 }, "controlEnd": { "id": "w0xv8ph6o", "x": 181.87666666666684, "y": 306.21000000000004 } }, { "id": "k9jwg06r7", "type": "bezier", "points": [{ "id": "0qk6s4dnq", "x": 222.9600000000001, "y": 252.63000000000005 }, { "id": "5trd4ksse", "x": 473.09000000000003, "y": 246.55 }], "controlStart": { "id": "1og57zpg1", "x": 264.04333333333335, "y": 199.05000000000007 }, "controlEnd": { "id": "8rtc25n70", "x": 368.3766666666667, "y": 210.03999999999996 } }, { "id": "b2ac318g2", "type": "line", "points": [{ "id": "5trd4ksse", "x": 473.09000000000003, "y": 246.55 }, { "id": "b4drb3nbm", "x": 473.01000000000005, "y": 93.14 }] }, { "id": "ut4fbwanz", "type": "bezier", "points": [{ "id": "b4drb3nbm", "x": 473.01000000000005, "y": 93.14 }, { "id": "069zwkgjq", "x": 113.77000000000008, "y": 129.34 }], "controlStart": { "id": "m1xwh8b1b", "x": 361.7466666666668, "y": 57.93999999999999 }, "controlEnd": { "id": "nr2bp9en3", "x": 194.1333333333335, "y": 42.923333333333304 } }, { "id": "6pnmyfn6b", "type": "bezier", "points": [{ "id": "069zwkgjq", "x": 113.77000000000008, "y": 129.34 }, { "id": "3jxk4mg2a", "x": 82.15000000000008, "y": 475.2500000000001 }], "controlStart": { "id": "3j3dxtkst", "x": 33.40666666666669, "y": 215.75666666666677 }, "controlEnd": { "id": "x5xunp6o9", "x": 35.49333333333341, "y": 362.85333333333347 } }] }, { "type": "shape", "id": "36zc94x54", "name": "anchor", "visible": true, "locked": false, "shapeType": "ellipse", "position": { "id": "4fkpki5e5", "x": 57.70000000000002, "y": 70.68999999999997 }, "settings": { "width": 250, "height": 250, "stroke_width": 50, "stroke": "#0f172a", "fill": "#f8fafc", "corner_radius": 0 } }], "width": 500, "height": 500 } }] as Array<ProjectRecord>;

export const PROJECT_STORAGE_KEY = 'svg-animator-projects';

@Injectable({ providedIn: 'root' })
export class ProjectService {

    constructor() {
        const stored = this.readStorage();
        if(stored.status === 'ok' && stored.migrated) {
            this.writeDatabase(stored.database);
        }
        if (stored.status === 'missing' || (stored.status === 'ok' && stored.database.projects.length === 0)) {
            DEFAULT_PROJECT.forEach((proj) => {
                this.upsert(proj.svgData, proj.thumbnail);
            })
        }
    }

    list(): ProjectRecord[] {
        const stored = this.readStorage();
        if(stored.status !== 'ok') {
            return [];
        }
        if(stored.migrated) this.writeDatabase(stored.database);
        return runtimeProjects(stored.database);
    }

    get(id: string): ProjectRecord | null {
        return this.list().find(p => p.id === id) ?? null;
    }

    upsert(svgData: SVGSave, thumbnail: string): void {
        const projects = this.mutableProjects();
        if(!projects) return;
        const idx = projects.findIndex(p => p.id === svgData.id);
        const now = Date.now();
        const record: ProjectRecord = {
            id: svgData.id,
            name: svgData.name,
            thumbnail,
            createdAt: idx >= 0 ? projects[idx].createdAt : now,
            updatedAt: now,
            svgData,
        };
        if (idx >= 0) {
            projects[idx] = record;
        } else {
            projects.unshift(record);
        }
        this.writeDatabase(storeRuntimeProjects(projects));
    }

    remove(id: string): void {
        const existing = this.mutableProjects();
        if(!existing) return;
        const projects = existing.filter(p => p.id !== id);
        this.writeDatabase(storeRuntimeProjects(projects));
    }

    private mutableProjects(): ProjectRecord[] | null {
        const stored = this.readStorage();
        if(stored.status === 'missing') return [];
        if(stored.status !== 'ok') return null;
        return runtimeProjects(stored.database);
    }

    private readStorage(): StorageReadResult {
        const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
        if(raw == null) return { status: 'missing' };
        try {
            const migrated = migrateProjectDatabase(JSON.parse(raw));
            if(migrated.status !== 'ok') {
                return { status: migrated.status };
            }
            return {
                status: 'ok',
                database: migrated.value,
                migrated: migrated.migrated,
            };
        } catch {
            return { status: 'invalid' };
        }
    }

    private writeDatabase(database: ProjectDatabaseV1): void {
        try {
            localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(database));
        } catch {
            // Storage can be unavailable or full. The in-memory editor remains usable.
        }
    }
}

type StorageReadResult = {
    status: 'ok';
    database: ProjectDatabaseV1;
    migrated: boolean;
} | {
    status: 'missing' | 'invalid' | 'unsupported';
};
