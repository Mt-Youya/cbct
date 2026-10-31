/**
 * Ray-marched single-pass volume renderer.
 *
 * The fragment shader intersects the ray with the unit box in *normalized*
 * volume space (box = [-0.5, 0.5]^3), then marches front-to-back through a
 * WebGL2 sampler3D texture. Three looks are supported:
 *   0 composite   - transfer-function compositing with gradient lighting
 *   1 mip         - maximum intensity projection
 *   2 xray        - integrated absorption (DRR-like)
 *
 * Volume axis mapping (world = three.js):  x -> x, volume z -> +y, volume y -> -z
 */
export const volumeVertexShader = /* glsl */ `
out vec3 vWorldPos;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`

export const volumeFragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

layout(location = 0) out vec4 fragColor;

uniform sampler3D uVolume;
uniform sampler2D uTF;

uniform vec3 uSize;        // world-space extent of the volume box
uniform vec3 uVoxelStep;   // 1 / (volume dimensions)
uniform vec3 uLightDir;    // world-space light direction
uniform float uSteps;
uniform float uOpacity;
uniform float uClipZ;      // 0..1 cut plane along the slice axis (1 = no cut)
uniform float uDensityMin; // normalized density trim (MIP / x-ray)
uniform float uExposure;   // x-ray absorption gain
uniform float uCropEnabled; // 1 = clip to the dental ROI box
uniform vec3 uCropMin;
uniform vec3 uCropMax;
uniform int uMode;

in vec3 vWorldPos;

const int MAX_STEPS = 512;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Ray in normalized volume space. The mesh is an axis-aligned box scaled by uSize.
  vec3 ro = cameraPosition / uSize;
  vec3 rd = normalize(vWorldPos - cameraPosition) / uSize;

  vec3 invRd = 1.0 / rd;
  vec3 tA = (vec3(-0.5) - ro) * invRd;
  vec3 tB = (vec3(0.5) - ro) * invRd;
  vec3 tMin = min(tA, tB);
  vec3 tMax = max(tA, tB);
  float tNear = max(max(tMin.x, tMin.y), max(tMin.z, 0.0));
  float tFar = min(min(tMax.x, tMax.y), tMax.z);
  if (tFar <= tNear) discard;

  int steps = int(uSteps);
  float dt = (tFar - tNear) / uSteps;
  float t = tNear + dt * hash12(gl_FragCoord.xy) * 0.9;
  vec3 p = ro + rd * t;

  vec3 accumulated = vec3(0.0);
  float alpha = 0.0;
  float maxDensity = 0.0;
  float absorption = 0.0;

  vec3 lightDir = normalize(uLightDir);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= steps) break;

    vec3 uv = vec3(p.x + 0.5, 0.5 - p.z, p.y + 0.5);
    bool clipped = uv.z > uClipZ;
    float cropFade = 1.0;
    if (uCropEnabled > 0.5) {
      clipped = clipped || any(lessThan(uv, uCropMin)) || any(greaterThan(uv, uCropMax));
      if (!clipped) {
        // Fade over ~2.5 voxels so the dental-arch clip does not eat tooth
        // surfaces (the ROI box intentionally sits only ~3 mm from enamel).
        vec3 edgeVoxels = min(uv - uCropMin, uCropMax - uv) / max(uVoxelStep, vec3(1e-6));
        cropFade = smoothstep(0.0, 2.5, min(min(edgeVoxels.x, edgeVoxels.y), edgeVoxels.z));
      }
    }
    if (clipped) {
      t += dt;
      p += rd * dt;
      continue;
    }

    float density = texture(uVolume, uv).r;

    if (uMode == 0) {
      vec4 tf = texture(uTF, vec2(density, 0.5));
      float a = tf.a * uOpacity * cropFade;
      if (a > 0.002) {
        // Forward differences: 3 extra taps per shaded sample instead of 6.
        vec3 grad = vec3(
          texture(uVolume, uv + vec3(uVoxelStep.x, 0.0, 0.0)).r - density,
          texture(uVolume, uv + vec3(0.0, uVoxelStep.y, 0.0)).r - density,
          texture(uVolume, uv + vec3(0.0, 0.0, uVoxelStep.z)).r - density
        );
        // volume axes (u,v,w) -> world axes (x, y, z) = (gx, gw, -gv)
        vec3 worldGrad = vec3(grad.x, grad.z, -grad.y);
        vec3 normal = normalize(-worldGrad + vec3(1e-5));
        float diffuse = clamp(dot(normal, lightDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 halfDir = normalize(lightDir + viewDir);
        float specular = pow(max(dot(normal, halfDir), 0.0), 28.0) * 0.35;
        vec3 color = tf.rgb * (0.35 + 0.9 * diffuse) + specular * vec3(1.0, 0.97, 0.9);
        accumulated += (1.0 - alpha) * a * color;
        alpha += (1.0 - alpha) * a;
        if (alpha > 0.985) break;
      }
    } else if (uMode == 1) {
      maxDensity = max(maxDensity, density * cropFade);
    } else {
      // Integrate absorption above an air threshold; windowing happens after the loop.
      absorption += max(density - 0.02, 0.0) * dt * cropFade;
    }

    t += dt;
    p += rd * dt;
  }

  if (uMode == 0) {
    if (alpha <= 0.003) discard;
    fragColor = vec4(accumulated / max(alpha, 1e-4), alpha);
  } else if (uMode == 1) {
    float mask = smoothstep(uDensityMin, uDensityMin + 0.04, maxDensity);
    if (mask <= 0.002) discard;
    vec3 color = texture(uTF, vec2(maxDensity, 0.5)).rgb;
    fragColor = vec4(color, mask * min(uOpacity, 1.0) * 0.94);
  } else {
    // DRR-like: window the line integral so soft tissue fades and bone stands out.
    float value = clamp((absorption - uDensityMin) * uExposure, 0.0, 1.0);
    vec3 color = texture(uTF, vec2(value, 0.5)).rgb;
    fragColor = vec4(color, smoothstep(0.04, 0.7, value) * 0.95);
  }
}
`
