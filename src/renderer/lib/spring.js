/**
 * Simulates a damped spring and samples it into a CSS `linear()` easing,
 * so plain CSS transitions get the Dynamic Island bounce.
 */
export function springEasing({ stiffness = 200, damping = 20, mass = 1, points = 48 } = {}) {
  const dt = 1 / 240;
  const samples = [];
  let x = 0;
  let v = 0;
  let t = 0;

  while (t < 2) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    t += dt;
    samples.push(x);
    if (Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.02) break;
  }

  const step = Math.max(1, Math.floor(samples.length / points));
  const stops = [0];
  for (let i = step; i < samples.length - 1; i += step) stops.push(Number(samples[i].toFixed(4)));
  stops.push(1);

  return {
    easing: `linear(${stops.join(', ')})`,
    duration: Math.round(t * 1000),
  };
}
