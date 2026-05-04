const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { exportToPdf } = require('../services/pdfExporter');
const { createJob, getJob, updateJob } = require('../services/jobQueue');
const db = require('../db/client');

const STORAGE = process.env.STORAGE_PATH;

// POST /api/books/:bookId/export
router.post('/', async (req, res) => {
  const { bookId } = req.params;

  const { rows: pages } = await db.query(
    'SELECT * FROM pages WHERE book_id = $1 ORDER BY position',
    [bookId]
  );
  if (!pages.length) return res.status(400).json({ error: 'No pages to export' });

  const jobId = uuidv4();
  createJob(jobId);
  updateJob(jobId, { status: 'processing', total: pages.length, progress: 0 });

  res.status(202).json({ jobId });

  const imagePaths = pages.map((p) => path.join(STORAGE, p.processed_file));
  const exportDir = path.join(STORAGE, 'exports', bookId);
  fs.mkdirSync(exportDir, { recursive: true });
  const outputPath = path.join(exportDir, `export_${jobId}.pdf`);

  exportToPdf(imagePaths, outputPath)
    .then(() => updateJob(jobId, { status: 'done', outputPath: `/exports/${bookId}/export_${jobId}.pdf` }))
    .catch((err) => {
      console.error('Export failed:', err);
      updateJob(jobId, { status: 'error', error: err.message });
    });
});

// GET /api/books/:bookId/export/jobs/:jobId
router.get('/jobs/:jobId', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

module.exports = router;
