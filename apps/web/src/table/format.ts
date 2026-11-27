/** Number formatting for UI copy: a true minus sign (U+2212), never a hyphen (#21). */
export const MINUS = '−';
/** "+2", "−2", "0". */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${-n}`;
  return '0';
}
/** "−2" for negatives, plain otherwise. */
export const num = (n: number) => (n < 0 ? `${MINUS}${-n}` : `${n}`);

/** "A", "A and B", "A, B, and C" (Chicago: serial comma). */
export function joinNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}
