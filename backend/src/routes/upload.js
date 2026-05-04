const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const uploadMiddleware = require('../middleware/upload');
const { processImage } = require('../services/imageProcessor');
const { createJob, getJob, updateJob } = require('../services/jobQueue');
const db = require('../db/client');

const STORAGE = () => path.resolve(process.env.STORAGE_PATH);

// POST /api/books/:bookId/upload
router.post('/', (req, res) => {
  const { bookId } = req.params;
  const upload = uploadMiddleware(bookId);

  upload.array('files', 50)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const jobId = uuidv4();
    createJob(jobId);
    updateJob(jobId, { status: 'processing', total: files.length, progress: 0, pageIds: [] });

    res.status(202).json({ jobId });

    processFiles(bookId, files, jobId).catch((e) => {
      console.error('Background processing error:', e);
      updateJob(jobId, { status: 'error', error: e.message });
    });
  });
});

// GET /api/books/:bookId/upload/jobs/:jobId
router.get('/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

async function processFiles(bookId, files, jobId) {
  const storage = STORAGE();
  const processedDir = path.join(storage, 'processed', bookId);
  const srcDir = path.join(storage, 'uploads', bookId, 'rendered');

  const { rows } = await db.query(
    'SELECT COALESCE(MAX(position), 0) AS max_pos FROM pages WHERE book_id = $1',
    [bookId]
  );
  let posCounter = parseFloat(rows[0].max_pos) + 1;
  const newPageIds = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const pages = await processImage(file.path, processedDir, srcDir);

      for (const page of pages) {
        const processedAbs = path.join(processedDir, page.filename);
        const processedRel = path.relative(storage, processedAbs);
        // source_image: use what Python returned, or fall back to the uploaded file
        const sourceAbs = page.source_image || file.path;
        const sourceRel = path.relative(storage, sourceAbs);

        const { rows: inserted } = await db.query(
          `INSERT INTO pages (book_id, position, source_file, source_image, processed_file, width_px, height_px, processing_meta)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [bookId, posCounter, sourceRel, sourceRel, processedRel,
           page.width, page.height, JSON.stringify(page.processing_meta || {})]
        );
        newPageIds.push(inserted[0].id);
        posCounter += 1;
      }
    } catch (err) {
      console.error(`Error processing ${file.originalname}:`, err.message);
    }

    updateJob(jobId, { progress: i + 1, pageIds: newPageIds });
  }

  updateJob(jobId, { status: 'done', pageIds: newPageIds });
}

module.exports = router;
