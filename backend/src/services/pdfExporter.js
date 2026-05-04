const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { imageSize } = require('image-size');

/**
 * Assembles an array of image paths into a PDF file.
 * Each image becomes one page, sized to match the image dimensions.
 */
function exportToPdf(imagePaths, outputPath) {
  return new Promise((resolve, reject) => {
    if (!imagePaths.length) return reject(new Error('No pages to export'));

    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
    const stream = fs.createWriteStream(outputPath);

    doc.pipe(stream);

    for (const imgPath of imagePaths) {
      if (!fs.existsSync(imgPath)) continue;

      let dims;
      try {
        dims = imageSize(imgPath);
      } catch {
        dims = { width: 595, height: 842 }; // fallback A4 points
      }

      // Convert pixels at 200dpi to points (1 point = 1/72 inch)
      const dpi = 200;
      const widthPt = (dims.width / dpi) * 72;
      const heightPt = (dims.height / dpi) * 72;

      doc.addPage({ size: [widthPt, heightPt], margin: 0 });
      doc.image(imgPath, 0, 0, { width: widthPt, height: heightPt });
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

module.exports = { exportToPdf };
