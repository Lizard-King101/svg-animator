/*! SVG Animator Runtime v1.0.0 | MIT License */
"use strict";
var SVGAnimatorRuntime = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var index_exports = {};
  __export(index_exports, {
    RUNTIME_BROWSER_GLOBAL: () => RUNTIME_BROWSER_GLOBAL,
    RUNTIME_BUNDLE_FORMAT_VERSION: () => RUNTIME_BUNDLE_FORMAT_VERSION,
    RUNTIME_BUNDLE_KIND: () => RUNTIME_BUNDLE_KIND,
    RUNTIME_CAPABILITIES_V1: () => RUNTIME_CAPABILITIES_V1,
    RUNTIME_VERSION: () => RUNTIME_VERSION,
    RuntimePlayer: () => RuntimePlayer,
    RuntimePlayerError: () => RuntimePlayerError,
    bootstrapAnimatedSVG: () => bootstrapAnimatedSVG,
    createEmbeddedPlayer: () => createEmbeddedPlayer,
    createPlayer: () => createPlayer,
    evaluateRuntimeTrack: () => evaluateRuntimeTrack,
    loadPlayer: () => loadPlayer,
    packedColorValue: () => packedColorValue,
    validateRuntimeBundle: () => validateRuntimeBundle
  });

  // src/contracts.ts
  var RUNTIME_BUNDLE_KIND = "svg-animator/runtime-bundle";
  var RUNTIME_BUNDLE_FORMAT_VERSION = 1;
  var RUNTIME_VERSION = "1.0.0";
  var RUNTIME_BROWSER_GLOBAL = "SVGAnimatorRuntime";
  var RUNTIME_CAPABILITIES_V1 = [
    "tracks.numeric-v1",
    "tracks.color-v1",
    "tracks.discrete-v1",
    "render.transforms-v1",
    "render.geometry-v1",
    "render.paint-v1",
    "render.gradient-v1",
    "render.path-v1",
    "render.clipping-v1",
    "render.motion-path-v1"
  ];

  // src/errors.ts
  var RuntimePlayerError = class extends Error {
    constructor(code, message, cause) {
      super(message);
      this.code = code;
      this.cause = cause;
      this.name = "RuntimePlayerError";
    }
  };

  // src/temporal.internal.ts
  function evaluateTemporalCubic(time, timeA, timeB, timeC, timeD, valueA, valueB, valueC, valueD) {
    const position = solveTemporalCubicPosition(time, timeA, timeB, timeC, timeD);
    return ((valueA * position + valueB) * position + valueC) * position + valueD;
  }
  function solveTemporalCubicPosition(time, timeA, timeB, timeC, timeD) {
    const end = timeA + timeB + timeC + timeD;
    let position = end === timeD ? 1 : Math.max(0, Math.min(1, (time - timeD) / (end - timeD)));
    for (let index = 0; index < 5; index++) {
      const error = ((timeA * position + timeB) * position + timeC) * position + timeD - time;
      const derivative = (3 * timeA * position + 2 * timeB) * position + timeC;
      if (Math.abs(error) < 1e-7 || Math.abs(derivative) < 1e-9) break;
      const next = position - error / derivative;
      if (next < 0 || next > 1) break;
      position = next;
    }
    let low = 0;
    let high = 1;
    for (let index = 0; index < 14; index++) {
      const sampledTime = ((timeA * position + timeB) * position + timeC) * position + timeD;
      if (Math.abs(sampledTime - time) < 1e-7) break;
      if (sampledTime < time) low = position;
      else high = position;
      position = (low + high) / 2;
    }
    return position;
  }
  function evaluateTemporalCubicArray(time, coefficients, offset = 0) {
    return evaluateTemporalCubic(
      time,
      coefficients[offset],
      coefficients[offset + 1],
      coefficients[offset + 2],
      coefficients[offset + 3],
      coefficients[offset + 4],
      coefficients[offset + 5],
      coefficients[offset + 6],
      coefficients[offset + 7]
    );
  }

  // src/evaluator.ts
  function evaluateRuntimeTrack(track, time) {
    if (track.times.length === 0) return void 0;
    if (time <= track.times[0]) return track.values[0];
    const last = track.times.length - 1;
    if (time >= track.times[last]) return track.values[last];
    const segment2 = findSegment(track.times, time);
    if (track.kind === "boolean" || track.kind === "string") return track.values[segment2];
    const start = track.times[segment2];
    const end = track.times[segment2 + 1];
    const raw = (time - start) / Math.max(1e-12, end - start);
    if (track.kind === "color") {
      const mode2 = track.segmentModes[segment2];
      if (mode2 === "hold") return track.values[segment2];
      return interpolatePackedColor(track.values[segment2], track.values[segment2 + 1], ease(raw, mode2), track.interpolationSpaces[segment2]);
    }
    const numericTrack = track;
    const mode = numericTrack.segmentModes[segment2];
    if (mode === "hold") return numericTrack.values[segment2];
    if (mode === "temporal") {
      const offset = segment2 * 8;
      const coefficients = numericTrack.temporalCoefficients;
      return evaluateTemporalCubicArray(time, coefficients, offset);
    }
    const amount = ease(raw, mode);
    return numericTrack.values[segment2] + (numericTrack.values[segment2 + 1] - numericTrack.values[segment2]) * amount;
  }
  function packedColorValue(value) {
    const color = `#${(value >>> 8 & 16777215).toString(16).padStart(6, "0")}`;
    return { color, opacity: (value & 255) / 255 };
  }
  function findSegment(times, time) {
    let low = 0;
    let high = times.length - 1;
    while (low + 1 < high) {
      const middle = low + high >>> 1;
      if (times[middle] <= time) low = middle;
      else high = middle;
    }
    return low;
  }
  function ease(value, mode) {
    return mode === "ease-in" ? value * value : mode === "ease-out" ? 1 - (1 - value) * (1 - value) : mode === "ease-in-out" ? value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2 : value;
  }
  function interpolatePackedColor(from, to, amount, space) {
    const first = [from >>> 24 & 255, from >>> 16 & 255, from >>> 8 & 255];
    const second = [to >>> 24 & 255, to >>> 16 & 255, to >>> 8 & 255];
    let red;
    let green;
    let blue;
    if (space === "hsl") {
      const a = rgbToHsl(...first);
      const b = rgbToHsl(...second);
      const hueDelta = (b[0] - a[0] + 540) % 360 - 180;
      [red, green, blue] = hslToRgb((a[0] + hueDelta * amount + 360) % 360, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount);
    } else {
      red = Math.round(first[0] + (second[0] - first[0]) * amount);
      green = Math.round(first[1] + (second[1] - first[1]) * amount);
      blue = Math.round(first[2] + (second[2] - first[2]) * amount);
    }
    const alpha = Math.round((from & 255) + ((to & 255) - (from & 255)) * amount);
    return (red << 24 | green << 16 | blue << 8 | alpha) >>> 0;
  }
  function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lightness = (max + min) / 2;
    if (max === min) return [0, 0, lightness];
    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return [hue * 60, saturation, lightness];
  }
  function hslToRgb(hueDegrees, saturation, lightness) {
    if (saturation === 0) {
      const gray = Math.round(lightness * 255);
      return [gray, gray, gray];
    }
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    const hue = hueDegrees / 360;
    const channel = (offset) => {
      let value = hue + offset;
      if (value < 0) value += 1;
      if (value > 1) value -= 1;
      const result = value < 1 / 6 ? p + (q - p) * 6 * value : value < 1 / 2 ? q : value < 2 / 3 ? p + (q - p) * (2 / 3 - value) * 6 : p;
      return Math.round(result * 255);
    };
    return [channel(1 / 3), channel(0), channel(-1 / 3)];
  }

  // src/path-data.ts
  function buildRuntimePathData(contours, rounded = true) {
    return contours.map((contour) => buildContour(contour, rounded)).filter(Boolean).join(" ");
  }
  function buildContour(contour, rounded) {
    const lines = contour.lines.filter((line) => line.points.length >= 2);
    if (!lines.length) return "";
    const closed = contour.closed || lines.length > 1 && samePoint(lines[0].points[0], lines[lines.length - 1].points[1]);
    if (!rounded) {
      const commands2 = [`M ${pointText(lines[0].points[0])}`];
      lines.forEach((line) => commands2.push(line.type === "bezier" ? `C ${pointText(line.controlStart ?? line.points[0])} ${pointText(line.controlEnd ?? line.points[1])} ${pointText(line.points[1])}` : `L ${pointText(line.points[1])}`));
      if (closed) commands2.push("Z");
      return commands2.join(" ");
    }
    const startCorner = segmentStartCorner(lines, 0, closed);
    const commands = [`M ${pointText(startCorner?.after ?? lines[0].points[0])}`];
    lines.forEach((line, index) => {
      const corner = segmentEndCorner(lines, index, closed);
      const end = corner?.before ?? line.points[1];
      commands.push(line.type === "bezier" && line.controlStart && line.controlEnd ? `C ${pointText(line.controlStart)} ${pointText(line.controlEnd)} ${pointText(end)}` : `L ${pointText(end)}`);
      if (corner) commands.push(`C ${pointText(corner.controlBefore)} ${pointText(corner.controlAfter)} ${pointText(corner.after)}`);
    });
    if (closed) commands.push("Z");
    return commands.join(" ");
  }
  function segmentStartCorner(lines, index, closed) {
    if (index === 0 && !closed) return null;
    return roundedCorner(lines[index === 0 ? lines.length - 1 : index - 1], lines[index]);
  }
  function segmentEndCorner(lines, index, closed) {
    if (index === lines.length - 1 && !closed) return null;
    return roundedCorner(lines[index], lines[index === lines.length - 1 ? 0 : index + 1]);
  }
  function roundedCorner(incoming, outgoing) {
    if (incoming.type !== "line" || outgoing.type !== "line" || !samePoint(incoming.points[1], outgoing.points[0])) return null;
    const anchor = outgoing.points[0];
    const radius = Math.max(incoming.points[1].cornerRadius ?? 0, anchor.cornerRadius ?? 0);
    if (radius <= 0) return null;
    const previous = incoming.points[0];
    const next = outgoing.points[1];
    const previousLength = distance(anchor, previous);
    const nextLength = distance(anchor, next);
    if (previousLength <= 1e-4 || nextLength <= 1e-4) return null;
    const previousUnit = unit(anchor, previous);
    const nextUnit = unit(anchor, next);
    const angle = Math.acos(Math.max(-1, Math.min(1, previousUnit.x * nextUnit.x + previousUnit.y * nextUnit.y)));
    if (angle <= 1e-3 || angle >= Math.PI - 1e-3) return null;
    const tangent = Math.tan(angle / 2);
    if (Math.abs(tangent) <= 1e-4) return null;
    const offset = Math.min(radius / tangent, Math.min(previousLength, nextLength) * 0.45);
    if (offset <= 1e-4) return null;
    const controlLength = 4 / 3 * Math.tan((Math.PI - angle) / 4) * offset * tangent;
    const before = runtimePoint(anchor.x + previousUnit.x * offset, anchor.y + previousUnit.y * offset);
    const after = runtimePoint(anchor.x + nextUnit.x * offset, anchor.y + nextUnit.y * offset);
    return {
      before,
      after,
      controlBefore: runtimePoint(before.x - previousUnit.x * controlLength, before.y - previousUnit.y * controlLength),
      controlAfter: runtimePoint(after.x - nextUnit.x * controlLength, after.y - nextUnit.y * controlLength)
    };
  }
  function pointText(point) {
    return `${round(point.x)} ${round(point.y)}`;
  }
  function samePoint(a, b) {
    return a.id === b.id || Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
  }
  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function unit(from, to) {
    const length = distance(from, to);
    return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  }
  function runtimePoint(x, y) {
    return { id: "", x, y };
  }
  function round(value) {
    return Math.round(value * 1e3) / 1e3;
  }

  // src/render-roles.internal.ts
  function pathRevealNodes(root, targetNode, targetId) {
    const nested = [...targetNode.querySelectorAll('[data-render-role~="reveal"]')];
    if (nested.length) return nested;
    const scope = targetNode.ownerSVGElement ?? root;
    const maskId = `stroke-draw-${targetId}`;
    return [...scope.querySelectorAll('[data-render-role~="reveal"]')].filter((node) => node.closest("mask")?.getAttribute("id") === maskId);
  }

  // src/scene.ts
  var RuntimeScene = class {
    constructor(root, sourceTargets) {
      this.root = root;
      this.targetById = /* @__PURE__ */ new Map();
      this.nodeById = /* @__PURE__ */ new Map();
      this.targets = clone(sourceTargets);
      this.targets.forEach((target) => this.targetById.set(target.id, target));
    }
    write(targetId, property, value) {
      const target = this.targetById.get(targetId);
      if (!target) return false;
      const point = /^path\.points\.([^.]+)\.(x|y)$/.exec(property);
      if (point && target.path) return this.writePathPoint(target, point[1], point[2], value);
      const gradient = /^settings\.(fill|stroke|color)\.gradient\.(?:(x1|y1|x2|y2|cx|cy|r|fx|fy)|transform\.(a|b|c|d|e|f)|stops\.(.+)\.(offset|color|opacity))$/.exec(property);
      if (gradient) return this.writeGradient(target, gradient, value);
      const numeric = finite(value);
      switch (property) {
        case "geometry.x":
          return numeric == null ? false : this.writeGeometryPosition(target, "x", numeric);
        case "geometry.y":
          return numeric == null ? false : this.writeGeometryPosition(target, "y", numeric);
        case "geometry.width":
          return numeric == null ? false : this.writeGeometrySize(target, "width", numeric);
        case "geometry.height":
          return numeric == null ? false : this.writeGeometrySize(target, "height", numeric);
        case "transform.translateX":
          return assignNumber(target.transform, "translateX", numeric);
        case "transform.translateY":
          return assignNumber(target.transform, "translateY", numeric);
        case "transform.scaleX":
          return assignNumber(target.transform, "scaleX", numeric);
        case "transform.scaleY":
          return assignNumber(target.transform, "scaleY", numeric);
        case "transform.rotation":
          return assignNumber(target.transform, "rotation", numeric);
        case "transform.originX":
          return target.transform.autoOrigin ? numeric != null : assignNumber(target.transform, "originX", numeric);
        case "transform.originY":
          return target.transform.autoOrigin ? numeric != null : assignNumber(target.transform, "originY", numeric);
        case "opacity":
          if (numeric == null) return false;
          target.opacity = clamp01(numeric);
          return true;
        case "settings.fill":
          return this.writeSolidPaint(target, "fill", value);
        case "settings.stroke":
          return this.writeSolidPaint(target, "stroke", value);
        case "settings.color":
          return this.writeSolidPaint(target, "color", value);
        case "settings.stroke_width":
          if (numeric == null || !target.stroke) return false;
          target.stroke.width = numeric;
          return true;
        case "settings.stroke_dashoffset":
          if (numeric == null || !target.stroke) return false;
          target.stroke.dashoffset = numeric;
          return true;
        case "visible":
          target.visible = Boolean(value);
          return true;
        case "path.drawProgress":
          if (numeric == null || !target.path) return false;
          target.path.drawProgress = clamp01(numeric);
          return true;
        case "motion.pathId":
          target.motion.pathId = typeof value === "string" && value ? value : null;
          return true;
        case "motion.progress":
          if (numeric == null) return false;
          target.motion.progress = clamp01(numeric);
          return true;
        case "motion.offsetX":
          return assignNumber(target.motion, "offsetX", numeric);
        case "motion.offsetY":
          return assignNumber(target.motion, "offsetY", numeric);
        case "motion.rotateToPath":
          target.motion.rotateToPath = Boolean(value);
          return true;
        case "motion.offsetAngle":
          return assignNumber(target.motion, "offsetAngle", numeric);
        default:
          return false;
      }
    }
    render() {
      this.targets.forEach((target) => {
        const node = this.node(target.id);
        if (!node) return;
        node.style.display = target.visible ? "" : "none";
        setAttribute(node, "opacity", target.opacity === 1 ? null : round2(target.opacity));
        setAttribute(node, "transform", matrixToSvg(this.motionAdjustedMatrix(target)));
        this.renderGeometry(node, target);
        this.renderAppearance(node, target);
        this.renderGradients(target);
      });
    }
    clear() {
      this.nodeById.clear();
    }
    writeGeometryPosition(target, axis, value) {
      if (target.type === "group") return false;
      const delta = value - target.geometry[axis];
      target.geometry[axis] = value;
      if (target.path) forEachPathPoint(target.path.contours, (point) => point[axis] += delta);
      this.transformAttachedGeometry(target, axis === "x" ? { scaleX: 1, scaleY: 1, translateX: delta, translateY: 0 } : { scaleX: 1, scaleY: 1, translateX: 0, translateY: delta });
      return true;
    }
    writeGeometrySize(target, axis, value) {
      if (target.type !== "rectangle" && target.type !== "ellipse") return false;
      const next = Math.max(1, value);
      const from = { ...target.geometry };
      target.geometry[axis] = next;
      const scaleX = axis === "width" && from.width > 1e-6 ? next / from.width : 1;
      const scaleY = axis === "height" && from.height > 1e-6 ? next / from.height : 1;
      this.transformAttachedGeometry(target, {
        scaleX,
        scaleY,
        translateX: from.x - from.x * scaleX,
        translateY: from.y - from.y * scaleY
      });
      return true;
    }
    /** Mirrors the editor's native-geometry mutation contract for pinned origins and user-space paints. */
    transformAttachedGeometry(target, affine) {
      target.transform.originX = target.transform.originX * affine.scaleX + affine.translateX;
      target.transform.originY = target.transform.originY * affine.scaleY + affine.translateY;
      const matrix = {
        a: affine.scaleX,
        b: 0,
        c: 0,
        d: affine.scaleY,
        e: affine.translateX,
        f: affine.translateY
      };
      Object.values(target.paints).forEach((paint) => {
        if (!paint || paint.kind !== "gradient" || paint.units !== "userSpaceOnUse") return;
        const transformed = multiply(matrix, tupleMatrix(paint.transform));
        paint.transform = [transformed.a, transformed.b, transformed.c, transformed.d, transformed.e, transformed.f];
      });
    }
    writePathPoint(target, id, axis, value) {
      if (!target.path) return false;
      const before = target.geometry;
      if (!writePathPoint(target.path.contours, id, axis, value)) return false;
      const after = pathBounds(target.path.contours);
      if (target.transform.autoOrigin) {
        target.transform.originX += boundsCenter(after, "x") - boundsCenter(before, "x");
        target.transform.originY += boundsCenter(after, "y") - boundsCenter(before, "y");
      }
      target.geometry = after;
      return true;
    }
    writeSolidPaint(target, key, value) {
      if (typeof value !== "number") return false;
      const color = packedColorValue(value);
      target.paints[key] = { kind: "solid", ...color };
      return true;
    }
    writeGradient(target, match, value) {
      const key = match[1];
      const paint = target.paints[key];
      if (!paint || paint.kind !== "gradient") return false;
      const numeric = finite(value);
      if (match[2]) {
        if (numeric == null) return false;
        paint.coordinates[match[2]] = numeric;
        return true;
      }
      if (match[3]) {
        if (numeric == null) return false;
        paint.transform["abcdef".indexOf(match[3])] = numeric;
        return true;
      }
      const stop = paint.stops.find((candidate) => candidate.id === match[4]);
      if (!stop) return false;
      if (match[5] === "color") {
        if (typeof value !== "number") return false;
        Object.assign(stop, packedColorValue(value));
        return true;
      }
      if (numeric == null) return false;
      if (match[5] === "offset") stop.offset = clamp01(numeric);
      else stop.opacity = clamp01(numeric);
      return true;
    }
    renderGeometry(node, target) {
      const geometryNodes = node.tagName.toLowerCase() === "g" ? [...node.querySelectorAll('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]')] : [node];
      if (target.path) {
        const data = buildRuntimePathData(target.path.contours, target.path.rounded);
        geometryNodes.forEach((item) => setAttribute(item, "d", data));
        const progress = clamp01(target.path.drawProgress);
        const reveal = pathRevealNodes(this.root, node, target.id);
        if (reveal.length) reveal.forEach((item) => setAttribute(item, "stroke-dashoffset", round2(1 - progress)));
        else this.roleNodes(node, "stroke").forEach((item) => {
          setAttribute(item, "pathLength", progress < 1 ? 1 : null);
          setAttribute(item, "stroke-dasharray", progress < 1 ? 1 : target.stroke?.dasharray.join(" ") || null);
          setAttribute(item, "stroke-dashoffset", progress < 1 ? round2(1 - progress) : target.stroke?.dasharray.length ? target.stroke.dashoffset : null);
        });
        return;
      }
      if (target.type === "rectangle" || target.type === "ellipse") geometryNodes.forEach((item) => {
        if (target.type === "rectangle") {
          setAttribute(item, "x", target.geometry.x);
          setAttribute(item, "y", target.geometry.y);
          setAttribute(item, "width", target.geometry.width);
          setAttribute(item, "height", target.geometry.height);
        } else {
          setAttribute(item, "cx", target.geometry.x + target.geometry.width / 2);
          setAttribute(item, "cy", target.geometry.y + target.geometry.height / 2);
          setAttribute(item, "rx", target.geometry.width / 2);
          setAttribute(item, "ry", target.geometry.height / 2);
        }
      });
      if (target.type === "text") {
        setAttribute(node, "x", target.geometry.x);
        setAttribute(node, "y", target.geometry.y);
        node.querySelectorAll("tspan").forEach((span) => setAttribute(span, "x", target.geometry.x));
      }
    }
    renderAppearance(node, target) {
      const fill = target.paints.fill;
      const stroke = target.paints.stroke;
      const color = target.paints.color;
      if (fill !== void 0) this.roleNodes(node, "fill").forEach((item) => writePaint(item, "fill", fill, "none"));
      if (stroke !== void 0) this.roleNodes(node, "stroke").forEach((item) => writePaint(item, "stroke", stroke, null));
      if (color !== void 0) writePaint(node, "fill", color, "#000000");
      if (target.stroke) {
        const multiplier = target.stroke.alignment === "center" ? 1 : 2;
        this.roleNodes(node, "stroke").forEach((item) => {
          setAttribute(item, "stroke-width", round2(target.stroke.width * multiplier));
          if (target.stroke.dasharray.length) {
            setAttribute(item, "stroke-dasharray", target.stroke.dasharray.join(" "));
            setAttribute(item, "stroke-dashoffset", target.stroke.dashoffset);
          }
        });
        pathRevealNodes(this.root, node, target.id).forEach((item) => setAttribute(item, "stroke-width", target.stroke.width * 4));
      }
    }
    renderGradients(target) {
      Object.values(target.paints).forEach((paint) => {
        if (!paint || paint.kind !== "gradient") return;
        const gradient = this.node(paint.id);
        if (!gradient) return;
        setAttribute(gradient, "gradientTransform", isIdentityTransform(paint.transform) ? null : `matrix(${paint.transform.map(round2).join(" ")})`);
        Object.entries(paint.coordinates).forEach(([name, value]) => setAttribute(gradient, name, value));
        paint.stops.forEach((stop) => {
          const stopNode = this.node(stop.id);
          if (!stopNode) return;
          setAttribute(stopNode, "offset", round2(stop.offset));
          setAttribute(stopNode, "stop-color", stop.color);
          setAttribute(stopNode, "stop-opacity", stop.opacity < 0.9999 ? round2(stop.opacity) : null);
        });
      });
    }
    roleNodes(node, role) {
      if (node.tagName.toLowerCase() !== "g") return [node];
      return [...node.querySelectorAll(`[data-render-role~="${role}"]`)];
    }
    motionAdjustedMatrix(target) {
      const base = this.ownMatrix(target, 0);
      const sampled = this.sampleMotion(target);
      if (!sampled) return base;
      const rotation2 = (target.motion.rotateToPath ? sampled.tangentAngle : 0) + target.motion.offsetAngle;
      const matrix = this.ownMatrix(target, rotation2);
      const origin = { x: target.transform.originX, y: target.transform.originY };
      const currentOrigin = applyMatrix(matrix, origin.x, origin.y);
      const offset = rotateVector(target.motion.offsetX, target.motion.offsetY, target.transform.rotation + rotation2);
      return multiply(translation(sampled.x + offset.x - currentOrigin.x, sampled.y + offset.y - currentOrigin.y), matrix);
    }
    sampleMotion(target) {
      const path = target.motion.pathId ? this.targetById.get(target.motion.pathId) : void 0;
      if (!path?.path || path.id === target.id) return void 0;
      const segments = flattenRuntimePath(path.path.contours, this.combinedMatrix(path));
      const total = segments.reduce((sum, segment2) => sum + segment2.length, 0);
      if (total <= 0) return void 0;
      const desired = clamp01(target.motion.progress) * total;
      let consumed = 0;
      let selected = segments[segments.length - 1];
      let amount = 1;
      for (const segment2 of segments) {
        if (consumed + segment2.length >= desired) {
          selected = segment2;
          amount = segment2.length ? (desired - consumed) / segment2.length : 0;
          break;
        }
        consumed += segment2.length;
      }
      const world = { x: selected.start.x + (selected.end.x - selected.start.x) * amount, y: selected.start.y + (selected.end.y - selected.start.y) * amount };
      const inverse = invert(this.parentMatrix(target));
      const point = applyMatrix(inverse, world.x, world.y);
      const tangentEnd = applyMatrix(inverse, world.x + selected.end.x - selected.start.x, world.y + selected.end.y - selected.start.y);
      return { x: point.x, y: point.y, tangentAngle: Math.atan2(tangentEnd.y - point.y, tangentEnd.x - point.x) * 180 / Math.PI };
    }
    combinedMatrix(target) {
      return this.chain(target).reduce((matrix, item) => multiply(matrix, this.ownMatrix(item, 0)), identity());
    }
    parentMatrix(target) {
      return this.chain(target).slice(0, -1).reduce((matrix, item) => multiply(matrix, this.ownMatrix(item, 0)), identity());
    }
    chain(target) {
      const result = [target];
      let parentId = target.parentId;
      while (parentId) {
        const parent = this.targetById.get(parentId);
        if (!parent) break;
        result.unshift(parent);
        parentId = parent.parentId;
      }
      return result;
    }
    ownMatrix(target, extraRotation) {
      const transform = target.transform;
      return [
        translation(transform.translateX, transform.translateY),
        translation(transform.originX, transform.originY),
        rotation(transform.rotation + extraRotation),
        scale(transform.scaleX, transform.scaleY),
        translation(-transform.originX, -transform.originY)
      ].reduce(multiply, identity());
    }
    node(id) {
      if (this.nodeById.has(id)) return this.nodeById.get(id);
      const node = this.root.querySelector(`[id="${attributeSelectorValue(id)}"]`);
      this.nodeById.set(id, node);
      return node;
    }
  };
  function writePaint(node, attribute, paint, fallback) {
    const opacityAttribute = `${attribute}-opacity`;
    if (!paint) {
      setAttribute(node, attribute, fallback);
      setAttribute(node, opacityAttribute, null);
    } else if (paint.kind === "gradient") {
      setAttribute(node, attribute, `url(#${paint.id})`);
      setAttribute(node, opacityAttribute, null);
    } else {
      setAttribute(node, attribute, paint.color);
      setAttribute(node, opacityAttribute, paint.opacity < 0.9999 ? round2(paint.opacity) : null);
    }
  }
  function writePathPoint(contours, id, axis, value) {
    const numeric = finite(value);
    if (numeric == null) return false;
    let found = false;
    forEachPathPoint(contours, (point) => {
      if (point.id === id) {
        point[axis] = numeric;
        found = true;
      }
    });
    return found;
  }
  function forEachPathPoint(contours, callback) {
    contours.forEach((contour) => contour.lines.forEach((line) => {
      line.points.forEach(callback);
      if (line.controlStart) callback(line.controlStart);
      if (line.controlEnd) callback(line.controlEnd);
    }));
  }
  function pathBounds(contours) {
    const points = [];
    forEachPathPoint(contours, (point) => points.push(point));
    if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  function boundsCenter(bounds, axis) {
    return bounds[axis] + bounds[axis === "x" ? "width" : "height"] / 2;
  }
  function flattenRuntimePath(contours, matrix) {
    return contours.flatMap((contour) => contour.lines).flatMap((line) => {
      const start = line.points[0];
      const end = line.points[1];
      if (line.type !== "bezier" || !line.controlStart || !line.controlEnd) return [segment(applyMatrix(matrix, start.x, start.y), applyMatrix(matrix, end.x, end.y))];
      const points = Array.from({ length: 33 }, (_, index) => applyMatrix(matrix, ...Object.values(cubic(start, line.controlStart, line.controlEnd, end, index / 32))));
      return points.slice(0, -1).map((point, index) => segment(point, points[index + 1]));
    }).filter((item) => item.length > 0);
  }
  function cubic(a, b, c, d, t) {
    const m = 1 - t;
    return { x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x, y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y };
  }
  function segment(start, end) {
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  }
  function identity() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  function tupleMatrix(value) {
    return { a: value[0], b: value[1], c: value[2], d: value[3], e: value[4], f: value[5] };
  }
  function translation(x, y) {
    return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
  }
  function scale(x, y) {
    return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
  }
  function rotation(degrees) {
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { a: c, b: s, c: -s, d: c, e: 0, f: 0 };
  }
  function multiply(left, right) {
    return { a: left.a * right.a + left.c * right.b, b: left.b * right.a + left.d * right.b, c: left.a * right.c + left.c * right.d, d: left.b * right.c + left.d * right.d, e: left.a * right.e + left.c * right.f + left.e, f: left.b * right.e + left.d * right.f + left.f };
  }
  function invert(matrix) {
    const d = matrix.a * matrix.d - matrix.b * matrix.c;
    return Math.abs(d) < 1e-6 ? identity() : { a: matrix.d / d, b: -matrix.b / d, c: -matrix.c / d, d: matrix.a / d, e: (matrix.c * matrix.f - matrix.d * matrix.e) / d, f: (matrix.b * matrix.e - matrix.a * matrix.f) / d };
  }
  function applyMatrix(matrix, x, y) {
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  }
  function matrixToSvg(matrix) {
    return [matrix.a - 1, matrix.b, matrix.c, matrix.d - 1, matrix.e, matrix.f].every((v) => Math.abs(v) < 1e-6) ? null : `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(round2).join(" ")})`;
  }
  function rotateVector(x, y, degrees) {
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  function setAttribute(node, name, value) {
    if (value == null || value === "") node.removeAttribute(name);
    else node.setAttribute(name, String(value));
  }
  function assignNumber(target, key, value) {
    if (value == null) return false;
    target[key] = value;
    return true;
  }
  function finite(value) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }
  function round2(value) {
    return Math.round(value * 1e4) / 1e4;
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function attributeSelectorValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  function isIdentityTransform(value) {
    return value.every((item, index) => Math.abs(item - [1, 0, 0, 1, 0, 0][index]) < 1e-6);
  }

  // src/dom.internal.ts
  var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
  function isSvgRoot(value) {
    if (!value || typeof value !== "object") return false;
    const candidate = value;
    const ownerConstructor = candidate.ownerDocument?.defaultView?.SVGSVGElement;
    if (typeof ownerConstructor === "function") return candidate instanceof ownerConstructor;
    return candidate.nodeType === 1 && candidate.namespaceURI === SVG_NAMESPACE && candidate.localName === "svg" && typeof candidate.getAttribute === "function" && typeof candidate.querySelector === "function";
  }
  function resolveSvgRoot(value) {
    const root = typeof value === "string" ? document.querySelector(value) : value;
    if (!isSvgRoot(root)) throw new RuntimePlayerError("svg-root-not-found", `Could not resolve an SVG root from ${String(value)}.`);
    return root;
  }

  // src/player.ts
  var RuntimePlayer = class {
    constructor(root, bundle, options = {}) {
      this.root = root;
      this.bundle = bundle;
      this._time = 0;
      this._state = "paused";
      this.loopIteration = 0;
      this.listeners = /* @__PURE__ */ new Map();
      validateRuntimeBundle(bundle);
      validateArtwork(root, bundle);
      this._playbackRate = finiteRate(options.playbackRate ?? 1);
      this._loop = options.loop ?? bundle.animation.loop;
      this.initialAttributes = snapshotAttributes(root);
      this.scene = new RuntimeScene(root, bundle.artwork.targets);
      this.applyAt(0);
      queueMicrotask(() => this.emit("ready", { player: this }));
      if (options.autoPlay && (options.autoplayWhenReducedMotion || !prefersReducedMotion())) queueMicrotask(() => this.play());
    }
    get time() {
      return this._time;
    }
    get duration() {
      return this.bundle.animation.duration;
    }
    get state() {
      return this._state;
    }
    get playbackRate() {
      return this._playbackRate;
    }
    set playbackRate(value) {
      this.assertActive();
      this._playbackRate = finiteRate(value);
    }
    get loop() {
      return this._loop;
    }
    set loop(value) {
      this.assertActive();
      this._loop = Boolean(value);
    }
    setPlaybackRate(value) {
      this.playbackRate = value;
      return this;
    }
    setLoop(value) {
      this.loop = value;
      return this;
    }
    play() {
      this.assertActive();
      if (this._state === "playing") return this;
      if (this.duration <= 0) {
        this.seek(0);
        this.emit("complete", { time: 0 });
        return this;
      }
      if (this._playbackRate >= 0 && this._time >= this.duration) this.seek(0);
      if (this._playbackRate < 0 && this._time <= 0) this.seek(this.duration);
      this._state = "playing";
      this.lastFrameTime = void 0;
      this.emit("play", { time: this._time });
      this.frameId = requestAnimationFrame((time) => this.tick(time));
      return this;
    }
    pause() {
      this.assertActive();
      if (this.frameId != null) cancelAnimationFrame(this.frameId);
      this.frameId = void 0;
      this.lastFrameTime = void 0;
      if (this._state === "playing") {
        this._state = "paused";
        this.emit("pause", { time: this._time });
      }
      return this;
    }
    stop() {
      this.assertActive();
      if (this.frameId != null) cancelAnimationFrame(this.frameId);
      this.frameId = void 0;
      this.lastFrameTime = void 0;
      this._state = "stopped";
      this.applyAt(0);
      this.emit("stop", { time: this._time });
      return this;
    }
    seek(time) {
      this.assertActive();
      const previousTime = this._time;
      const nextTime = clamp(Number.isFinite(time) ? time : 0, 0, this.duration);
      this.emitMarkers(previousTime, nextTime);
      this.applyAt(nextTime);
      this.emit("seek", { time: nextTime, previousTime });
      return this;
    }
    destroy() {
      if (this._state === "destroyed") return;
      if (this.frameId != null) cancelAnimationFrame(this.frameId);
      this.frameId = void 0;
      this.scene.clear();
      restoreAttributes(this.initialAttributes);
      this._state = "destroyed";
      this.emit("destroy", {});
      this.listeners.clear();
    }
    on(type, listener) {
      this.assertActive();
      let set = this.listeners.get(type);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this.listeners.set(type, set);
      }
      set.add(listener);
      return () => this.off(type, listener);
    }
    off(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }
    tick(timestamp) {
      if (this._state !== "playing") return;
      if (this.lastFrameTime == null) this.lastFrameTime = timestamp;
      const delta = Math.max(0, timestamp - this.lastFrameTime) / 1e3 * this._playbackRate;
      this.lastFrameTime = timestamp;
      this.advance(delta);
      if (this._state === "playing") this.frameId = requestAnimationFrame((time) => this.tick(time));
    }
    advance(delta) {
      const previous = this._time;
      let next = previous + delta;
      if (this._loop && this.duration > 0) {
        let markerCursor = previous;
        while (next > this.duration || next < 0) {
          if (next > this.duration) {
            this.emitMarkers(markerCursor, this.duration);
            next -= this.duration;
            this.loopIteration++;
            this.emit("loop", { time: next, iteration: this.loopIteration, direction: "forward" });
            markerCursor = 0;
          } else {
            this.emitMarkers(markerCursor, 0);
            next += this.duration;
            this.loopIteration++;
            this.emit("loop", { time: next, iteration: this.loopIteration, direction: "reverse" });
            markerCursor = this.duration;
          }
        }
        this.emitMarkers(markerCursor, next);
      } else if (this._playbackRate > 0 && next >= this.duration || this._playbackRate < 0 && next <= 0) {
        next = clamp(next, 0, this.duration);
        this.emitMarkers(previous, next);
        this.applyAt(next);
        this.pause();
        this.emit("complete", { time: next });
        return;
      } else {
        this.emitMarkers(previous, next);
      }
      this.applyAt(next);
    }
    applyAt(time) {
      this._time = time;
      const animation = this.bundle.animation;
      animation.tracks.forEach((track) => {
        const value = evaluateRuntimeTrack(track, time);
        if (value !== void 0) this.scene.write(animation.targets[track.target], animation.properties[track.property], value);
      });
      this.scene.render();
    }
    emitMarkers(from, to) {
      if (from === to) return;
      const direction = to > from ? "forward" : "reverse";
      const markers = this.bundle.animation.markers.filter((marker) => direction === "forward" ? marker.time > from && marker.time <= to : marker.time < from && marker.time >= to);
      if (direction === "reverse") markers.reverse();
      markers.forEach((marker) => this.emit("marker", { marker, direction }));
    }
    emit(type, event) {
      this.listeners.get(type)?.forEach((listener) => {
        try {
          listener(event);
        } catch (error) {
          if (type !== "error") this.listeners.get("error")?.forEach((errorListener) => errorListener({ error: new RuntimePlayerError("invalid-bundle", `Runtime event listener for ${type} failed.`, error) }));
        }
      });
    }
    assertActive() {
      if (this._state === "destroyed") throw new RuntimePlayerError("player-destroyed", "This RuntimePlayer has been destroyed.");
    }
  };
  function createPlayer(svgOrSelector, bundle, options) {
    return new RuntimePlayer(resolveSvgRoot(svgOrSelector), bundle, options);
  }
  async function loadPlayer(svgOrSelector, bundleUrl, options) {
    let response;
    try {
      response = await fetch(bundleUrl);
    } catch (error) {
      throw new RuntimePlayerError("fetch-failed", `Could not load runtime bundle from ${String(bundleUrl)}.`, error);
    }
    if (!response.ok) throw new RuntimePlayerError("fetch-failed", `Runtime bundle request failed with HTTP ${response.status}.`);
    let bundle;
    try {
      bundle = await response.json();
    } catch (error) {
      throw new RuntimePlayerError("malformed-json", "The runtime bundle response was not valid JSON.", error);
    }
    validateRuntimeBundle(bundle);
    return createPlayer(svgOrSelector, bundle, options);
  }
  function validateRuntimeBundle(value) {
    if (!value || typeof value !== "object") throw new RuntimePlayerError("invalid-bundle", "Runtime bundle must be an object.");
    const bundle = value;
    if (bundle.kind !== RUNTIME_BUNDLE_KIND) throw new RuntimePlayerError("invalid-bundle", `Expected bundle kind \u201C${RUNTIME_BUNDLE_KIND}\u201D.`);
    if (bundle.formatVersion !== RUNTIME_BUNDLE_FORMAT_VERSION) throw new RuntimePlayerError("unsupported-bundle-version", `Runtime v1 cannot play bundle format ${String(bundle.formatVersion)}.`);
    if (!Array.isArray(bundle.requiredCapabilities)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle requiredCapabilities must be an array.");
    const supported = new Set(RUNTIME_CAPABILITIES_V1);
    const unsupported = bundle.requiredCapabilities.find((capability) => !supported.has(capability));
    if (unsupported) throw new RuntimePlayerError("unsupported-capability", `Runtime capability \u201C${unsupported}\u201D is not supported.`);
    if (!bundle.artwork || typeof bundle.artwork.signature !== "string" || !Array.isArray(bundle.artwork.targets)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle artwork is incomplete.");
    if (!bundle.animation || !Number.isFinite(bundle.animation.duration) || !Array.isArray(bundle.animation.tracks) || !Array.isArray(bundle.animation.targets) || !Array.isArray(bundle.animation.properties)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle animation is incomplete.");
    if (bundle.animation.duration < 0 || !Array.isArray(bundle.animation.markers) || !Array.isArray(bundle.animation.variables)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle timing metadata is invalid.");
    bundle.animation.tracks.forEach((track, index) => {
      if (!track || !Number.isInteger(track.target) || track.target < 0 || track.target >= bundle.animation.targets.length || !Number.isInteger(track.property) || track.property < 0 || track.property >= bundle.animation.properties.length || !Array.isArray(track.times) || !Array.isArray(track.values) || track.times.length === 0 || track.times.length !== track.values.length || track.times.some((time, timeIndex) => !Number.isFinite(time) || timeIndex > 0 && time < track.times[timeIndex - 1])) {
        throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has invalid indexes or keyframe arrays.`);
      }
      if (track.kind === "number" && (track.segmentModes.length !== track.times.length - 1 || track.temporalCoefficients.length !== Math.max(0, track.times.length - 1) * 8 || track.values.some((item) => !Number.isFinite(item)))) throw new RuntimePlayerError("invalid-bundle", `Numeric runtime track ${index} is malformed.`);
      if (track.kind === "color" && (track.segmentModes.length !== track.times.length - 1 || track.interpolationSpaces.length !== track.times.length - 1 || track.values.some((item) => !Number.isInteger(item)))) throw new RuntimePlayerError("invalid-bundle", `Color runtime track ${index} is malformed.`);
      if (track.kind !== "number" && track.kind !== "color" && track.kind !== "boolean" && track.kind !== "string") throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has an unknown kind.`);
    });
  }
  function validateArtwork(root, bundle) {
    const actual = root.getAttribute("data-svg-animator-signature");
    if (actual !== bundle.artwork.signature) throw new RuntimePlayerError("artwork-signature-mismatch", actual ? `SVG artwork signature ${actual} does not match bundle ${bundle.artwork.signature}.` : "SVG artwork has no data-svg-animator-signature attribute.");
    const missing = bundle.artwork.targets.find((target) => !root.querySelector(`[id="${selectorValue(target.id)}"]`));
    if (missing) throw new RuntimePlayerError("artwork-signature-mismatch", `SVG artwork is missing runtime target \u201C${missing.id}\u201D.`);
  }
  function snapshotAttributes(root) {
    return [root, ...root.querySelectorAll("*")].map((node) => ({ node, attributes: [...node.attributes].map((attribute) => [attribute.name, attribute.value]) }));
  }
  function restoreAttributes(snapshots) {
    snapshots.forEach(({ node, attributes }) => {
      [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
      attributes.forEach(([name, value]) => node.setAttribute(name, value));
    });
  }
  function prefersReducedMotion() {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function finiteRate(value) {
    if (!Number.isFinite(value) || value === 0) throw new RangeError("playbackRate must be a finite non-zero number.");
    return value;
  }
  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }
  function selectorValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  // src/bootstrap.ts
  function createEmbeddedPlayer(svgOrSelector, options) {
    const root = resolveSvgRoot(svgOrSelector);
    return createPlayer(root, readEmbeddedBundle(root), options);
  }
  function bootstrapAnimatedSVG(options = {}) {
    const root = options.root ?? document.documentElement;
    if (!isSvgRoot(root)) throw new RuntimePlayerError("svg-root-not-found", "Animated SVG bootstrap requires an SVG document root.");
    const { root: _root, ...playerOptions } = options;
    return createPlayer(root, readEmbeddedBundle(root), { autoPlay: true, ...playerOptions });
  }
  function readEmbeddedBundle(root) {
    const payload = root.querySelector('script[type="application/json"][data-svg-animator-bundle]');
    if (!payload?.textContent) throw new RuntimePlayerError("invalid-bundle", "SVG contains no embedded runtime bundle.");
    try {
      return JSON.parse(payload.textContent);
    } catch (error) {
      throw new RuntimePlayerError("malformed-json", "Embedded runtime bundle is not valid JSON.", error);
    }
  }
  return __toCommonJS(index_exports);
})();
//# sourceMappingURL=svg-animator-runtime.js.map
