// IEEE-754 binary16 (f16) -> f32/f64. Arithmetic decode rather than a
// bit-union: exactly equivalent for every finite value (all that ever appears
// in a .nurl's per-group scales), and JS has no native f16 view to bit-cast
// from.
export function f16ToF32(h: number): number {
  const sign = (h >> 15) & 1;
  const exp = (h >> 10) & 31;
  const mant = h & 1023;
  let v: number;
  if (exp === 0) v = mant * 2 ** -24; // subnormal
  else if (exp === 31) v = mant ? NaN : Infinity;
  else v = (1 + mant / 1024) * 2 ** (exp - 15); // normal
  return sign ? -v : v;
}
