const superscriptMap: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  a: 'ᵃ',
  b: 'ᵇ',
  c: 'ᶜ',
  d: 'ᵈ',
  e: 'ᵉ',
  f: 'ᶠ',
  g: 'ᵍ',
  h: 'ʰ',
  i: 'ⁱ',
  j: 'ʲ',
  k: 'ᵏ',
  l: 'ˡ',
  m: 'ᵐ',
  n: 'ⁿ',
  o: 'ᵒ',
  p: 'ᵖ',
  r: 'ʳ',
  s: 'ˢ',
  t: 'ᵗ',
  u: 'ᵘ',
  v: 'ᵛ',
  w: 'ʷ',
  x: 'ˣ',
  y: 'ʸ',
  z: 'ᶻ',
  A: 'ᴬ',
  B: 'ᴮ',
  C: 'ᶜ',
  D: 'ᴰ',
  E: 'ᴱ',
  F: 'ᶠ',
  G: 'ᴳ',
  H: 'ᴴ',
  I: 'ᴵ',
  J: 'ᴶ',
  K: 'ᴷ',
  L: 'ᴸ',
  M: 'ᴹ',
  N: 'ᴺ',
  O: 'ᴼ',
  P: 'ᴾ',
  Q: 'ᵠ',
  R: 'ᴿ',
  S: 'ˢ',
  T: 'ᵀ',
  U: 'ᵁ',
  V: 'ⱽ',
  W: 'ᵂ',
  X: 'ˣ',
  Y: 'ʸ',
  Z: 'ᶻ',
};

const subscriptMap: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  b: 'ᵦ', // 替代为希腊 β
  c: '𝒸', // 替代为数学斜体小写 c
  d: '𝒹', // 替代为数学斜体小写 d
  e: 'ₑ',
  f: '𝒻', // 替代为数学斜体小写 f
  g: '𝓰', // 替代为数学斜体小写 g
  h: 'ₕ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  l: 'ₗ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  q: 'ᵩ', // 替代为希腊 φ（Phi）
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  w: '𝓌', // 替代为数学斜体小写 w
  x: 'ₓ',
  y: 'ᵧ',
  z: '𝓏', // 替代为数学斜体小写 z
  A: 'ₐ',
  B: 'ᵦ',
  C: '𝒸',
  D: '𝒹',
  E: 'ₑ',
  F: '𝒻',
  G: '𝓰',
  H: 'ₕ',
  I: 'ᵢ',
  J: 'ⱼ',
  K: 'ₖ',
  L: 'ₗ',
  M: 'ₘ',
  N: 'ₙ',
  O: 'ₒ',
  P: 'ₚ',
  Q: 'ᵩ',
  R: 'ᵣ',
  S: 'ₛ',
  T: 'ₜ',
  U: 'ᵤ',
  V: 'ᵥ',
  W: '𝓌',
  X: 'ₓ',
  Y: 'ᵧ',
  Z: '𝓏',
};

export function convertToSubScript(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    result += subscriptMap[char] || char;
  }
  return result;
}

export function convertToSuperScript(input: string): string {
  let result = '';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    result += superscriptMap[char] || char;
  }
  return result;
}
