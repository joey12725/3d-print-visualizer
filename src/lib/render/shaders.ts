// GLSL for the toolpath. Every extrusion segment is one GPU instance; the vertex shader
// expands a small template into a tube with a diamond cross-section (smooth normals make
// it read as round) and pointed end caps that close the gaps at corners.

const COMMON = /* glsl */ `
in vec3 iStart;
in vec3 iEnd;
in vec2 iSize;   // width, height
in vec3 iColor;
in vec2 iMeta;   // global move index, feature id

uniform vec2 uRange;      // visible move index range [min, max]
uniform float uVis[32];   // per-feature visibility
uniform float uGhost;     // show moves below uRange.x as grey ghosts

bool hiddenInstance(out bool ghost) {
  float idx = iMeta.x;
  ghost = idx < uRange.x;
  return uVis[int(iMeta.y + 0.5)] < 0.5 || idx > uRange.y || (ghost && uGhost < 0.5);
}

void frame(out vec3 dir, out vec3 side, out vec3 up, out float len) {
  vec3 d = iEnd - iStart;
  len = length(d);
  dir = len > 1e-6 ? d / len : vec3(1.0, 0.0, 0.0);
  vec3 s = cross(vec3(0.0, 0.0, 1.0), dir);
  float sl = length(s);
  side = sl > 1e-4 ? s / sl : vec3(0.0, 1.0, 0.0);
  up = cross(dir, side);
}
`;

export const TUBE_VERT = /* glsl */ `
${COMMON}
out vec3 vNormal;
out vec3 vColor;
out vec3 vWorld;
#ifdef PICK
flat out int vId;
#endif

void main() {
  bool ghost;
  if (hiddenInstance(ghost)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 dir, side, up; float len;
  frame(dir, side, up, len);
  float hw = max(iSize.x, 0.05) * 0.5;
  float hh = max(iSize.y, 0.03) * 0.5;
  vec3 base = position.x < 0.5 ? iStart : iEnd;
  float cap = position.x < -0.5 ? -hw : (position.x > 1.5 ? hw : 0.0);
  // the G-code Z is the top of the bead; its centre sits half a layer lower
  vec3 center = base + dir * cap - up * hh;
  vec3 p = center + side * (position.y * hw) + up * (position.z * hh);
  vNormal = normalize(dir * normal.x + side * normal.y + up * normal.z);
  vColor = ghost ? vec3(0.32, 0.34, 0.38) : iColor;
  vWorld = p;
#ifdef PICK
  vId = gl_InstanceID;
#endif
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const TUBE_FRAG = /* glsl */ `
out highp vec4 fragColor;
in vec3 vNormal;
in vec3 vColor;
in vec3 vWorld;
#ifdef PICK
flat in int vId;
#endif
uniform vec3 uKey;

void main() {
#ifdef PICK
  int id = vId + 1;
  fragColor = vec4(float(id & 255), float((id >> 8) & 255), float((id >> 16) & 255), float((id >> 24) & 255)) / 255.0;
#else
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(cameraPosition - vWorld);
  float key = max(dot(n, uKey), 0.0);
  float head = max(dot(n, V), 0.0);
  float hemi = 0.5 + 0.5 * n.z;
  vec3 c = vColor * (0.20 + 0.16 * hemi + 0.42 * key + 0.40 * head);
  vec3 H = normalize(uKey + V);
  c += vec3(0.16) * pow(max(dot(n, H), 0.0), 48.0);
  fragColor = vec4(c, 1.0);
#endif
}
`;

/** Cheap mode: one line per segment, same instance data. */
export const LINE_VERT = /* glsl */ `
${COMMON}
out vec3 vColor;
void main() {
  bool ghost;
  if (hiddenInstance(ghost)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = mix(iStart, iEnd, position.x) - vec3(0.0, 0.0, iSize.y * 0.5);
  vColor = ghost ? vec3(0.32, 0.34, 0.38) : iColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const LINE_FRAG = /* glsl */ `
out highp vec4 fragColor;
in vec3 vColor;
void main() { fragColor = vec4(vColor, 1.0); }
`;

export const TRAVEL_VERT = /* glsl */ `
in vec3 iStart;
in vec3 iEnd;
in float iMove;
uniform vec2 uRange;
void main() {
  if (iMove < uRange.x || iMove > uRange.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = mix(iStart, iEnd, position.x);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const FLAT_FRAG = /* glsl */ `
out highp vec4 fragColor;
uniform vec3 uColor;
uniform float uOpacity;
void main() { fragColor = vec4(uColor, uOpacity); }
`;

export const POINT_VERT = /* glsl */ `
in float aMove;
uniform vec2 uRange;
uniform float uSize;
void main() {
  if (aMove < uRange.x || aMove > uRange.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize;
}
`;

export const POINT_FRAG = /* glsl */ `
out highp vec4 fragColor;
uniform vec3 uColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  if (dot(d, d) > 0.25) discard;
  fragColor = vec4(uColor, 1.0);
}
`;
