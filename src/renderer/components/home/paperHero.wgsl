import { hash2 } from "@vgpu/wgsl-std/hash";

struct Params {
  time: f32,
  motion: f32,
  dark: f32,
  _pad0: f32,
  pointer: vec4f,
  resolution: vec2f,
  paper: vec4f,
  ink: vec4f,
  accent: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;

fn grain(uv: vec2f, t: f32) -> f32 {
  let laid = hash2(uv * vec2f(90.0, 420.0) + vec2f(t * 0.02, 0.0)).x;
  let fleck = hash2(uv * 260.0 + 11.0).y;
  return mix(laid, fleck, 0.28);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let t = params.time * params.motion;
  let aspect = params.resolution.x / max(params.resolution.y, 1.0);
  let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
  // Squash X so the wash is a wide oval sitting behind "Reizo".
  let oval = vec2f(p.x * 0.62, p.y * 1.7);
  let bloom = exp(-dot(oval, oval) * 7.4);
  let breathe = 0.5 + 0.5 * sin(t * 0.38);

  let ptr = vec2f((params.pointer.x - 0.5) * aspect, params.pointer.y - 0.5);
  let sheen = exp(-dot(p - ptr, p - ptr) * 36.0) * params.pointer.z;

  let halo = bloom * (0.88 + 0.12 * breathe);
  var color = params.paper.rgb;
  color += (grain(uv, t) - 0.5) * mix(0.025, 0.045, params.dark) * halo;
  color += params.accent.rgb * halo * mix(0.045, 0.1, params.dark);
  color += params.ink.rgb * bloom * mix(0.018, 0.032, params.dark);
  color += params.accent.rgb * sheen * mix(0.05, 0.08, params.dark);

  let mask = smoothstep(0.95, 0.18, length(oval));
  color = mix(params.paper.rgb, color, mask);
  return vec4f(color, 1.0);
}
