const { fromPath } = require('pdf2pic');
const path = require('path');
const fs = require('fs');

/**
 * Converts every page of a PDF to a JPEG and returns their paths.
 * Requires GraphicsMagick or ImageMagick + Ghostscript installed.
 */
async function extractPdfPages(pdfPath, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const convert = fromPath(pdfPath, {
    density: 200,
    saveFilename: `pdf_${Date.now()}`,
    savePath: outputDir,
    format: 'jpg',
    width: 2480,
    height: 3508,
  });

  // Convert all pages (pass -1 for all)
  const results = await convert.bulk(-1, { responseType: 'image' });
  return results.map((r) => r.path).filter(Boolean);
}

module.exports = { extractPdfPages };
