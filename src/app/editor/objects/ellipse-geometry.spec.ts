import { EllipseQueryTarget, ellipseTangentContacts, ellipsePerpendicularContacts, nearestEllipseContact, tangentAlignedHandle, ellipseCommonTangents } from './ellipse-geometry';
import { PathGeometryQuery } from './path-geometry-query';

const circle: EllipseQueryTarget = { id: 'circle', label: 'Circle', center: { x: 0, y: 0 },
    axisX: { x: 50, y: 0 }, axisY: { x: 0, y: 50 } };

describe('native ellipse tangent contacts', () => {
    it('returns both exact tangents to a circle without cubic approximation', () => {
        const origin = { x: 100, y: 0 }, contacts = ellipseTangentContacts(circle, origin);
        expect(contacts.length).toBe(2);
        for(const contact of contacts) {
            expect(contact.x).toBeCloseTo(25, 9); expect(Math.abs(contact.y)).toBeCloseTo(25 * Math.sqrt(3), 9);
            expect(Math.hypot(contact.x, contact.y)).toBeCloseTo(50, 9);
            expect(contact.x * (origin.x - contact.x) + contact.y * (origin.y - contact.y)).toBeCloseTo(0, 8);
        }
        expect(contacts[0].y * contacts[1].y).toBeLessThan(0);
    });

    it('preserves tangency for reflected, rotated, sheared and nonuniformly scaled ellipses', () => {
        const ellipse = { ...circle, center: { x: 100000, y: -80000 }, axisX: { x: -90, y: 40 }, axisY: { x: 20, y: 35 } };
        const origin = { x: ellipse.center.x + 2 * ellipse.axisX.x + ellipse.axisY.x,
            y: ellipse.center.y + 2 * ellipse.axisX.y + ellipse.axisY.y };
        const contacts = ellipseTangentContacts(ellipse, origin);
        expect(contacts.length).toBe(2);
        const a = ellipse.axisX, b = ellipse.axisY, determinant = a.x * b.y - a.y * b.x;
        for(const contact of contacts) {
            const dx = contact.x - ellipse.center.x, dy = contact.y - ellipse.center.y;
            const x = (dx * b.y - dy * b.x) / determinant, y = (a.x * dy - a.y * dx) / determinant;
            expect(x * x + y * y).toBeCloseTo(1, 9);
            const tangent = { x: -a.x * y + b.x * x, y: -a.y * y + b.y * x };
            const vx = origin.x - contact.x, vy = origin.y - contact.y;
            expect((vx * tangent.y - vy * tangent.x) / (Math.hypot(vx, vy) * Math.hypot(tangent.x, tangent.y))).toBeCloseTo(0, 9);
        }
    });

    it('rejects inside/on-outline origins and degenerate geometry while retaining nearby external contacts', () => {
        for(const x of [0, 49, 50]) expect(ellipseTangentContacts(circle, { x, y: 0 })).toEqual([]);
        expect(ellipseTangentContacts(circle, { x: 50.001, y: 0 }).length).toBe(2);
        expect(ellipseTangentContacts({ ...circle, axisY: { x: 50, y: 0 } }, { x: 100, y: 0 })).toEqual([]);
        expect(ellipseTangentContacts({ ...circle, axisX: { x: NaN, y: 0 } }, { x: 100, y: 0 })).toEqual([]);
    });

    it('freezes native targets in the shared query without introducing approximate path intersections', () => {
        const ellipse = { ...circle, center: { ...circle.center }, axisX: { ...circle.axisX } };
        const query = new PathGeometryQuery([], [ellipse]), before = query.contacts({ x: 100, y: 0 });
        ellipse.center.x = 1000; ellipse.axisX.x = 10;
        expect(query.contacts({ x: 100, y: 0 })).toEqual(before);
        expect(before.map((hit) => hit.kind)).toEqual(['tangent', 'tangent', 'perpendicular', 'perpendicular']);
        expect(query.intersections({ x: 25, y: 43 }, 6)).toEqual([]);
    });
});

