/** Waits for the bundled fonts, then opens the browser's print dialog (Save as PDF is one of its printers). */
export async function printNow(): Promise<void> {
  // Older engines (and jsdom) have no FontFaceSet; printing must not depend on it.
  if ('fonts' in document) await document.fonts.ready;
  window.print();
}
