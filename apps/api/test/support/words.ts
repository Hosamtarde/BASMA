/**
 * Test-only inverse of `amountInWords(…, 'ILS', 'en')` for 2 decimals ("One thousand shekels and fifty agorot"
 * → 100050), written independently of the implementation so a voucher's words can be checked against the
 * stored amount.
 */
export function englishWordsToMinor(text: string): number {
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALE: Record<string, number> = { thousand: 1_000, million: 1_000_000, billion: 1_000_000_000 };
  const words = (s: string): number => {
    let total = 0;
    let chunk = 0;
    for (const w of s.trim().split(/[\s-]+/u)) {
      const one = ONES.indexOf(w);
      const ten = TENS.indexOf(w);
      if (one >= 0) chunk += one;
      else if (ten > 1) chunk += ten * 10;
      else if (w === 'hundred') chunk *= 100;
      else if (w in SCALE) {
        total += chunk * SCALE[w]!;
        chunk = 0;
      } else throw new Error(`unknown word "${w}" in "${text}"`);
    }
    return total + chunk;
  };
  const [major = '', minor] = text.toLowerCase().split(/ shekels? and | shekels?$/u);
  const minorText = (minor ?? '').replace(/ agor(a|ot)$/u, '');
  return words(major) * 100 + (minorText === '' ? 0 : words(minorText));
}
