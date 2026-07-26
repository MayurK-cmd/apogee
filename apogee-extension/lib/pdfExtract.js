// PDF text extraction, runs inside the service worker (see
// background/service-worker.js's "extract-pdf" action). Ported from
// apogee-backend/src/services/pdfService.js, but uses pdfjs-dist's browser
// build (pdf.mjs) instead of the legacy Node build, since there's no Node
// process here.
//
// Dynamic-imported, mirrors offscreen.js's getWebLLM(): a heavy module load
// shouldn't block message-handler registration.

// Not exported: only ever thrown within this module.
class PdfExtractionError extends Error {}

let _pdfjs = null;

async function getPdfjs() {
  if (!_pdfjs) {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc =
      chrome.runtime.getURL("pdf.worker.js");
    _pdfjs = pdfjs;
  }
  return _pdfjs;
}

// The PDF's bytes arrive base64-encoded (see extractPdfContent in
// lib/pageExtraction.js: raw ArrayBuffers don't survive Chromium's
// JSON-serialized executeScript results / runtime messages).
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Extract all text from a PDF given as a base64 string. */
export async function extractPdfText(pdfBase64) {
  const {
    getDocument,
    InvalidPDFException,
    PasswordException,
    VerbosityLevel,
  } = await getPdfjs();

  const loadingTask = getDocument({
    data: base64ToBytes(pdfBase64),
    isEvalSupported: false,
    useSystemFonts: true,
    verbosity: VerbosityLevel.ERRORS,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    if (err instanceof InvalidPDFException) {
      throw new PdfExtractionError("This file is not a valid PDF.");
    }
    if (err instanceof PasswordException) {
      throw new PdfExtractionError("This PDF is password-protected.");
    }
    throw new PdfExtractionError(err.message ?? String(err));
  }

  try {
    let text = "";
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      // Text items are runs, not lines, join runs with a space and honor
      // each item's hasEOL flag so line breaks match the PDF's layout.
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        text += item.str + (item.hasEOL ? "\n" : " ");
      }
      text += "\n";
    }
    return text;
  } finally {
    await loadingTask.destroy();
  }
}
