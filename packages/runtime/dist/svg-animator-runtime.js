/*! SVG Animator Runtime v1.5.0 | MIT License */
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
  var RUNTIME_VERSION = "1.5.0";
  var RUNTIME_BROWSER_GLOBAL = "SVGAnimatorRuntime";
  var RUNTIME_CAPABILITIES_V1 = [
    "tracks.numeric-v1",
    "rig.pose-v1",
    "composition.action-windows-v1",
    "composition.action-timing-v1",
    "tracks.color-v1",
    "tracks.discrete-v1",
    "render.transforms-v1",
    "render.geometry-v1",
    "render.paint-v1",
    "render.gradient-v1",
    "render.path-v1",
    "render.outline-sections-v1",
    "render.clipping-v1",
    "render.visible-clipping-v1",
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

  // src/composition.internal.ts
  function actionTime(value) {
    return Math.round(value * 1e12) / 1e12;
  }
  function activeActionWindow(windows, time) {
    const sample = actionTime(time);
    return windows.find((window) => sample >= actionTime(window.start) && sample < actionTime(window.end));
  }
  function actionLocalTime(window, time) {
    if (!window.timing) return time - window.start;
    const { sourceStart, sourceEnd, rate } = window.timing;
    const span = sourceEnd - sourceStart, elapsed = (time - window.start) * rate;
    const cycles = elapsed / span;
    const nearest = Math.round(cycles);
    const phase = Math.abs(cycles - nearest) < 1e-10 ? 0 : elapsed % span;
    return sourceStart + phase;
  }

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
    const active = activeActionWindow(track.actionWindows ?? [], time);
    if (active) return evaluateRuntimeTrack(active.track, actionLocalTime(active, time));
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
    const closed = contour.closed;
    if (!rounded) {
      const commands2 = [`M ${pointText(lines[0].points[0])}`];
      lines.forEach((line) => commands2.push(line.type === "bezier" ? `C ${pointText(line.controlStart ?? line.points[0])} ${pointText(line.controlEnd ?? line.points[1])} ${pointText(line.points[1])}` : `L ${pointText(line.points[1])}`));
      if (closed) commands2.push("Z");
      return commands2.join(" ");
    }
    const closing = contourClosingPoints(lines, closed);
    if (closing && closing.some((point) => (point.cornerRadius ?? 0) > 0)) {
      lines.push({ id: `${contour.id}:close`, type: "line", points: closing });
    }
    const startCorner = segmentStartCorner(lines, 0, closed);
    const commands = [`M ${pointText(startCorner?.after ?? lines[0].points[0])}`];
    lines.forEach((line, index) => {
      const corner = segmentEndCorner(lines, index, closed);
      const end = corner?.before ?? line.points[1];
      const startCorner2 = segmentStartCorner(lines, index, closed);
      commands.push(line.type === "bezier" && line.controlStart && line.controlEnd && !(startCorner2 || corner) ? `C ${pointText(line.controlStart)} ${pointText(line.controlEnd)} ${pointText(end)}` : `L ${pointText(end)}`);
      if (corner) commands.push(`C ${pointText(corner.controlBefore)} ${pointText(corner.controlAfter)} ${pointText(corner.after)}`);
    });
    if (closed) commands.push("Z");
    return commands.join(" ");
  }
  function contourClosingPoints(lines, closed) {
    if (!closed || !lines.length) return void 0;
    const start = lines[0].points[0], end = lines[lines.length - 1].points[1];
    return start && end && !samePoint(start, end) ? [end, start] : void 0;
  }
  function isStraightPathSegment(line) {
    if (line.type === "line") return true;
    const [start, end] = line.points;
    if (!start || !end) return false;
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if (length < 1e-8) return false;
    return [line.controlStart ?? start, line.controlEnd ?? end].every((control) => {
      const x = control.x - start.x, y = control.y - start.y;
      const along = (x * dx + y * dy) / length;
      return Math.abs(x * dy - y * dx) / length < 1e-7 && along >= -1e-7 && along <= length + 1e-7;
    });
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
    if (!isStraightPathSegment(incoming) || !isStraightPathSegment(outgoing) || !samePoint(incoming.points[1], outgoing.points[0])) return null;
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
    if (isClippingGeometry(targetNode) || targetNode.getAttribute("data-render-projection") === "fill") return [];
    const nested = [...targetNode.querySelectorAll('[data-render-role~="reveal"]')];
    if (nested.length) return nested;
    const scope = targetNode.ownerSVGElement ?? root;
    const maskId = `stroke-draw-${targetId}`;
    return [...scope.querySelectorAll('[data-render-role~="reveal"]')].filter((node) => {
      const mask = node.closest("mask");
      return mask?.getAttribute("id") === maskId || mask?.getAttribute("data-render-target") === maskId;
    });
  }
  function renderTargetNodes(root, targetId) {
    const value = targetId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return [...root.querySelectorAll(`[id="${value}"], [data-render-target="${value}"]`)];
  }
  function isClippingGeometry(node) {
    return ["clip", "clip-child"].includes(node.getAttribute("data-render-projection") ?? "");
  }
  function paintRoleNodes(node, role) {
    if (isClippingGeometry(node)) return [];
    const projection = node.getAttribute("data-render-projection");
    if (projection === "fill" && role === "stroke" || projection === "stroke" && role === "fill") return [];
    if (node.tagName.toLowerCase() === "g") return [...node.querySelectorAll(`[data-render-role~="${role}"]`)];
    const roles = node.getAttribute("data-render-role");
    return !roles || roles.split(/\s+/).includes(role) ? [node] : [];
  }
  function geometryRoleNodes(root, node, targetId) {
    const geometry = node.tagName.toLowerCase() === "g" ? [...node.querySelectorAll('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]')] : [node];
    if (!isClippingGeometry(node) && node.getAttribute("data-render-projection") !== "fill") {
      for (const prefix of ["stroke-inside-", "stroke-outside-", "stroke-draw-"]) {
        for (const effect of renderTargetNodes(root, prefix + targetId)) geometry.push(...effect.querySelectorAll('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]'));
      }
    }
    return [...new Set(geometry)];
  }
  function projectedDefinitionId(node, canonicalId) {
    return renderTargetNodes(node, canonicalId)[0]?.id ?? canonicalId;
  }

  // src/rig/transform.ts
  function identityMatrix() {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  function translationMatrix(x, y) {
    return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
  }
  function scaleMatrix(x, y) {
    return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
  }
  function rotationMatrix(degrees) {
    const radians = degrees * Math.PI / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  }
  function multiplyMatrix(left, right) {
    return {
      a: left.a * right.a + left.c * right.b,
      b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d,
      d: left.b * right.c + left.d * right.d,
      e: left.a * right.e + left.c * right.f + left.e,
      f: left.b * right.e + left.d * right.f + left.f
    };
  }
  function invertMatrix(matrix) {
    const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
    if (Math.abs(determinant) < 1e-6) {
      return identityMatrix();
    }
    return {
      a: matrix.d / determinant,
      b: -matrix.b / determinant,
      c: -matrix.c / determinant,
      d: matrix.a / determinant,
      e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
      f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant
    };
  }
  function applyMatrix(matrix, x, y) {
    return {
      x: matrix.a * x + matrix.c * y + matrix.e,
      y: matrix.b * x + matrix.d * y + matrix.f
    };
  }
  function transformMatrix(transform, origin) {
    return [
      translationMatrix(transform.translateX, transform.translateY),
      translationMatrix(origin.x, origin.y),
      rotationMatrix(transform.rotation),
      scaleMatrix(transform.scaleX, transform.scaleY),
      translationMatrix(-origin.x, -origin.y)
    ].reduce((matrix, next) => multiplyMatrix(matrix, next), identityMatrix());
  }
  function decomposeTransform(matrix) {
    const scaleX = Math.hypot(matrix.a, matrix.b);
    if (scaleX < 1e-6) return void 0;
    const dot = matrix.a * matrix.c + matrix.b * matrix.d;
    if (Math.abs(dot) > 1e-5 * Math.max(1, scaleX)) return void 0;
    const scaleY = (matrix.a * matrix.d - matrix.b * matrix.c) / scaleX;
    return {
      translateX: matrix.e,
      translateY: matrix.f,
      scaleX,
      scaleY,
      rotation: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
      originX: 0,
      originY: 0
    };
  }

  // src/rig/constraint-plan.ts
  function constraintChainProblem(rig, constraint) {
    const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
    const upper = bones.get(constraint.upperBoneId), lower = bones.get(constraint.lowerBoneId), target = bones.get(constraint.targetBoneId);
    if (!upper || !lower || !target) return "a constrained bone or target is missing.";
    if (lower.parentId !== upper.id || upper.kind === "point" || lower.kind === "point" || upper.length <= 0 || lower.length <= 0) {
      return "choose two length bones in a parent-child chain.";
    }
    for (let current = target, seen = /* @__PURE__ */ new Set(); current && !seen.has(current.id); current = current.parentId ? bones.get(current.parentId) : void 0) {
      if (current.id === upper.id || current.id === lower.id) return `the target must be outside the leg or arm it controls. ${target.name} is attached inside ${upper.name} \u2192 ${lower.name}.`;
      seen.add(current.id);
    }
    return void 0;
  }
  function constraintPlan(rig) {
    const fail = (problem) => ({ ordered: [], problem });
    if (rig.constraints === void 0) return { ordered: [] };
    if (!Array.isArray(rig.constraints)) return fail("Armature constraints must be a list.");
    const bones = new Map(rig.bones.map((bone) => [bone.id, bone]));
    const ancestors = (id2) => {
      const result = /* @__PURE__ */ new Set();
      let current = bones.get(id2);
      while (current && !result.has(current.id)) {
        result.add(current.id);
        current = current.parentId ? bones.get(current.parentId) : void 0;
      }
      return result;
    };
    const ids = /* @__PURE__ */ new Set();
    const validId = (id2) => typeof id2 === "string" && id2.length > 0;
    for (const constraint of rig.constraints) {
      if (!constraint || typeof constraint !== "object" || !validId(constraint.id) || ids.has(constraint.id) || typeof constraint.name !== "string" || constraint.type !== "two-bone-ik" || typeof constraint.enabled !== "boolean" || ![1, -1].includes(constraint.bend) || ![constraint.upperBoneId, constraint.lowerBoneId, constraint.targetBoneId].every(validId)) {
        return fail("Each IK constraint needs a unique ID, name, enabled state, bend direction and bone references.");
      }
      ids.add(constraint.id);
      const problem = constraintChainProblem(rig, constraint);
      if (problem) return fail(`${constraint.name}: ${problem}`);
    }
    const enabled = rig.constraints.filter((constraint) => constraint.enabled);
    const writers = /* @__PURE__ */ new Map();
    for (const constraint of enabled) {
      for (const boneId of [constraint.upperBoneId, constraint.lowerBoneId]) {
        if (writers.has(boneId)) return fail(`${constraint.name}: a bone already belongs to another enabled IK constraint.`);
        writers.set(boneId, constraint.id);
      }
    }
    const dependencies = /* @__PURE__ */ new Map();
    for (const constraint of enabled) {
      const readBones = /* @__PURE__ */ new Set([...ancestors(constraint.upperBoneId), ...ancestors(constraint.targetBoneId)]);
      const required = /* @__PURE__ */ new Set();
      for (const boneId of readBones) {
        const writer = writers.get(boneId);
        if (writer && writer !== constraint.id) required.add(writer);
      }
      dependencies.set(constraint.id, required);
    }
    const ordered = [], completed = /* @__PURE__ */ new Set();
    while (ordered.length < enabled.length) {
      const ready = enabled.filter((constraint) => !completed.has(constraint.id) && [...dependencies.get(constraint.id)].every((id2) => completed.has(id2))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      if (!ready.length) return fail("IK target dependencies contain a cycle. Move a target outside the dependent chains.");
      for (const constraint of ready) {
        completed.add(constraint.id);
        ordered.push(constraint);
      }
    }
    return { ordered };
  }

  // src/rig/armature.ts
  function isConnectedBoneJoint(upper, lower) {
    return Math.abs(lower.x + (lower.poseX ?? 0) - upper.length) <= 0.05 && Math.abs(lower.y + (lower.poseY ?? 0)) <= 0.05;
  }
  function boneLocalMatrix(bone, posed = true) {
    return multiplyMatrix(translationMatrix(bone.x + (posed ? bone.poseX ?? 0 : 0), bone.y + (posed ? bone.poseY ?? 0 : 0)), rotationMatrix(bone.angle % 360 + (posed ? bone.pose % 360 : 0)));
  }
  function boneMatrices(rig, posed = true) {
    const result = /* @__PURE__ */ new Map(), visiting = /* @__PURE__ */ new Set();
    const visit = (bone) => {
      const known = result.get(bone.id);
      if (known) return known;
      if (visiting.has(bone.id)) throw new Error("Bone parenting contains a cycle.");
      visiting.add(bone.id);
      const parent = rig.bones.find((candidate) => candidate.id === bone.parentId);
      if (bone.parentId && !parent) throw new Error("Bone parent is missing.");
      const local = boneLocalMatrix(bone, posed);
      const matrix = multiplyMatrix(parent ? visit(parent) : identityMatrix(), local);
      if (!Object.values(matrix).every(Number.isFinite)) throw new Error("Bone transform exceeds the supported numeric range.");
      visiting.delete(bone.id);
      result.set(bone.id, matrix);
      return matrix;
    };
    rig.bones.forEach(visit);
    return result;
  }
  function weightOwner(rig, pathId, pointId) {
    const visiting = /* @__PURE__ */ new Set();
    while (true) {
      const key = JSON.stringify([pathId, pointId]);
      if (visiting.has(key)) throw new Error("Point weight links contain a cycle.");
      visiting.add(key);
      const point = rig.bindings.find((binding) => binding.pathId === pathId)?.points.find((point2) => point2.id === pointId);
      if (!point) throw new Error("A point weight source is missing.");
      if (point.id !== point.anchorId && !point.independent) {
        pointId = point.anchorId;
        continue;
      }
      if (point.weightSource) {
        pathId = point.weightSource.pathId;
        pointId = point.weightSource.pointId;
        continue;
      }
      return { pathId, pointId };
    }
  }
  function effectivePointWeights(rig, binding, point) {
    const owner = weightOwner(rig, binding.pathId, point.id);
    return rig.bindings.find((binding2) => binding2.pathId === owner.pathId).points.find((point2) => point2.id === owner.pointId).weights;
  }
  function weightOwnerLocks(rig, ref) {
    const owner = weightOwner(rig, ref.pathId, ref.pointId);
    return rig.bindings.find((binding) => binding.pathId === owner.pathId).points.find((point) => point.id === owner.pointId).lockedBoneIds ?? [];
  }
  function deformBinding(rig, binding) {
    const rest = boneMatrices(rig, false), pose = boneMatrices(rig), inverse = invertMatrix(binding.matrix);
    const transforms = new Map(rig.bones.map((bone) => [bone.id, multiplyMatrix(pose.get(bone.id), invertMatrix(rest.get(bone.id)))]));
    return new Map(binding.points.map((point) => {
      const weights = effectivePointWeights(rig, binding, point);
      if (!weights.length) return [point.id, { x: point.x, y: point.y }];
      const world = applyMatrix(binding.matrix, point.x, point.y);
      let x = 0, y = 0;
      for (const entry of weights) {
        const matrix = transforms.get(entry.boneId);
        if (!matrix) throw new Error("A weighted bone is missing.");
        const transformed = applyMatrix(matrix, world.x, world.y);
        x += transformed.x * entry.weight;
        y += transformed.y * entry.weight;
      }
      return [point.id, applyMatrix(inverse, x, y)];
    }));
  }
  function validRigs(value) {
    if (!record(value) || ![1, 2, 3, 4, 5].includes(value.version) || !Array.isArray(value.armatures)) return false;
    const rigIds = /* @__PURE__ */ new Set(), paths = /* @__PURE__ */ new Set();
    for (const rig of value.armatures) {
      if (!record(rig) || !id(rig.id) || rigIds.has(rig.id) || typeof rig.name !== "string" || !Array.isArray(rig.bones) || !Array.isArray(rig.bindings)) return false;
      rigIds.add(rig.id);
      const bones = /* @__PURE__ */ new Set();
      for (const bone of rig.bones) {
        if (!record(bone) || !id(bone.id) || bones.has(bone.id) || typeof bone.name !== "string" || !(bone.parentId === null || id(bone.parentId)) || ![bone.x, bone.y, bone.angle, bone.length, bone.pose].every(finite) || (bone.kind === "point" ? bone.length !== 0 : bone.length <= 0) || bone.kind !== void 0 && bone.kind !== "point" && bone.kind !== "bone") return false;
        if ([bone.poseX, bone.poseY].some((value2) => value2 !== void 0 && !finite(value2))) return false;
        bones.add(bone.id);
      }
      try {
        boneMatrices(rig);
      } catch {
        return false;
      }
      if (rig.constraintsActive !== void 0 && typeof rig.constraintsActive !== "boolean") return false;
      if (constraintPlan(rig).problem) return false;
      if (rig.constraintsActive !== false && rig.constraints?.some((constraint) => constraint.enabled && !isConnectedBoneJoint(rig.bones.find((bone) => bone.id === constraint.upperBoneId), rig.bones.find((bone) => bone.id === constraint.lowerBoneId)))) return false;
      if (rig.attachments !== void 0 && !Array.isArray(rig.attachments)) return false;
      for (const attachment of rig.attachments ?? []) {
        if (!record(attachment) || !id(attachment.elementId) || paths.has(attachment.elementId) || !bones.has(attachment.boneId) || !validMatrix(attachment.parentMatrix) || !validMatrix(attachment.worldMatrix) || !record(attachment.restTransform) || !["translateX", "translateY", "rotation", "scaleX", "scaleY"].every((key) => finite(attachment.restTransform[key])) || ["originX", "originY"].some((key) => attachment.restTransform[key] !== void 0 && !finite(attachment.restTransform[key]))) return false;
        paths.add(attachment.elementId);
      }
      for (const binding of rig.bindings) {
        if (!record(binding) || !id(binding.pathId) || paths.has(binding.pathId) || !record(binding.matrix) || !["a", "b", "c", "d", "e", "f"].every((key) => finite(binding.matrix[key])) || Math.abs(binding.matrix.a * binding.matrix.d - binding.matrix.b * binding.matrix.c) < 1e-6 || typeof binding.topology !== "string" || !Array.isArray(binding.points)) return false;
        if (binding.scopeId !== void 0 && !id(binding.scopeId)) return false;
        if (binding.boneIds !== void 0 && (!Array.isArray(binding.boneIds) || !binding.boneIds.length || new Set(binding.boneIds).size !== binding.boneIds.length || binding.boneIds.some((id2) => !bones.has(id2)))) return false;
        paths.add(binding.pathId);
        const points = /* @__PURE__ */ new Set();
        for (const point of binding.points) {
          if (!record(point) || !id(point.id) || points.has(point.id) || !id(point.anchorId) || !finite(point.x) || !finite(point.y) || !Array.isArray(point.weights)) return false;
          points.add(point.id);
          const influences = /* @__PURE__ */ new Set();
          let sum = 0;
          for (const entry of point.weights) {
            if (!record(entry) || !bones.has(entry.boneId) || binding.boneIds && !binding.boneIds.includes(entry.boneId) || influences.has(entry.boneId) || !finite(entry.weight) || entry.weight <= 0) return false;
            influences.add(entry.boneId);
            sum += entry.weight;
          }
          if (point.weights.length && Math.abs(sum - 1) > 1e-6) return false;
          if (point.independent !== void 0 && (typeof point.independent !== "boolean" || point.id === point.anchorId)) return false;
          if (point.weightSource !== void 0 && (!record(point.weightSource) || !id(point.weightSource.pathId) || !id(point.weightSource.pointId))) return false;
          if (point.weightSource && point.weights.length) return false;
          if (point.id !== point.anchorId && !point.independent && (point.weights.length || point.weightSource)) return false;
          if (point.lockedBoneIds !== void 0 && (value.version < 5 || !Array.isArray(point.lockedBoneIds) || new Set(point.lockedBoneIds).size !== point.lockedBoneIds.length || point.lockedBoneIds.some((boneId) => !bones.has(boneId) || binding.boneIds && !binding.boneIds.includes(boneId)) || point.weightSource || point.id !== point.anchorId && !point.independent)) return false;
        }
        if (binding.points.some((point) => !binding.points.some((anchor) => anchor.id === point.anchorId && anchor.id === anchor.anchorId))) return false;
      }
      for (const binding of rig.bindings) for (const point of binding.points) {
        try {
          if (point.weightSource) {
            const source = rig.bindings.find((binding2) => binding2.pathId === point.weightSource.pathId)?.points.find((candidate) => candidate.id === point.weightSource.pointId);
            if (!source || source.weightSource || source.id !== source.anchorId && !source.independent) return false;
          }
          const weights = effectivePointWeights(rig, binding, point);
          if (binding.boneIds && weights.some((entry) => !binding.boneIds.includes(entry.boneId))) return false;
          if (binding.boneIds && weightOwnerLocks(rig, { pathId: binding.pathId, pointId: point.id }).some((boneId) => !binding.boneIds.includes(boneId))) return false;
        } catch {
          return false;
        }
      }
    }
    return true;
  }
  function record(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }
  function id(value) {
    return typeof value === "string" && value.length > 0;
  }
  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function validMatrix(value) {
    return record(value) && ["a", "b", "c", "d", "e", "f"].every((key) => finite(value[key])) && Number.isFinite(value.a * value.d - value.b * value.c) && Math.abs(value.a * value.d - value.b * value.c) >= 1e-6;
  }
  function hasBonePose(bone) {
    return bone.pose !== 0 || !!bone.poseX || !!bone.poseY;
  }

  // src/rig/two-bone-ik.ts
  function twoBoneChain(rig, endId) {
    const lower = rig.bones.find((bone) => bone.id === endId), upper = rig.bones.find((bone) => bone.id === lower?.parentId);
    if (!lower || !upper || lower.kind === "point" || upper.kind === "point" || lower.length <= 0 || upper.length <= 0) return;
    if (!isConnectedBoneJoint(upper, lower)) return;
    return { upper, lower };
  }
  function solveTwoBoneIK(rig, endId, target, bend) {
    const chain = twoBoneChain(rig, endId);
    if (!chain || ![target.x, target.y].every(Number.isFinite)) return;
    const solved = structuredClone(rig);
    const bones = new Map(solved.bones.map((bone) => [bone.id, bone]));
    return solveTwoBoneIKInto(bones.get(chain.upper.id), bones.get(chain.lower.id), boneMatrices(rig), target, bend) ? solved : void 0;
  }
  function solveTwoBoneIKInto(upper, lower, matrices, target, bend) {
    if (!isConnectedBoneJoint(upper, lower) || ![target.x, target.y].every(Number.isFinite)) return false;
    const parent = upper.parentId ? matrices.get(upper.parentId) : void 0;
    const local = parent ? applyMatrix(invertMatrix(parent), target.x, target.y) : target;
    const x = local.x - upper.x - (upper.poseX ?? 0), y = local.y - upper.y - (upper.poseY ?? 0);
    const jointX = lower.x + (lower.poseX ?? 0), jointY = lower.y + (lower.poseY ?? 0);
    const a = Math.hypot(jointX, jointY), b = lower.length, offset = Math.atan2(jointY, jointX);
    if (a < 1e-8) return false;
    const distance3 = Math.max(Math.abs(a - b), Math.min(a + b, Math.hypot(x, y)));
    const elbow = bend * Math.acos(Math.max(-1, Math.min(1, (distance3 * distance3 - a * a - b * b) / (2 * a * b))));
    const heading = Math.hypot(x, y) > 1e-8 ? Math.atan2(y, x) : (upper.angle + upper.pose) * Math.PI / 180 + offset;
    const shoulder = distance3 < 1e-8 ? heading : heading - Math.atan2(b * Math.sin(elbow), a + b * Math.cos(elbow));
    const nearest = (angle, reference) => reference + ((angle - reference + 180) % 360 + 360) % 360 - 180;
    upper.pose = nearest((shoulder - offset) * 180 / Math.PI - upper.angle, upper.pose);
    lower.pose = nearest((elbow + offset) * 180 / Math.PI - lower.angle, lower.pose);
    return true;
  }

  // src/rig/evaluation-plan.ts
  var RigEvaluationPlan = class {
    constructor(source) {
      this.paths = /* @__PURE__ */ new Map();
      this.transforms = /* @__PURE__ */ new Map();
      this.order = [];
      this.matrices = /* @__PURE__ */ new Map();
      this.skin = /* @__PURE__ */ new Map();
      const plan = constraintPlan(source);
      if (plan.problem) throw new Error(plan.problem);
      this.pose = structuredClone(source);
      this.bones = new Map(this.pose.bones.map((bone) => [bone.id, bone]));
      const rest = boneMatrices(this.pose, false);
      this.restInverse = new Map([...rest].map(([id2, matrix]) => [id2, invertMatrix(matrix)]));
      this.order = [...rest.keys()].map((id2) => this.bones.get(id2));
      this.constraints = plan.ordered.map((constraint) => ({
        ...constraint,
        upper: this.bones.get(constraint.upperBoneId),
        lower: this.bones.get(constraint.lowerBoneId)
      }));
      this.bindings = this.pose.bindings.map((binding) => {
        const output = /* @__PURE__ */ new Map();
        this.paths.set(binding.pathId, output);
        return { inverse: invertMatrix(binding.matrix), points: binding.points.map((point) => {
          const value = { x: point.x, y: point.y };
          output.set(point.id, value);
          return {
            value,
            rest: { x: point.x, y: point.y },
            world: applyMatrix(binding.matrix, point.x, point.y),
            weights: effectivePointWeights(this.pose, binding, point)
          };
        }) };
      });
      this.attachments = (this.pose.attachments ?? []).map((link) => ({ ...link, inverse: invertMatrix(link.parentMatrix) }));
    }
    evaluate(source, constraintsActive = source.constraintsActive !== false) {
      for (const bone of source.bones) {
        const output = this.bones.get(bone.id);
        if (!output) throw new Error("Rig setup changed; rebuild its evaluation plan.");
        output.pose = bone.pose;
        output.poseX = bone.poseX;
        output.poseY = bone.poseY;
      }
      this.pose.constraintsActive = constraintsActive;
      this.updateMatrices();
      if (constraintsActive) for (const constraint of this.constraints) {
        const target = applyMatrix(this.matrices.get(constraint.targetBoneId), 0, 0);
        if (!solveTwoBoneIKInto(constraint.upper, constraint.lower, this.matrices, target, constraint.bend)) {
          throw new Error(`${constraint.name}: this two-bone chain cannot reach a valid pose. Use Reconnect joint in Bone setup before posing.`);
        }
        this.updateMatrices(/* @__PURE__ */ new Set([constraint.upper.id, constraint.lower.id]));
      }
      for (const bone of this.order) this.skin.set(bone.id, multiplyMatrix(this.matrices.get(bone.id), this.restInverse.get(bone.id)));
      for (const binding of this.bindings) for (const point of binding.points) {
        if (!point.weights.length) {
          Object.assign(point.value, point.rest);
          continue;
        }
        let x = 0, y = 0;
        for (const weight of point.weights) {
          const matrix = this.skin.get(weight.boneId);
          if (!matrix) throw new Error("A weighted bone is missing.");
          x += (matrix.a * point.world.x + matrix.c * point.world.y + matrix.e) * weight.weight;
          y += (matrix.b * point.world.x + matrix.d * point.world.y + matrix.f) * weight.weight;
        }
        Object.assign(point.value, applyMatrix(binding.inverse, x, y));
        if (!Number.isFinite(point.value.x) || !Number.isFinite(point.value.y)) throw new Error("This pose exceeds the supported coordinate range.");
      }
      const posed = this.pose.bones.some(hasBonePose);
      for (const link of this.attachments) {
        const transform = posed ? decomposeTransform(multiplyMatrix(link.inverse, multiplyMatrix(this.skin.get(link.boneId), link.worldMatrix))) : { ...link.restTransform };
        if (!transform) throw new Error("This pose would introduce skew under a scaled parent. Use a uniformly scaled parent for rigid attachments, or bind path points instead.");
        this.transforms.set(link.elementId, transform);
      }
      return this;
    }
    updateMatrices(changed) {
      for (const bone of this.order) {
        if (changed && !changed.has(bone.id) && !(bone.parentId && changed.has(bone.parentId))) continue;
        changed?.add(bone.id);
        const matrix = multiplyMatrix(bone.parentId ? this.matrices.get(bone.parentId) : identityMatrix(), boneLocalMatrix(bone));
        if (!Object.values(matrix).every(Number.isFinite)) throw new Error("Bone transform exceeds the supported numeric range.");
        this.matrices.set(bone.id, matrix);
      }
    }
  };

  // src/rig/channels.ts
  function parseRigAnimationProperty(property) {
    const match = /^bones\.(.+)\.(pose|poseX|poseY)$/.exec(property);
    return match ? { boneId: match[1], field: match[2] } : void 0;
  }

  // src/curve-range.ts
  function lerpCurvePoint(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function cubicPoint(a, b, c, d, t) {
    const m = 1 - t;
    return { x: m * m * m * a.x + 3 * m * m * t * b.x + 3 * m * t * t * c.x + t * t * t * d.x, y: m * m * m * a.y + 3 * m * m * t * b.y + 3 * m * t * t * c.y + t * t * t * d.y };
  }
  function splitCubic(a, b, c, d, t) {
    const ab = lerpCurvePoint(a, b, t), bc = lerpCurvePoint(b, c, t), cd = lerpCurvePoint(c, d, t);
    const abc = lerpCurvePoint(ab, bc, t), bcd = lerpCurvePoint(bc, cd, t), point = lerpCurvePoint(abc, bcd, t);
    return [[{ ...a }, ab, abc, point], [point, bcd, cd, { ...d }]];
  }
  function cubicRange(a, b, c, d, start, end) {
    const left = splitCubic(a, b, c, d, end)[0];
    return start <= 0 ? left : splitCubic(...left, start / Math.max(end, 1e-12))[1];
  }
  function curvePoint(line, t) {
    return line.type === "bezier" && line.controlStart && line.controlEnd ? cubicPoint(line.points[0], line.controlStart, line.controlEnd, line.points[1], t) : lerpCurvePoint(line.points[0], line.points[1], t);
  }
  function curveLengthSamples(line, steps = 64) {
    if (line.type !== "bezier" || !line.controlStart || !line.controlEnd) return [{ t: 0, length: 0 }, { t: 1, length: Math.hypot(line.points[1].x - line.points[0].x, line.points[1].y - line.points[0].y) }];
    const samples = [{ t: 0, length: 0 }];
    let previous = line.points[0], length = 0;
    for (let index = 1; index <= steps; index++) {
      const t = index / steps, point = curvePoint(line, t);
      length += Math.hypot(point.x - previous.x, point.y - previous.y);
      samples.push({ t, length });
      previous = point;
    }
    return samples;
  }

  // src/stroke-expansion.ts
  function strokeNormal(direction2, side) {
    return { x: -direction2.y * side, y: direction2.x * side };
  }
  function strokeOffset(point, normal, distance3) {
    return { x: point.x + normal.x * distance3, y: point.y + normal.y * distance3 };
  }

  // src/outline.ts
  var EPSILON = 1e-8;
  function outlineContourSegments(contour) {
    const lines = contour.lines.filter((line) => line.points.length >= 2);
    const first = lines[0]?.points[0], last = lines[lines.length - 1]?.points[1];
    return contour.closed && first && last && first.id !== last.id ? [...lines, { id: `${contour.id}:close`, type: "line", points: [last, first] }] : lines;
  }
  function outlineSectionLines(contour, section, rounded = true) {
    const segments = outlineContourSegments(contour);
    const start = segments.findIndex((line) => line.id === section.start.segmentId), end = segments.findIndex((line) => line.id === section.end.segmentId);
    if (start < 0 || end < 0) return [];
    const from = start + clamp(section.start.t);
    let to = end + clamp(section.end.t);
    if (section.fullContour && contour.closed) to = from + segments.length;
    else if (contour.closed && to < from) to += segments.length;
    if (to <= from + EPSILON) return [];
    const result = [];
    for (let index = Math.floor(from); index < Math.ceil(to); index++) {
      const local = index % segments.length, rangeStart = Math.max(0, from - index), rangeEnd = Math.min(1, to - index);
      mappedPieces(segments, local, contour.closed, rounded).forEach((piece) => {
        const a = Math.max(rangeStart, piece.from), b = Math.min(rangeEnd, piece.to);
        if (b - a > EPSILON) result.push(rangeLine(piece.line, (a - piece.from) / (piece.to - piece.from), (b - piece.from) / (piece.to - piece.from)));
      });
    }
    return result;
  }
  function projectOutlineSections(contours, sections, style) {
    const completeSamples = /* @__PURE__ */ new Map();
    const projected = sections.flatMap((section) => {
      const contour = contours.find((contour2) => contour2.id === section.contourId);
      if (!contour) return [];
      const lines = outlineSectionLines(contour, section, style.rounded !== false), samples = flatten(lines);
      if (samples.length < 2 || samples[samples.length - 1].distance <= EPSILON) return [];
      const length = samples[samples.length - 1].distance;
      const full = fullSection(contour);
      if (section.start.segmentId === full.start.segmentId && section.start.t === 0 && section.end.segmentId === full.end.segmentId && section.end.t === 1 && !!section.fullContour === !!full.fullContour) completeSamples.set(contour, samples);
      return [{ section, contour, lines, samples: taperSamples(samples, section, length), length }];
    });
    const total = projected.reduce((sum, item) => sum + item.length, 0);
    let budget = total * clamp(style.drawProgress ?? 1);
    const problem = outlineDashComplexityProblem(total, style.dasharray ?? []);
    const stroke = [];
    projected.forEach((item) => {
      const visible = Math.min(item.length, Math.max(0, budget));
      budget -= item.length;
      const ranges = problem ? [] : dashRanges(visible, style.dasharray ?? [], style.dashoffset ?? 0);
      const wholeClosed = !!item.section.fullContour && item.contour.closed && visible === item.length && !(item.section.startTaper?.length || item.section.endTaper?.length);
      if (wholeClosed && ranges.length > 1 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === item.length) {
        const first = ranges.shift(), last = ranges.pop();
        stroke.push(expandStroke([...sampleRange(item.samples, last[0], last[1]), ...sampleRange(item.samples, first[0], first[1]).slice(1)], item.length, item.section, style, false));
      }
      ranges.forEach(([start, end]) => {
        const samples = sampleRange(item.samples, start, end);
        const closed = wholeClosed && start === 0 && end === item.length;
        stroke.push(expandStroke(samples, item.length, item.section, style, closed));
      });
    });
    const source = contours.flatMap((contour) => completeSamples.get(contour) ?? flatten(outlineSectionLines(contour, fullSection(contour), style.rounded !== false)));
    return {
      strokeData: stroke.filter(Boolean).join(" "),
      sections: projected.map((item) => ({ id: item.section.id, data: buildRuntimePathData([{ id: item.section.id, closed: !!item.section.fullContour && item.contour.closed, lines: item.lines }], false), length: item.length, start: item.samples[0], end: item.samples[item.samples.length - 1] })),
      sourceBounds: bounds(source),
      ...problem ? { problem } : {}
    };
  }
  function outlineSectionsProblem(contours, sections) {
    if (!Array.isArray(sections)) return "Outline sections must be a list.";
    const ids = /* @__PURE__ */ new Set(), occupied = /* @__PURE__ */ new Map();
    for (const section of sections) {
      if (!section || typeof section.id !== "string" || !section.id || ids.has(section.id)) return "Outline section IDs must be unique.";
      ids.add(section.id);
      const contour = contours.find((contour2) => contour2.id === section.contourId);
      if (!contour) return "An outline section refers to a missing contour.";
      const segments = outlineContourSegments(contour);
      for (const position of [section.start, section.end]) if (!position || !Number.isFinite(position.t) || position.t < 0 || position.t > 1 || !segments.some((line) => line.id === position.segmentId)) return "An outline endpoint refers to a missing segment or invalid curve position.";
      for (const taper of [section.startTaper, section.endTaper]) if (taper !== void 0 && (!taper || typeof taper !== "object" || ![taper.length, taper.tipWidth].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))) return "Outline taper values must be between zero and one.";
      if (section.fullContour !== void 0 && typeof section.fullContour !== "boolean") return "The full-contour flag must be a boolean.";
      if ((section.startTaper?.length ?? 0) + (section.endTaper?.length ?? 0) > 1 + EPSILON) return "The two outline tapers cannot overlap.";
      if (section.fullContour && !contour.closed) return "A whole-contour outline requires a closed contour.";
      const start = segments.findIndex((line) => line.id === section.start.segmentId) + section.start.t;
      let end = segments.findIndex((line) => line.id === section.end.segmentId) + section.end.t;
      if (section.fullContour) end = start + segments.length;
      else if (end < start && contour.closed) end += segments.length;
      else if (end < start) return "An open outline must end after its start.";
      const ranges = end <= segments.length ? [[start, end]] : [[start, segments.length], [0, end - segments.length]];
      const others = occupied.get(contour.id) ?? [];
      if (ranges.some(([a, b]) => others.some(([c, d]) => Math.min(b, d) - Math.max(a, c) > EPSILON))) return "Outline sections cannot overlap.";
      occupied.set(contour.id, [...others, ...ranges]);
    }
    return void 0;
  }
  function fullSection(contour) {
    const lines = outlineContourSegments(contour);
    return { id: `${contour.id}:outline`, contourId: contour.id, start: { segmentId: lines[0]?.id ?? "", t: 0 }, end: { segmentId: lines[lines.length - 1]?.id ?? "", t: 1 }, ...contour.closed ? { fullContour: true } : {} };
  }
  function mappedPieces(lines, index, closed, rounded) {
    const line = lines[index];
    if (!rounded) return [{ line, from: 0, to: 1 }];
    const neighbor = (step) => {
      for (let offset = 1; offset < lines.length; offset++) {
        const at = index + step * offset;
        if (!closed && (at < 0 || at >= lines.length)) return void 0;
        const candidate = lines[(at + lines.length) % lines.length];
        if (candidate.type === "bezier" || distance2(candidate.points[0], candidate.points[1]) > EPSILON) return candidate;
      }
      return void 0;
    };
    const previous = neighbor(-1), next = neighbor(1);
    const start = previous ? roundedCorner(previous, line) : null;
    const end = next ? roundedCorner(line, next) : null;
    if (!start && !end) return [{ line, from: 0, to: 1 }];
    const length = distance2(line.points[0], line.points[1]);
    if (length <= EPSILON) return [{ line, from: 0, to: 1 }];
    const from = start ? distance2(line.points[0], start.after) / length : 0;
    const to = end ? 1 - distance2(line.points[1], end.before) / length : 1;
    const pieces = [];
    if (start) pieces.push({ line: cubicLine(line.id, splitCubic(start.before, start.controlBefore, start.controlAfter, start.after, 0.5)[1]), from: 0, to: from });
    pieces.push({ line: { id: line.id, type: "line", points: [start?.after ?? line.points[0], end?.before ?? line.points[1]] }, from, to });
    if (end) pieces.push({ line: cubicLine(line.id, splitCubic(end.before, end.controlBefore, end.controlAfter, end.after, 0.5)[0]), from: to, to: 1 });
    return pieces;
  }
  function rangeLine(line, start, end) {
    if (line.type === "bezier" && line.controlStart && line.controlEnd) return cubicLine(line.id, cubicRange(line.points[0], line.controlStart, line.controlEnd, line.points[1], start, end));
    return { id: line.id, type: "line", points: [runtimePoint2(lerpCurvePoint(line.points[0], line.points[1], start)), runtimePoint2(lerpCurvePoint(line.points[0], line.points[1], end))] };
  }
  function cubicLine(id2, points) {
    return { id: id2, type: "bezier", points: [runtimePoint2(points[0]), runtimePoint2(points[3])], controlStart: runtimePoint2(points[1]), controlEnd: runtimePoint2(points[2]) };
  }
  function runtimePoint2(point) {
    return { id: "", ...point };
  }
  function flatten(lines) {
    const result = [];
    let length = 0;
    for (const line of lines) {
      const samples = curveLengthSamples(line);
      for (let index = 0; index < samples.length; index++) {
        const point = curvePoint(line, samples[index].t), previous = result[result.length - 1];
        if (previous) {
          const delta = distance2(point, previous);
          if (delta <= EPSILON) continue;
          length += delta;
        }
        result.push({ x: point.x, y: point.y, distance: length });
      }
    }
    return result;
  }
  function sampleRange(source, start, end) {
    if (end - start <= EPSILON) return [sampleAtDistance(source, start)];
    return [sampleAtDistance(source, start), ...source.filter((point) => point.distance > start + EPSILON && point.distance < end - EPSILON), sampleAtDistance(source, end)];
  }
  function sampleAtDistance(source, desired) {
    let low = 0, high = source.length;
    while (low < high) {
      const middle = low + high >>> 1;
      if (source[middle].distance < desired) low = middle + 1;
      else high = middle;
    }
    const after = low === source.length ? -1 : low;
    if (after < 0) {
      const last = source[source.length - 1];
      return { x: last.x, y: last.y, distance: desired, tangent: direction(source[source.length - 2] ?? source[0], last) };
    }
    if (after === 0) return { x: source[0].x, y: source[0].y, distance: desired, tangent: direction(source[0], source[1] ?? source[0]) };
    const a = source[after - 1], b = source[after], t = (desired - a.distance) / (b.distance - a.distance);
    const point = lerpCurvePoint(a, b, t);
    return { x: point.x, y: point.y, distance: desired, tangent: direction(a, b) };
  }
  function taperSamples(source, section, length) {
    const distances = source.map((point) => point.distance);
    for (const [taper, end] of [[section.startTaper, false], [section.endTaper, true]]) {
      if (!taper || taper.length <= 0 || taper.tipWidth === 1) continue;
      for (let index = 0; index <= 32; index++) distances.push(end ? length * (1 - taper.length * index / 32) : length * taper.length * index / 32);
    }
    return [...new Set(distances)].sort((a, b) => a - b).map((value) => sampleAtDistance(source, value));
  }
  function outlineDashComplexityProblem(length, input) {
    const pattern = input.filter((value) => Number.isFinite(value) && value >= 0), total = pattern.reduce((sum, value) => sum + value, 0);
    if (total > 0 && length / total * pattern.length > 4e4) return "This dash pattern creates more than 20,000 outline dashes. Increase the dash lengths or remove dashes before editing the outline.";
    return void 0;
  }
  function outlineProjectionProblem(contours, sections, style) {
    const length = sections.reduce((total, section) => {
      const contour = contours.find((contour2) => contour2.id === section.contourId);
      if (!contour) return total;
      return total + outlineSectionLines(contour, section, style.rounded !== false).reduce((sum, line) => {
        const samples = curveLengthSamples(line);
        return sum + samples[samples.length - 1].length;
      }, 0);
    }, 0);
    return outlineDashComplexityProblem(length, style.dasharray ?? []);
  }
  function dashRanges(length, input, offset) {
    const normalized = input.filter((value) => Number.isFinite(value) && value >= 0);
    const pattern = normalized.length % 2 ? [...normalized, ...normalized] : normalized;
    const total = pattern.reduce((sum, value) => sum + value, 0);
    if (length <= EPSILON) return [];
    if (total <= EPSILON) return [[0, length]];
    let phase = (offset % total + total) % total, index = 0;
    while (phase > EPSILON && phase >= pattern[index] && index < pattern.length - 1) {
      phase -= pattern[index];
      index++;
    }
    let remaining = pattern[index] - phase, consumed = 0;
    const result = [];
    while (consumed <= length + EPSILON) {
      if (remaining <= EPSILON) {
        if (index % 2 === 0 && pattern[index] === 0) result.push([consumed, consumed]);
        index = (index + 1) % pattern.length;
        remaining = pattern[index];
        continue;
      }
      if (consumed >= length - EPSILON) break;
      const next = Math.min(length, consumed + remaining);
      if (index % 2 === 0) result.push([consumed, next]);
      remaining -= next - consumed;
      consumed = next;
    }
    return result;
  }
  function expandStroke(source, sectionLength, section, style, closed) {
    if (!source.length || style.width <= 0) return "";
    if (source.length === 1) {
      const point = source[0], half2 = style.width * (style.alignment && style.alignment !== "center" ? 1 : 0.5) * taperAt(point.distance / sectionLength, section);
      if (style.lineCap === "round") return polygon(Array.from({ length: 32 }, (_, index) => ({ x: point.x + Math.cos(index * Math.PI / 16) * half2, y: point.y + Math.sin(index * Math.PI / 16) * half2 })));
      if (style.lineCap === "square") {
        const tangent = point.tangent ?? { x: 1, y: 0 }, normal = strokeNormal(tangent, 1);
        return polygon([add(add(point, tangent, -half2), normal, -half2), add(add(point, tangent, half2), normal, -half2), add(add(point, tangent, half2), normal, half2), add(add(point, tangent, -half2), normal, half2)]);
      }
      return "";
    }
    let points = source;
    if (closed && distance2(points[0], points[points.length - 1]) <= EPSILON) points = points.slice(0, -1);
    const half = style.width * (style.alignment && style.alignment !== "center" ? 1 : 0.5);
    const radius = (point) => half * taperAt(point.distance / sectionLength, section);
    const left = [], right = [];
    points.forEach((point, index) => {
      const previous = points[index - 1] ?? (closed ? points[points.length - 1] : void 0);
      const next = points[index + 1] ?? (closed ? points[0] : void 0);
      const before = previous ? direction(previous, point) : direction(point, next);
      const after = next ? direction(point, next) : before;
      const width = radius(point);
      left.push(...joinPoints(point, before, after, width, 1, style));
      right.push(...joinPoints(point, before, after, width, -1, style));
    });
    if (closed) return polygon(left) + " " + polygon([...right].reverse());
    const start = points[0], end = points[points.length - 1];
    const startDirection = direction(points[0], points[1]), endDirection = direction(points[points.length - 2], end);
    if (style.lineCap === "square") {
      for (const edge of [left, right]) {
        edge[0] = add(edge[0], startDirection, -radius(start));
        edge[edge.length - 1] = add(edge[edge.length - 1], endDirection, radius(end));
      }
    }
    const endCap = style.lineCap === "round" ? arc(end, left[left.length - 1], right[right.length - 1], -1) : [];
    const startCap = style.lineCap === "round" ? arc(start, right[0], left[0], -1) : [];
    return polygon([...left, ...endCap, ...right.reverse(), ...startCap]);
  }
  function joinPoints(point, before, after, width, side, style) {
    const a = strokeNormal(before, side), b = strokeNormal(after, side);
    const p = add(point, a, width), q = add(point, b, width), cross = before.x * after.y - before.y * after.x;
    if (Math.abs(cross) < 1e-6) return [q];
    const denominator = 1 + a.x * b.x + a.y * b.y;
    const miter = denominator > 1e-6 ? { x: point.x + (a.x + b.x) * width / denominator, y: point.y + (a.y + b.y) * width / denominator } : q;
    const outer = cross * side < 0;
    if (!outer) return [distance2(miter, point) < width * 20 ? miter : q];
    if (style.lineJoin === "round") return [p, ...arc(point, p, q, Math.sign(cross)), q];
    if (style.lineJoin === "bevel" || distance2(miter, point) > width * (style.miterLimit ?? 4)) return [p, q];
    return [miter];
  }
  function taperAt(t, section) {
    const start = section.startTaper, end = section.endTaper;
    const startLength = clamp(start?.length ?? 0), endLength = Math.min(1 - startLength, clamp(end?.length ?? 0));
    if (start && startLength > 0 && t < startLength) return clamp(start.tipWidth) + (1 - clamp(start.tipWidth)) * smooth(t / startLength);
    if (end && endLength > 0 && t > 1 - endLength) return clamp(end.tipWidth) + (1 - clamp(end.tipWidth)) * smooth((1 - t) / endLength);
    return 1;
  }
  function smooth(t) {
    t = clamp(t);
    return t * t * (3 - 2 * t);
  }
  function arc(center, start, end, orientation) {
    const radius = distance2(center, start);
    if (radius <= EPSILON) return [];
    const a = Math.atan2(start.y - center.y, start.x - center.x);
    let delta = Math.atan2(end.y - center.y, end.x - center.x) - a;
    if (orientation > 0 && delta < 0) delta += Math.PI * 2;
    if (orientation < 0 && delta > 0) delta -= Math.PI * 2;
    const count = Math.max(2, Math.ceil(Math.abs(delta) * 8));
    return Array.from({ length: count - 1 }, (_, index) => {
      const angle = a + delta * (index + 1) / count;
      return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    });
  }
  function polygon(points) {
    return points.length < 3 ? "" : `M ${points.map((point) => `${round2(point.x)} ${round2(point.y)}`).join(" L ")} Z`;
  }
  function bounds(points) {
    if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
    const xs = points.map((point) => point.x), ys = points.map((point) => point.y), x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }
  function direction(a, b) {
    const length = distance2(a, b);
    return { x: (b.x - a.x) / Math.max(EPSILON, length), y: (b.y - a.y) / Math.max(EPSILON, length) };
  }
  var add = strokeOffset;
  function distance2(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function clamp(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }
  function round2(value) {
    return Math.round(value * 1e4) / 1e4;
  }

  // src/scene.ts
  var MIN_VISIBLE_DRAW_PROGRESS = 2e-4;
  var RuntimeScene = class {
    constructor(root, sourceTargets, rigs) {
      this.root = root;
      this.targetById = /* @__PURE__ */ new Map();
      this.targetNodesById = /* @__PURE__ */ new Map();
      this.targets = clone(sourceTargets);
      this.rigs = rigs && clone(rigs);
      this.rigPlans = this.rigs?.armatures.map((rig) => new RigEvaluationPlan(rig)) ?? [];
      this.targets.forEach((target) => this.targetById.set(target.id, target));
    }
    write(targetId, property, value) {
      const boneChannel = parseRigAnimationProperty(property);
      if (boneChannel) {
        const bone = this.rigs?.armatures.find((rig) => rig.id === targetId)?.bones.find((bone2) => bone2.id === boneChannel.boneId);
        if (!bone || typeof value !== "number" || !Number.isFinite(value)) return false;
        bone[boneChannel.field] = value;
        return true;
      }
      const target = this.targetById.get(targetId);
      if (!target) return false;
      const point = /^path\.points\.([^.]+)\.(x|y)$/.exec(property);
      if (point && target.path) return this.writePathPoint(target, point[1], point[2], value);
      const gradient = /^settings\.(fill|stroke|color)\.gradient\.(?:(x1|y1|x2|y2|cx|cy|r|fx|fy)|transform\.(a|b|c|d|e|f)|stops\.(.+)\.(offset|color|opacity))$/.exec(property);
      if (gradient) return this.writeGradient(target, gradient, value);
      const numeric = finite2(value);
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
      this.applyRigs();
      for (const target of this.targets) if (target.path?.outlineSections && target.stroke) {
        const problem = outlineProjectionProblem(target.path.contours, target.path.outlineSections, { ...target.stroke, rounded: target.path.rounded });
        if (problem) throw new RuntimePlayerError("invalid-bundle", problem);
      }
      this.targets.forEach((target) => {
        const transform = matrixToSvg(this.motionAdjustedMatrix(target));
        this.nodes(target.id).forEach((node) => {
          const clipping = isClippingGeometry(node);
          node.style.display = node.getAttribute("data-render-projection") === "clip" || target.visible ? "" : "none";
          setAttribute(node, "opacity", clipping || target.opacity === 1 ? null : round3(target.opacity));
          setAttribute(node, "transform", transform);
          this.renderGeometry(node, target);
          if (!clipping) this.renderAppearance(node, target);
        });
        this.renderGradients(target);
      });
    }
    clear() {
      this.targetNodesById.clear();
    }
    /** Recompute from captured rest points on every seek; solved FK never replaces authored channels. */
    applyRigs() {
      const evaluated = this.rigPlans.map((plan, index) => plan.evaluate(this.rigs.armatures[index], true));
      for (const rig of evaluated) {
        for (const [id2, points] of rig.paths) {
          const target = this.targetById.get(id2);
          forEachPathPoint(target.path.contours, (point) => {
            const posed = points.get(point.id);
            if (posed) {
              point.x = posed.x;
              point.y = posed.y;
            }
          });
          target.geometry = pathBounds(target.path.contours);
        }
        for (const [id2, transform] of rig.transforms) {
          const target = this.targetById.get(id2);
          target.transform = { ...transform, originX: transform.originX ?? 0, originY: transform.originY ?? 0, autoOrigin: false };
        }
      }
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
    writePathPoint(target, id2, axis, value) {
      if (!target.path) return false;
      const before = target.geometry;
      if (!writePathPoint(target.path.contours, id2, axis, value)) return false;
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
      const numeric = finite2(value);
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
      const geometryNodes = geometryRoleNodes(this.root, node, target.id);
      if (target.path) {
        const contours = target.path.explicitClosure || target.path.outlineSections !== void 0 ? target.path.contours : legacyRenderContours(target.path.contours);
        const data = buildRuntimePathData(contours, target.path.rounded);
        geometryNodes.forEach((item) => setAttribute(item, "d", data));
        if (isClippingGeometry(node)) return;
        if (target.path.outlineSections !== void 0 && target.stroke) {
          const projection = projectOutlineSections(target.path.contours, target.path.outlineSections, { ...target.stroke, drawProgress: target.path.drawProgress, rounded: target.path.rounded });
          node.querySelectorAll('[data-render-role~="outline"]').forEach((item) => setAttribute(item, "d", projection.strokeData));
          const paint = target.paints.stroke;
          if (paint?.kind === "gradient") this.nodes(`outline-paint-${target.id}`).forEach((gradient) => {
            const bounds2 = projection.sourceBounds, [a, b, c, d, e, f] = paint.transform;
            setAttribute(gradient, "gradientTransform", `matrix(${[bounds2.width * a, bounds2.height * b, bounds2.width * c, bounds2.height * d, bounds2.x + bounds2.width * e, bounds2.y + bounds2.height * f].map(round3).join(" ")})`);
          });
          return;
        }
        const progress = clamp01(target.path.drawProgress);
        const reveal = pathRevealNodes(this.root, node, target.id);
        if (reveal.length) reveal.forEach((item) => setAttribute(item, "stroke-dashoffset", round3(1 - progress)));
        else this.roleNodes(node, "stroke").forEach((item) => {
          setAttribute(item, "pathLength", progress < 1 ? 1 : null);
          setAttribute(item, "stroke-dasharray", progress < 1 ? "1 2" : target.stroke?.dasharray.join(" ") || null);
          setAttribute(item, "stroke-dashoffset", progress < 1 ? round3(1 - progress) : target.stroke?.dasharray.length ? target.stroke.dashoffset : null);
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
      if (target.path?.outlineSections !== void 0) node.querySelectorAll('[data-render-role~="outline"]').forEach((item) => {
        writePaint(item, "fill", stroke ?? null, "none");
        if (stroke?.kind === "gradient" && stroke.units === "objectBoundingBox") setAttribute(item, "fill", `url(#${projectedDefinitionId(node, `outline-paint-${target.id}`)})`);
      });
      if (color !== void 0 && node.getAttribute("data-render-projection") !== "stroke") writePaint(node, "fill", color, "#000000");
      if (target.stroke) {
        const multiplier = target.stroke.alignment === "center" ? 1 : 2;
        this.roleNodes(node, "stroke").forEach((item) => {
          setAttribute(item, "stroke-width", round3(target.stroke.width * multiplier));
          if (target.stroke.dasharray.length) {
            setAttribute(item, "stroke-dasharray", target.stroke.dasharray.join(" "));
            setAttribute(item, "stroke-dashoffset", target.stroke.dashoffset);
          }
        });
        pathRevealNodes(this.root, node, target.id).forEach((item) => setAttribute(item, "stroke-width", target.stroke.width * 4));
      }
      if (target.path) {
        const progress = clamp01(target.path.drawProgress);
        const reveal = pathRevealNodes(this.root, node, target.id);
        if (reveal.length) reveal.forEach((item) => setAttribute(item, "stroke-opacity", progress > MIN_VISIBLE_DRAW_PROGRESS ? null : 0));
        else if (progress <= MIN_VISIBLE_DRAW_PROGRESS) this.roleNodes(node, "stroke").forEach((item) => setAttribute(item, "stroke-opacity", 0));
      }
    }
    renderGradients(target) {
      Object.values(target.paints).forEach((paint) => {
        if (!paint || paint.kind !== "gradient") return;
        this.nodes(paint.id).forEach((gradient) => {
          setAttribute(gradient, "gradientTransform", isIdentityTransform(paint.transform) ? null : `matrix(${paint.transform.map(round3).join(" ")})`);
          Object.entries(paint.coordinates).forEach(([name, value]) => setAttribute(gradient, name, value));
        });
        paint.stops.forEach((stop) => {
          this.nodes(stop.id).forEach((stopNode) => {
            setAttribute(stopNode, "offset", round3(stop.offset));
            setAttribute(stopNode, "stop-color", stop.color);
            setAttribute(stopNode, "stop-opacity", stop.opacity < 0.9999 ? round3(stop.opacity) : null);
          });
        });
      });
    }
    roleNodes(node, role) {
      return paintRoleNodes(node, role);
    }
    motionAdjustedMatrix(target) {
      const base = this.ownMatrix(target, 0);
      const sampled = this.sampleMotion(target);
      if (!sampled) return base;
      const rotation2 = (target.motion.rotateToPath ? sampled.tangentAngle : 0) + target.motion.offsetAngle;
      const matrix = this.ownMatrix(target, rotation2);
      const origin = { x: target.transform.originX, y: target.transform.originY };
      const currentOrigin = applyMatrix2(matrix, origin.x, origin.y);
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
      const point = applyMatrix2(inverse, world.x, world.y);
      const tangentEnd = applyMatrix2(inverse, world.x + selected.end.x - selected.start.x, world.y + selected.end.y - selected.start.y);
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
    nodes(id2) {
      let nodes = this.targetNodesById.get(id2);
      if (!nodes) {
        nodes = renderTargetNodes(this.root, id2);
        this.targetNodesById.set(id2, nodes);
      }
      return nodes;
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
      setAttribute(node, opacityAttribute, paint.opacity < 0.9999 ? round3(paint.opacity) : null);
    }
  }
  function writePathPoint(contours, id2, axis, value) {
    const numeric = finite2(value);
    if (numeric == null) return false;
    let found = false;
    forEachPathPoint(contours, (point) => {
      if (point.id === id2) {
        point[axis] = numeric;
        found = true;
      }
    });
    return found;
  }
  function legacyRenderContours(contours) {
    return contours.map((contour) => {
      const first = contour.lines[0]?.points[0], last = contour.lines[contour.lines.length - 1]?.points[1];
      const inferred = contour.lines.length > 1 && first && last && (first.id === last.id || Math.abs(first.x - last.x) < 1e-4 && Math.abs(first.y - last.y) < 1e-4);
      return inferred && !contour.closed ? { ...contour, closed: true } : contour;
    });
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
  function boundsCenter(bounds2, axis) {
    return bounds2[axis] + bounds2[axis === "x" ? "width" : "height"] / 2;
  }
  function flattenRuntimePath(contours, matrix) {
    return contours.flatMap((contour) => contour.lines).flatMap((line) => {
      const start = line.points[0];
      const end = line.points[1];
      if (line.type !== "bezier" || !line.controlStart || !line.controlEnd) return [segment(applyMatrix2(matrix, start.x, start.y), applyMatrix2(matrix, end.x, end.y))];
      const points = Array.from({ length: 33 }, (_, index) => applyMatrix2(matrix, ...Object.values(cubic(start, line.controlStart, line.controlEnd, end, index / 32))));
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
  function applyMatrix2(matrix, x, y) {
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  }
  function matrixToSvg(matrix) {
    return [matrix.a - 1, matrix.b, matrix.c, matrix.d - 1, matrix.e, matrix.f].every((v) => Math.abs(v) < 1e-6) ? null : `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(round3).join(" ")})`;
  }
  function rotateVector(x, y, degrees) {
    const r = degrees * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: x * c - y * s, y: x * s + y * c };
  }
  function setAttribute(node, name, value) {
    const next = value == null || value === "" ? null : String(value);
    if (node.getAttribute(name) === next) return;
    if (next === null) node.removeAttribute(name);
    else node.setAttribute(name, next);
  }
  function assignNumber(target, key, value) {
    if (value == null) return false;
    target[key] = value;
    return true;
  }
  function finite2(value) {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }
  function round3(value) {
    return Math.round(value * 1e4) / 1e4;
  }
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

  // src/rig/constraints.ts
  function constraintJointGap(rig, constraint) {
    const upper = rig.bones.find((bone) => bone.id === constraint.upperBoneId), lower = rig.bones.find((bone) => bone.id === constraint.lowerBoneId);
    return upper && lower && lower.parentId === upper.id && !isConnectedBoneJoint(upper, lower) ? { upper: upper.name, lower: lower.name, lowerId: lower.id } : void 0;
  }
  function constraintIssue(rig, constraint) {
    const problem = constraintChainProblem(rig, constraint);
    if (problem) return problem[0].toUpperCase() + problem.slice(1);
    const gap = constraintJointGap(rig, constraint);
    return gap && `${gap.lower} must start at ${gap.upper}'s tip.`;
  }
  function evaluateRigConstraints(rig) {
    const plan = constraintPlan(rig);
    if (plan.problem) throw new Error(plan.problem);
    let result = structuredClone(rig);
    if (rig.constraintsActive === false) return result;
    for (const constraint of plan.ordered) {
      if (!twoBoneChain(result, constraint.lowerBoneId)) {
        throw new Error(`${constraint.name}: ${constraintIssue(result, constraint)} Use Reconnect joint in Bone setup before posing.`);
      }
      const targetMatrix = boneMatrices(result).get(constraint.targetBoneId);
      const target = applyMatrix(targetMatrix, 0, 0);
      const solved = solveTwoBoneIK(result, constraint.lowerBoneId, target, constraint.bend);
      if (!solved) throw new Error(`${constraint.name}: this two-bone chain cannot reach a valid pose.`);
      result = solved;
    }
    return result;
  }

  // src/rig/attachments.ts
  function attachmentMatrix(rig, attachment) {
    const rest = boneMatrices(rig, false).get(attachment.boneId), posed = boneMatrices(rig).get(attachment.boneId);
    return multiplyMatrix(invertMatrix(attachment.parentMatrix), multiplyMatrix(multiplyMatrix(posed, invertMatrix(rest)), attachment.worldMatrix));
  }
  function attachmentTransforms(rig) {
    const transforms = /* @__PURE__ */ new Map();
    for (const attachment of rig.attachments ?? []) {
      const transform = !rig.bones.some(hasBonePose) ? structuredClone(attachment.restTransform) : decomposeTransform(attachmentMatrix(rig, attachment));
      if (!transform) throw new Error("This pose would introduce skew under a scaled parent. Use a uniformly scaled parent for rigid attachments, or bind path points instead.");
      transforms.set(attachment.elementId, transform);
    }
    return transforms;
  }

  // src/rig/runtime-rigs.ts
  function rigChannelConflict(rigs, scene, channel) {
    if (!rigs) return;
    const boneChannel = parseRigAnimationProperty(channel.property);
    if (boneChannel) {
      const rig = rigs.armatures.find((rig2) => rig2.id === channel.targetId);
      const constraint = rig?.constraints?.find((constraint2) => constraint2.enabled && [constraint2.upperBoneId, constraint2.lowerBoneId].includes(boneChannel.boneId));
      return constraint ? `\u201C${constraint.name}\u201D controls this bone. Animate its IK target, or disable the constraint before animating this bone.` : void 0;
    }
    if (!/^(geometry\.|path\.points\.|transform\.|motion\.)/.test(channel.property)) return;
    const parents = new Map(scene.map((node) => [node.id, node.parentId]));
    const isWithin = (id2, ancestor) => {
      const seen = /* @__PURE__ */ new Set();
      for (let current = id2; current && !seen.has(current); current = parents.get(current)) {
        if (current === ancestor) return true;
        seen.add(current);
      }
      return false;
    };
    for (const rig of rigs.armatures) {
      const ids = [...rig.bindings.map((binding) => binding.pathId), ...(rig.attachments ?? []).map((link) => link.elementId)];
      if (ids.some((id2) => isWithin(id2, channel.targetId))) return `\u201C${rig.name}\u201D controls this artwork's geometry and transform. Animate its bones or remove the binding before animating this property.`;
    }
    return;
  }
  function rigSceneBaseProblem(rigs, scene) {
    const targets = new Map(scene.map((target) => [target.id, target]));
    const same = (a, b, tolerance) => Object.keys(a).every((key) => Math.abs(a[key] - b[key]) < tolerance);
    const own = (target) => transformMatrix(target.transform, { x: target.transform.originX, y: target.transform.originY });
    const world = (id2, seen = /* @__PURE__ */ new Set()) => {
      const target = targets.get(id2);
      if (!target || seen.has(id2)) throw new Error("Rig artwork has missing or cyclic parent references.");
      if (target.motion.pathId) throw new Error("Remove motion-path constraints from bound artwork and its ancestors before exporting rig animation.");
      seen.add(id2);
      return multiplyMatrix(target.parentId ? world(target.parentId, seen) : identityMatrix(), own(target));
    };
    try {
      for (const rig of rigs.armatures) {
        const posed = evaluateRigConstraints(rig);
        for (const binding of posed.bindings) {
          const target = targets.get(binding.pathId);
          if (!same(world(binding.pathId), binding.matrix, 2e-4)) return `The transform of bound path \u201C${binding.pathId}\u201D changed. Rebind this artwork before export.`;
          const expected = deformBinding(posed, binding);
          for (const point of target.path.contours.flatMap((contour) => contour.lines.flatMap((line) => [...line.points, line.controlStart, line.controlEnd]))) {
            if (!point) continue;
            const value = expected.get(point.id);
            if (!value || Math.abs(value.x - point.x) > 2e-4 || Math.abs(value.y - point.y) > 2e-4) return `Bound points in \u201C${binding.pathId}\u201D were edited. Rebind this artwork before export.`;
          }
        }
        for (const attachment of posed.attachments ?? []) {
          const target = targets.get(attachment.elementId);
          const parent = target.parentId ? world(target.parentId) : identityMatrix();
          if (target.motion.pathId || !same(parent, attachment.parentMatrix, 2e-3) || !same(own(target), attachmentMatrix(posed, attachment), 2e-3)) return `Attached artwork \u201C${attachment.elementId}\u201D changed. Detach and attach it again before export.`;
        }
      }
    } catch (error) {
      return error instanceof Error ? error.message : "Rig base artwork cannot be evaluated.";
    }
    return;
  }
  function rigSceneProblem(rigs, scene) {
    if (!validRigs(rigs)) return "Rig data has invalid bone, constraint, weight, or attachment references.";
    const targets = new Map(scene.map((target) => [target.id, target]));
    const linked = new Set(rigs.armatures.flatMap((rig) => [...rig.bindings.map((binding) => binding.pathId), ...(rig.attachments ?? []).map((link) => link.elementId)]));
    for (const id2 of linked) {
      const seen = /* @__PURE__ */ new Set();
      for (let parent = targets.get(id2)?.parentId; parent && !seen.has(parent); parent = targets.get(parent)?.parentId) {
        if (linked.has(parent)) return "Rig bindings overlap an ancestor and its descendant. Remove one of the links before export.";
        seen.add(parent);
      }
    }
    for (const rig of rigs.armatures) {
      if (targets.has(rig.id)) return `Armature \u201C${rig.id}\u201D shares an artwork ID.`;
      for (const binding of rig.bindings) {
        const target = targets.get(binding.pathId);
        if (!target?.path) return `Bound path \u201C${binding.pathId}\u201D is missing.`;
        const topology = JSON.stringify(target.path.contours.map((contour) => [contour.id, contour.closed, contour.lines.map((line) => [line.id, line.type, line.points.map((point) => point.id), line.controlStart?.id, line.controlEnd?.id])]));
        if (topology !== binding.topology) return `Bound path \u201C${binding.pathId}\u201D has changed topology. Rebind this artwork before export.`;
        const points = new Set(target.path.contours.flatMap((contour) => contour.lines.flatMap((line) => [line.points[0].id, line.points[1].id, line.controlStart?.id, line.controlEnd?.id].filter((id2) => !!id2))));
        if (binding.points.some((point) => !points.has(point.id)) || [...points].some((id2) => !binding.points.some((point) => point.id === id2))) return `Bound path \u201C${binding.pathId}\u201D has changed points. Rebind this artwork before export.`;
      }
      if (rig.attachments?.some((link) => !targets.has(link.elementId))) return `Attached artwork in \u201C${rig.name}\u201D is missing.`;
      try {
        attachmentTransforms(evaluateRigConstraints({ ...rig, constraintsActive: true }));
      } catch (error) {
        return error instanceof Error ? error.message : "Rig constraints cannot evaluate.";
      }
    }
    return rigSceneBaseProblem(rigs, scene);
  }
  function validateRuntimeRigs(bundle) {
    const fail = (message) => {
      throw new RuntimePlayerError("invalid-bundle", message);
    };
    if (bundle.rigs !== void 0) {
      if (!bundle.requiredCapabilities.includes("rig.pose-v1")) fail("Rig data requires rig.pose-v1.");
      const problem = rigSceneProblem(bundle.rigs, bundle.artwork.targets);
      if (problem) fail(problem);
    }
    for (const track of bundle.animation.tracks) {
      const targetId = bundle.animation.targets[track.target], property = bundle.animation.properties[track.property];
      const channel = parseRigAnimationProperty(property);
      const rig = bundle.rigs?.armatures.find((rig2) => rig2.id === targetId);
      if (channel || rig) {
        if (!channel || !rig?.bones.some((bone) => bone.id === channel.boneId) || track.kind !== "number") fail(`Rig channel \u201C${targetId}/${property}\u201D has an invalid target or property.`);
      }
      const conflict = rigChannelConflict(bundle.rigs, bundle.artwork.targets, { targetId, property });
      if (conflict) fail(conflict);
    }
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
      this.scene = new RuntimeScene(root, bundle.artwork.targets, bundle.rigs);
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
      const nextTime = clamp2(Number.isFinite(time) ? time : 0, 0, this.duration);
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
      try {
        this.advance(delta);
      } catch (error) {
        if (!(error instanceof RuntimePlayerError)) throw error;
        return;
      }
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
        next = clamp2(next, 0, this.duration);
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
      const animation = this.bundle.animation;
      animation.tracks.forEach((track) => {
        const value = evaluateRuntimeTrack(track, time);
        if (value !== void 0) this.scene.write(animation.targets[track.target], animation.properties[track.property], value);
      });
      try {
        this.scene.render();
        this._time = time;
      } catch (error) {
        this.pause();
        if (error instanceof RuntimePlayerError) this.emit("error", { error });
        throw error;
      }
    }
    emitMarkers(from, to) {
      if (from === to) return;
      const direction2 = to > from ? "forward" : "reverse";
      const markers = this.bundle.animation.markers.filter((marker) => direction2 === "forward" ? marker.time > from && marker.time <= to : marker.time < from && marker.time >= to);
      if (direction2 === "reverse") markers.reverse();
      markers.forEach((marker) => this.emit("marker", { marker, direction: direction2 }));
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
    if (bundle.artwork.targets.some((target) => target.clipping?.sourceVisibility !== void 0 && target.clipping.sourceVisibility !== true))
      throw new RuntimePlayerError("invalid-bundle", "Clipping sourceVisibility must be true when present.");
    if (bundle.artwork.targets.some((target) => target.clipping?.sourceVisibility) && !bundle.requiredCapabilities.includes("render.visible-clipping-v1"))
      throw new RuntimePlayerError("invalid-bundle", "Visible clipping sources require the render.visible-clipping-v1 capability.");
    for (const target of bundle.artwork.targets) if (target.path?.outlineSections !== void 0 || target.path?.explicitClosure) {
      if (!bundle.requiredCapabilities.includes("render.outline-sections-v1")) throw new RuntimePlayerError("invalid-bundle", "Outline sections require the render.outline-sections-v1 capability.");
      const sections = target.path.outlineSections;
      const problem = sections !== void 0 ? outlineSectionsProblem(target.path.contours, sections) ?? (target.stroke ? outlineProjectionProblem(target.path.contours, sections, { ...target.stroke, rounded: target.path.rounded }) : void 0) : void 0;
      if (problem) throw new RuntimePlayerError("invalid-bundle", problem);
    }
    if (!bundle.animation || !Number.isFinite(bundle.animation.duration) || !Array.isArray(bundle.animation.tracks) || !Array.isArray(bundle.animation.targets) || !Array.isArray(bundle.animation.properties)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle animation is incomplete.");
    if (bundle.animation.duration < 0 || !Array.isArray(bundle.animation.markers) || !Array.isArray(bundle.animation.variables)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle timing metadata is invalid.");
    const validateTrack = (track, index, nested = false) => {
      if (!track || !Number.isInteger(track.target) || track.target < 0 || track.target >= bundle.animation.targets.length || !Number.isInteger(track.property) || track.property < 0 || track.property >= bundle.animation.properties.length || !Array.isArray(track.times) || !Array.isArray(track.values) || track.times.length === 0 || track.times.length !== track.values.length || track.times.some((time, timeIndex) => !Number.isFinite(time) || timeIndex > 0 && time < track.times[timeIndex - 1])) {
        throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has invalid indexes or keyframe arrays.`);
      }
      if (track.kind === "number" && (track.segmentModes.length !== track.times.length - 1 || track.temporalCoefficients.length !== Math.max(0, track.times.length - 1) * 8 || track.values.some((item) => !Number.isFinite(item)))) throw new RuntimePlayerError("invalid-bundle", `Numeric runtime track ${index} is malformed.`);
      if (track.kind === "color" && (track.segmentModes.length !== track.times.length - 1 || track.interpolationSpaces.length !== track.times.length - 1 || track.values.some((item) => !Number.isInteger(item)))) throw new RuntimePlayerError("invalid-bundle", `Color runtime track ${index} is malformed.`);
      if (track.kind !== "number" && track.kind !== "color" && track.kind !== "boolean" && track.kind !== "string") throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has an unknown kind.`);
      if (track.actionWindows !== void 0) {
        if (nested || !bundle.requiredCapabilities.includes("composition.action-windows-v1") || !Array.isArray(track.actionWindows))
          throw new RuntimePlayerError("invalid-bundle", "Action windows require the composition capability and cannot nest.");
        let end = -Infinity;
        track.actionWindows.forEach((window) => {
          if (window?.timing !== void 0) {
            const t = window.timing;
            if (!t || !bundle.requiredCapabilities.includes("composition.action-timing-v1") || ![t.sourceStart, t.sourceEnd, t.rate].every(Number.isFinite) || t.sourceStart < 0 || t.sourceEnd <= t.sourceStart || t.rate < 0.01 || t.rate > 100)
              throw new Error("Invalid action time mapping.");
          }
          if (!window || !Number.isFinite(window.start) || !Number.isFinite(window.end) || window.start < 0 || window.end <= window.start || window.start < end || !window.track || window.track.target !== track.target || window.track.property !== track.property || window.track.kind !== track.kind)
            throw new RuntimePlayerError("invalid-bundle", "Action windows must be ordered, nonoverlapping, and address the same channel.");
          end = window.end;
          validateTrack(window.track, index, true);
        });
      }
    };
    bundle.animation.tracks.forEach((track, index) => validateTrack(track, index));
    validateRuntimeRigs(bundle);
  }
  function validateArtwork(root, bundle) {
    const actual = root.getAttribute("data-svg-animator-signature");
    if (actual !== bundle.artwork.signature) throw new RuntimePlayerError("artwork-signature-mismatch", actual ? `SVG artwork signature ${actual} does not match bundle ${bundle.artwork.signature}.` : "SVG artwork has no data-svg-animator-signature attribute.");
    const missing = bundle.artwork.targets.find((target) => !renderTargetNodes(root, target.id).length);
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
  function clamp2(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
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
