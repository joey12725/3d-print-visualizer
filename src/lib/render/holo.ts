// Holographic film on smooth PEI plates.
//
// The film is a diffraction grating: light leaving at angle θ out of a grating with line
// spacing d satisfies d·(sin θ_in + sin θ_out) = m·λ along the grating direction, so each
// spot shows the colour whose wavelength fits the light/eye geometry there. That's why the
// rainbow slides across the plate as you orbit. We evaluate that per pixel for the scene's key
// light plus a light at the camera, so the effect is visible from any angle.
//
// - circular: hundreds of small discs on a hex grid, each with concentric grooves (a tiny
//   rainbow streak through every disc, like a sheet of little CDs)
// - crosshatch: two families of diagonal lines, each line a strip of grooves running along it

import * as THREE from 'three';

export type HoloPattern = 'circular' | 'crosshatch' | 'none';

/** distance between neighbouring holographic discs (mm) and their radius */
export const HOLO_DOT_MM = 14;
export const HOLO_DOT_R_MM = 5.5;
/** distance between crosshatch lines (mm) */
export const HOLO_CELL_MM = 6;

/** Direction of the viewer's key light (viewer.ts). */
const KEY_LIGHT: [number, number, number] = [-150, -250, 400];

const GLSL = /* glsl */ `
uniform vec2 uHoloCenter;
uniform vec3 uHoloKey;
varying vec3 vHoloPos;
varying vec3 vHoloNormal;

// wavelength (nm) -> visible colour, fading out at both ends of the spectrum
vec3 holoSpectrum(float nm) {
  float t = clamp((nm - 400.0) / 300.0, 0.0, 1.0);
  float h = 0.8 * (1.0 - t);
  vec3 c = clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
  return c * smoothstep(380.0, 440.0, nm) * (1.0 - smoothstep(650.0, 720.0, nm));
}

// One grating with grooves perpendicular to g and spacing D (nm). s = tangential part of (L + V).
vec3 holoGrating(vec2 s, vec2 g, float D) {
  vec2 t = vec2(-g.y, g.x);
  float along = dot(s, t); // ~0 for a perfect grating; the film's roughness spreads it out
  float w = exp(-along * along / 0.08) + 0.05 * exp(-along * along / 1.5);
  float u = abs(dot(s, g)) * D;
  vec3 c = holoSpectrum(u) + 0.7 * holoSpectrum(u * 0.5) + 0.45 * holoSpectrum(u / 3.0);
  return c * w;
}

vec3 holoLight(vec2 s, vec2 p) {
#if HOLO_PATTERN == 1
  // hex grid of small discs, each with its own concentric grooves
  const float S = ${HOLO_DOT_MM.toFixed(1)};
  const float R = ${HOLO_DOT_R_MM.toFixed(1)};
  const vec2 lat = vec2(S, S * 1.7320508);
  vec2 a = mod(p, lat) - lat * 0.5;
  vec2 b = mod(p - lat * 0.5, lat) - lat * 0.5;
  vec2 c = dot(a, a) < dot(b, b) ? a : b; // offset from the nearest disc centre
  float r = length(c);
  float D = 1000.0 + 900.0 * (0.5 + 0.5 * sin(p.x * 0.023 + p.y * 0.017));
  float px = max(fwidth(r), 1e-4);
  float disc = 1.0 - smoothstep(R - px, R + px, r);
  float rim = 1.0 - smoothstep(0.25, 0.25 + px, abs(r - R + 0.5)); // brighter edge just inside the disc
  vec3 near = holoGrating(s, r > 1e-3 ? c / r : vec2(1.0, 0.0), D) * (disc + 0.6 * rim);
  // once a disc is only a few pixels wide, use its average instead of letting it shimmer:
  // the part of a radial grating lined up with s, times the area the discs cover
  float sl = max(length(s), 1e-3);
  vec3 far = holoGrating(s, s / sl, D) * min(1.0, 0.16 / sl) * (3.14159 * R * R) / (lat.x * lat.y * 0.5);
  return mix(near, far, smoothstep(0.08, 0.3, px / R));
#else
  const float k = 0.70710678;
  vec2 q = vec2(p.x + p.y, p.x - p.y) * k / ${HOLO_CELL_MM.toFixed(1)};
  float D = 1000.0 + 900.0 * (0.5 + 0.5 * sin(p.x * 0.031 + p.y * 0.019));
  // grooves run along each family of lines: lines of constant q.x scatter light like a grating
  // pointing (k, k), lines of constant q.y like one pointing (-k, k)
  vec3 a = holoGrating(s, vec2(k, k), D);
  vec3 b = holoGrating(s, vec2(-k, k), D);
  vec2 dq = max(fwidth(q), vec2(1e-4));
  vec2 d = abs(fract(q + 0.5) - 0.5); // distance to the nearest line, in cells
  vec2 line = 1.0 - smoothstep(vec2(0.06) - dq, vec2(0.06) + dq, d);
  // far away the lines blur into their average coverage instead of shimmering
  line = mix(line, vec2(0.12), clamp(dq * 3.0 - 0.5, 0.0, 1.0));
  return 0.35 * (a + b) + 1.6 * (a * line.x + b * line.y);
#endif
}

vec3 holo() {
  vec3 n = normalize(vHoloNormal);
  if (n.z < 0.9) return vec3(0.0); // top face only
  vec3 V = normalize(cameraPosition - vHoloPos);
  vec2 p = vHoloPos.xy - uHoloCenter;
  return 0.55 * holoLight(uHoloKey.xy + V.xy, p) // key light
       + 0.35 * holoLight(2.0 * V.xy, p); // light at the eye
}
`;

/** Patch a plate material so its top face shows the holographic film. */
export function applyHolo(mat: THREE.MeshStandardMaterial, pattern: Exclude<HoloPattern, 'none'>, center: [number, number]) {
  mat.defines = { ...mat.defines, HOLO_PATTERN: pattern === 'circular' ? 1 : 2 };
  mat.customProgramCacheKey = () => `holo-${pattern}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHoloCenter = { value: new THREE.Vector2(...center) };
    sh.uniforms.uHoloKey = { value: new THREE.Vector3(...KEY_LIGHT).normalize() };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHoloPos;\nvarying vec3 vHoloNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvHoloPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvHoloNormal = mat3(modelMatrix) * objectNormal;',
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <opaque_fragment>', 'outgoingLight += holo();\n#include <opaque_fragment>');
  };
}