describe('native ellipse perpendicular contacts', () => {
    it('finds both circle normals from inside and outside, omitting zero-length and infinite families', () => {
        for(const x of [20, 100]) {
            const contacts = ellipsePerpendicularContacts(circle, { x, y: 0 });
            expect(contacts.length).toBe(2);
            expect(contacts.map(p => Math.round(p.x)).sort((a, b) => a - b)).toEqual([-50, 50]);
            contacts.forEach(p => expect(p.y).toBeCloseTo(0, 8));
        }
        expect(ellipsePerpendicularContacts(circle, circle.center)).toEqual([]);
        const on = ellipsePerpendicularContacts(circle, { x: 50, y: 0 });
        expect(on.length).toBe(1); expect(on[0].x).toBeCloseTo(-50, 8);
    });

    it('retains four ellipse normals and repeated roots where two contacts meet', () => {
        const ellipse = { ...circle, axisX: { x: 100, y: 0 } };
        expect(ellipsePerpendicularContacts(ellipse, ellipse.center).length).toBe(4);
        expect(ellipsePerpendicularContacts(ellipse, { x: 74, y: 0 }).length).toBe(4);
        expect(ellipsePerpendicularContacts(ellipse, { x: 76, y: 0 }).length).toBe(2);
        const cusp = ellipsePerpendicularContacts(ellipse, { x: 75, y: 0 });
        expect(cusp.length).toBe(2);
        expect(cusp.some(p => Math.hypot(p.x - 100, p.y) < 1e-6)).toBeTrue();
    });

    it('solves right angles in canvas space under reflection, rotation, shear, and large translations', () => {
        const ellipse = { ...circle, center: { x: 100000, y: -80000 }, axisX: { x: -90, y: 40 }, axisY: { x: 20, y: 35 } };
        for(const angle of [0, .43, Math.PI / 2, 3.4, 5.7]) {
            const a = ellipse.axisX, b = ellipse.axisY;
            const contact = { x: ellipse.center.x + a.x * Math.cos(angle) + b.x * Math.sin(angle), y: ellipse.center.y + a.y * Math.cos(angle) + b.y * Math.sin(angle) };
            const tx = -a.x * Math.sin(angle) + b.x * Math.cos(angle), ty = -a.y * Math.sin(angle) + b.y * Math.cos(angle);
            const origin = { x: contact.x - ty * 2, y: contact.y + tx * 2 };
            const contacts = ellipsePerpendicularContacts(ellipse, origin);
            expect(contacts.some(p => Math.hypot(p.x - contact.x, p.y - contact.y) < 1e-6)).toBeTrue();
            for(const p of contacts) {
                const x = p.x - ellipse.center.x, y = p.y - ellipse.center.y, det = a.x * b.y - a.y * b.x;
                const cos = (x * b.y - y * b.x) / det, sin = (a.x * y - a.y * x) / det;
                expect(cos * cos + sin * sin).toBeCloseTo(1, 8);
                const tangent = { x: -a.x * sin + b.x * cos, y: -a.y * sin + b.y * cos };
                const vx = p.x - origin.x, vy = p.y - origin.y;
                expect((vx * tangent.x + vy * tangent.y) / (Math.hypot(vx, vy) * Math.hypot(tangent.x, tangent.y))).toBeCloseTo(0, 7);
            }
        }
    });

    it('rejects collapsed and non-finite ellipses without arbitrary contacts', () => {
        for(const ellipse of [{ ...circle, axisY: { x: 20, y: 0 } }, { ...circle, axisX: { x: NaN, y: 0 } }]) {
            expect(ellipsePerpendicularContacts(ellipse, { x: 100, y: 0 })).toEqual([]);
        }
        expect(ellipsePerpendicularContacts(circle, { x: Infinity, y: 0 })).toEqual([]);
    });
});

describe('curve and paired ellipse tangency', () => {
    it('projects onto a transformed ellipse and preserves handle length while aligning the tangent', () => {
        const ellipse = { ...circle, axisX: { x: -90, y: 40 }, axisY: { x: 20, y: 35 } };
        const hit = nearestEllipseContact(ellipse, { x: 65, y: 5 })!;
        const a = ellipse.axisX, b = ellipse.axisY, det = a.x * b.y - a.y * b.x;
        const x = (hit.point.x * b.y - hit.point.y * b.x) / det, y = (a.x * hit.point.y - a.y * hit.point.x) / det;
        expect(x * x + y * y).toBeCloseTo(1, 9);
        const handle = tangentAlignedHandle(hit.point, { x: hit.point.x + 30, y: hit.point.y + 40 }, hit.tangent);
        expect(Math.hypot(handle.x - hit.point.x, handle.y - hit.point.y)).toBeCloseTo(50, 8);
        expect((handle.x - hit.point.x) * hit.tangent.y - (handle.y - hit.point.y) * hit.tangent.x).toBeCloseTo(0, 7);
    });
    it('finds all four common tangents to disjoint circles and two for overlapping circles', () => {
        const second = { ...circle, center: { x: 200, y: 0 } };
        const contacts = ellipseCommonTangents(circle, second);
        expect(contacts.length).toBe(4);
        for(const pair of contacts) {
            const dx = pair.end.x - pair.start.x, dy = pair.end.y - pair.start.y;
            expect(pair.start.x * dx + pair.start.y * dy).toBeCloseTo(0, 6);
            expect((pair.end.x - 200) * dx + pair.end.y * dy).toBeCloseTo(0, 6);
        }
        expect(ellipseCommonTangents(circle, { ...second, center: { x: 75, y: 0 } }).length).toBe(2);
        expect(ellipseCommonTangents(circle, { ...circle, axisX: { x: 10, y: 0 }, axisY: { x: 0, y: 10 } })).toEqual([]);
        expect(ellipseCommonTangents(circle, circle)).toEqual([]);
    });
});
