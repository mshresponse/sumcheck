/**
 * Access point for the bundled third-party libraries.
 *
 * UMD libraries are loaded as classic <script> tags by the host page (see
 * src/app/app.html) and reachable as globals. pdf.js ships as an ES module and
 * is imported lazily so that pages which never touch a PDF don't pay for it.
 *
 * Nothing here fetches from the network: every path resolves inside the
 * extension package, which is what MV3's no-remote-code rule requires.
 */

const VENDOR_BASE = new URL('../../vendor/', import.meta.url);

export function vendorUrl(rel) {
  return new URL(rel, VENDOR_BASE).href;
}

function requireGlobal(name, hint) {
  const value = globalThis[name];
  if (!value) {
    throw new Error(
      `Bundled library "${name}" is not loaded. ${hint || 'Check the <script> tags in the host page.'}`
    );
  }
  return value;
}

export const getJSZip = () => requireGlobal('JSZip');
export const getTurndown = () => requireGlobal('TurndownService');
export const getTurndownGfm = () => requireGlobal('turndownPluginGfm');
export const getMarked = () => requireGlobal('marked');
export const getMammoth = () => requireGlobal('mammoth');
export const getPapa = () => requireGlobal('Papa');
export const getYaml = () => requireGlobal('jsyaml');
export const getDOMPurify = () => requireGlobal('DOMPurify');
export const getReadability = () => requireGlobal('Readability');
export const getTesseract = () => requireGlobal('Tesseract');

let pdfjsPromise = null;

/** Lazily import pdf.js and point it at the bundled worker + asset dirs. */
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(vendorUrl('pdfjs/pdf.min.mjs')).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.mjs');
      return mod;
    });
  }
  return pdfjsPromise;
}

/** Options every getDocument() call needs so pdf.js stays inside the package. */
export function pdfDocumentDefaults() {
  return {
    cMapUrl: vendorUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl('pdfjs/standard_fonts/'),
    wasmUrl: vendorUrl('pdfjs/wasm/'),
    // MV3 pages have no 'unsafe-eval'; pdf.js must not try to compile
    // PostScript functions or font programs with new Function().
    isEvalSupported: false,
  };
}

export const TESSERACT_PATHS = {
  workerPath: vendorUrl('tesseract/worker.min.js'),
  corePath: vendorUrl('tesseract/tesseract-core-simd-lstm.js'),
  langPath: vendorUrl('tessdata'),
};
