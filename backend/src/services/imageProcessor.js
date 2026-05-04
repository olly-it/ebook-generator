const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPT = path.resolve(__dirname, '../../../python/process_image.py');
const PYTHON = () => process.env.PYTHON_CMD || 'python3';

function runPython(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON(), [SCRIPT, ...args]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Python failed (exit ${code}): ${stderr.slice(0, 500)}`));
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) return reject(new Error(result.error));
        resolve(result.pages || []);
      } catch {
        reject(new Error(`Bad Python output: ${stdout.slice(0, 200)}`));
      }
    });
    proc.on('error', (err) => reject(new Error(`Failed to start Python: ${err.message}`)));
  });
}

/**
 * Auto-process a file (image or PDF).
 * srcDir: where to save rendered PDF source pages (should be inside uploads/)
 */
function processImage(inputPath, outDir, srcDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['--input', inputPath, '--outdir', outDir];
  if (srcDir) {
    fs.mkdirSync(srcDir, { recursive: true });
    args.push('--srcdir', srcDir);
  }
  return runPython(args);
}

/**
 * Re-process an existing page with manually supplied corners.
 * corners: [[x,y],[x,y],[x,y],[x,y]] in source image coordinates.
 */
function cropWithCorners(sourceImagePath, corners, rotation, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const args = [
    '--input', sourceImagePath,
    '--outdir', outDir,
    '--corners', JSON.stringify(corners),
  ];
  if (rotation) args.push('--rotate', String(rotation));
  return runPython(args);
}

/**
 * Rotate an already-processed image in-place.
 */
function rotateInPlace(processedPath, degrees) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON(), [SCRIPT, '--inplace', processedPath, '--rotate', String(degrees)]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Rotate failed: ${stderr.slice(0, 300)}`));
      try {
        const result = JSON.parse(stdout.trim());
        if (result.error) return reject(new Error(result.error));
        resolve(result.pages[0]);
      } catch {
        reject(new Error(`Bad Python output: ${stdout}`));
      }
    });
    proc.on('error', (err) => reject(new Error(`Failed to start Python: ${err.message}`)));
  });
}

/**
 * Split a source image at a given ratio, applying per-part rotations.
 * direction: 'horizontal' (top/bottom) | 'vertical' (left/right)
 */
function splitImage(sourceImagePath, direction, splitAt, rotateA, rotateB, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  return runPython([
    '--input', sourceImagePath,
    '--split', direction,
    '--split-at', String(splitAt),
    '--rotate-a', String(rotateA || 0),
    '--rotate-b', String(rotateB || 0),
    '--outdir', outDir,
  ]);
}

module.exports = { processImage, cropWithCorners, rotateInPlace, splitImage };
