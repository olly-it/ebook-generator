const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const fs = require('fs');
const db = require('../db/client');
const { cropWithCorners, rotateInPlace, splitImage, detectCornersInImage } = require('../services/imageProcessor');

const STORAGE = () => path.resolve(process.env.STORAGE_PATH);

// Look up provenance fields (original upload filename + PDF page index) for a
// given source_image — these are stable per source, so any existing page from
// the same source is a valid donor. Falls back to deriving the page index from
// the `src_pdf_p<N>_*` filename when no donor is available.
async function provenanceFor(bookId, sourceImage) {
  const out = {};
  if (!sourceImage) return out;
  const { rows } = await db.query(
    `SELECT processing_meta FROM pages WHERE book_id = $1 AND source_image = $2 LIMIT 1`,
    [bookId, sourceImage]
  );
  const donor = rows[0]?.processing_meta || {};
  if (donor.original_filename) out.original_filename = donor.original_filename;
  if (donor.original_upload_file) out.original_upload_file = donor.original_upload_file;
  if (donor.original_page_index != null) out.original_page_index = donor.original_page_index;
  if (out.original_page_index == null) {
    const m = path.basename(sourceImage).match(/^src_pdf_p(\d+)_/);
    if (m) out.original_page_index = parseInt(m[1], 10);
  }
  return out;
}

// GET /api/books/:bookId/pages
router.get('/', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM pages WHERE book_id = $1 ORDER BY position',
    [req.params.bookId]
  );
  res.json(rows);
});

// GET /api/books/:bookId/pages/by-ids?ids=id1,id2,...
router.get('/by-ids', async (req, res) => {
  const ids = (req.query.ids || '').split(',').filter(Boolean);
  if (!ids.length) return res.json([]);
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
  const { rows } = await db.query(
    `SELECT * FROM pages WHERE book_id = $1 AND id IN (${placeholders}) ORDER BY position`,
    [req.params.bookId, ...ids]
  );
  res.json(rows);
});

// GET /api/books/:bookId/source-file?group=<group_key>
// Resolves the original uploaded file (PDF or image) for a group of pages
// sharing a common source. The group_key matches what SourceFilesList builds
// on the client: original_filename when available, otherwise a derived key.
// Returns the file inline so browser PDF/image viewers can show all pages.
router.get('/source-file', async (req, res) => {
  const { bookId } = req.params;
  const group = req.query.group || req.query.name;
  if (!group) return res.status(400).json({ error: 'group required' });

  // Match by original_filename OR by source_image basename pattern (legacy).
  const { rows } = await db.query(
    `SELECT processing_meta, source_file, source_image
     FROM pages
     WHERE book_id = $1
       AND (processing_meta->>'original_filename' = $2
            OR source_image LIKE $3
            OR source_file LIKE $3)
     ORDER BY position`,
    [bookId, group, `%${group}%`]
  );
  if (!rows.length) return res.status(404).json({ error: 'No pages found for that file' });

  const storage = STORAGE();
  const displayName = rows[0].processing_meta?.original_filename || group;

  let rel = rows[0].processing_meta?.original_upload_file;

  // Fallback 1: source_file points to a real upload (image OR pdf, not a rendered jpg).
  if (!rel) {
    const sf = rows[0].source_file || '';
    if (/\.pdf$/i.test(sf) && !sf.includes('/rendered/')) rel = sf;
    else if (/\.(jpg|jpeg|png|tiff?|bmp|webp)$/i.test(sf) && !sf.includes('/rendered/')) rel = sf;
  }

  // Fallback 2: rendered PDF page → find the source PDF in uploads/<bookId>/
  // by matching mtime proximity (PDF written just before its rendered pages).
  if (!rel) {
    const sourceImage = rows[0].source_image || rows[0].source_file || '';
    const m = path.basename(sourceImage).match(/^src_pdf_p\d+_(\d+)_/);
    if (m) {
      const renderTs = parseInt(m[1], 10);
      const uploadDir = path.join(storage, 'uploads', bookId);
      try {
        const files = fs.readdirSync(uploadDir).filter(f => /\.pdf$/i.test(f));
        let best = null;
        let bestDelta = Infinity;
        for (const f of files) {
          const full = path.join(uploadDir, f);
          const st = fs.statSync(full);
          const delta = Math.abs(st.mtimeMs - renderTs);
          if (delta < bestDelta) { bestDelta = delta; best = full; }
        }
        if (best) rel = path.relative(storage, best);
      } catch (_) { /* uploads dir missing */ }
    }
  }

  if (!rel) {
    return res.status(404).json({
      error: 'Original file not available — caricalo di nuovo per abilitare l\'anteprima.',
    });
  }

  const abs = path.resolve(storage, rel);
  if (!abs.startsWith(storage)) return res.status(400).json({ error: 'Invalid path' });

  res.sendFile(abs, {
    headers: {
      'Content-Disposition': `inline; filename="${encodeURIComponent(displayName)}"`,
    },
  });
});

// PATCH /api/books/:bookId/pages/reorder
router.patch('/reorder', async (req, res) => {
  const updates = req.body;
  if (!Array.isArray(updates)) return res.status(400).json({ error: 'Expected array' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const { id, position } of updates) {
      await client.query(
        'UPDATE pages SET position = $1 WHERE id = $2 AND book_id = $3',
        [position, id, req.params.bookId]
      );
    }
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// POST /api/books/:bookId/pages/:pageId/rotate
// Body: { degrees: 90 | -90 | 180 }
router.post('/:pageId/rotate', async (req, res) => {
  const { degrees } = req.body;
  if (![90, -90, 180, 270].includes(degrees)) {
    return res.status(400).json({ error: 'degrees must be 90, -90, 180, or 270' });
  }

  const { rows } = await db.query(
    'SELECT * FROM pages WHERE id = $1 AND book_id = $2',
    [req.params.pageId, req.params.bookId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Page not found' });

  const page = rows[0];
  const processedAbs = path.join(STORAGE(), page.processed_file);
  const result = await rotateInPlace(processedAbs, degrees);

  const meta = { ...(page.processing_meta || {}), rotation: (page.processing_meta?.rotation || 0) + degrees };
  await db.query(
    'UPDATE pages SET width_px = $1, height_px = $2, processing_meta = $3 WHERE id = $4',
    [result.width, result.height, JSON.stringify(meta), page.id]
  );

  const { rows: updated } = await db.query('SELECT * FROM pages WHERE id = $1', [page.id]);
  res.json(updated[0]);
});

// POST /api/books/:bookId/pages/:pageId/recrop
// Body: { corners: [[x,y],[x,y],[x,y],[x,y]], rotation?: number }
// Re-processes the page with new corners from the source image
router.post('/:pageId/recrop', async (req, res) => {
  const { corners, rotation = 0 } = req.body;
  if (!Array.isArray(corners) || corners.length !== 4) {
    return res.status(400).json({ error: 'corners must be array of 4 [x,y] pairs' });
  }

  const { rows } = await db.query(
    'SELECT * FROM pages WHERE id = $1 AND book_id = $2',
    [req.params.pageId, req.params.bookId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Page not found' });

  const page = rows[0];
  const storage = STORAGE();
  const sourceAbs = path.join(storage, page.source_image || page.source_file);
  const outDir = path.join(storage, 'processed', req.params.bookId);

  const pages = await cropWithCorners(sourceAbs, corners, rotation, outDir);
  if (!pages.length) return res.status(500).json({ error: 'Processing returned no pages' });

  const newPage = pages[0];
  const processedRel = path.relative(storage, path.join(outDir, newPage.filename));

  const old = page.processing_meta || {};
  const provenance = {};
  if (old.original_filename) provenance.original_filename = old.original_filename;
  if (old.original_page_index != null) provenance.original_page_index = old.original_page_index;
  await db.query(
    `UPDATE pages SET processed_file = $1, width_px = $2, height_px = $3, processing_meta = $4 WHERE id = $5`,
    [processedRel, newPage.width, newPage.height,
     JSON.stringify({ ...newPage.processing_meta, ...provenance, method: 'manual_recrop' }), page.id]
  );

  const { rows: updated } = await db.query('SELECT * FROM pages WHERE id = $1', [page.id]);
  res.json(updated[0]);
});

// POST /api/books/:bookId/pages/detect-corners
// Body: { source_image, region?: {x,y,w,h} }
// Runs contour detection on the source image (or a region of it).
// Returns { corners: [[x,y]×4] } in source image coords, or { corners: null }.
router.post('/detect-corners', async (req, res) => {
  const { source_image, region } = req.body;
  if (!source_image) return res.status(400).json({ error: 'source_image required' });
  const sourceAbs = path.join(STORAGE(), source_image);
  const corners = await detectCornersInImage(sourceAbs, region || null);
  res.json({ corners });
});

// POST /api/books/:bookId/pages/edit
// Body: { source_image, parts: [{corners, rotation}], replace_ids?, do_split?, direction?, split_at? }
// Re-processes N parts from the source image (perspective crop + rotation each),
// replaces replace_ids pages with the new results.
router.post('/edit', async (req, res) => {
  const { source_image, parts, replace_ids = [], do_split = false, direction = 'horizontal', split_at = 0.5 } = req.body;
  if (!source_image || !Array.isArray(parts) || parts.length === 0) {
    return res.status(400).json({ error: 'source_image and parts[] required' });
  }

  const storage = STORAGE();
  const sourceAbs = path.join(storage, source_image);
  const outDir = path.join(storage, 'processed', req.params.bookId);
  const provenance = await provenanceFor(req.params.bookId, source_image);

  // Determine insert position and delete replaced pages
  let insertPos = 1;
  if (replace_ids.length) {
    const ph = replace_ids.map((_, i) => `$${i + 2}`).join(',');
    const { rows } = await db.query(
      `SELECT COALESCE(MIN(position), 1) AS min_pos FROM pages WHERE id IN (${ph}) AND book_id = $1`,
      [req.params.bookId, ...replace_ids]
    );
    insertPos = parseFloat(rows[0].min_pos);
    await db.query(
      `DELETE FROM pages WHERE id IN (${ph}) AND book_id = $1`,
      [req.params.bookId, ...replace_ids]
    );
  } else {
    const { rows } = await db.query(
      'SELECT COALESCE(MAX(position), 0) AS max_pos FROM pages WHERE book_id = $1',
      [req.params.bookId]
    );
    insertPos = parseFloat(rows[0].max_pos) + 1;
  }

  const splitLabels = direction === 'horizontal' ? ['top', 'bottom'] : ['left', 'right'];
  const inserted = [];
  for (let i = 0; i < parts.length; i++) {
    const { corners, rotation = 0 } = parts[i];
    const result = await cropWithCorners(sourceAbs, corners, rotation, outDir);
    if (!result.length) continue;
    const p = result[0];
    const rel = path.relative(storage, path.join(outDir, p.filename));
    const partMeta = do_split
      ? { method: 'manual_split', split_from: splitLabels[i], split_at, split_direction: direction, rotation, contour_pts: corners }
      : { method: 'manual_crop', rotation, contour_pts: corners };
    const { rows } = await db.query(
      `INSERT INTO pages (book_id, position, source_file, source_image, processed_file, width_px, height_px, processing_meta)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.bookId, insertPos + i * 0.01, source_image, rel,
       p.width, p.height, JSON.stringify({ ...p.processing_meta, ...provenance, ...partMeta })]
    );
    inserted.push(rows[0]);
  }

  res.status(201).json(inserted);
});

// POST /api/books/:bookId/pages/split
// Body: { source_image, direction, split_at, rotate_a, rotate_b, replace_ids? }
// Splits source image at split_at (0–1), replaces replace_ids pages with 2 new ones.
router.post('/split', async (req, res) => {
  const { source_image, direction, split_at = 0.5, rotate_a = 0, rotate_b = 0, replace_ids = [] } = req.body;
  if (!source_image || !['horizontal', 'vertical'].includes(direction)) {
    return res.status(400).json({ error: 'source_image and direction (horizontal|vertical) required' });
  }

  const storage = STORAGE();
  const sourceAbs = path.join(storage, source_image);
  const outDir = path.join(storage, 'processed', req.params.bookId);
  const provenance = await provenanceFor(req.params.bookId, source_image);

  const parts = await splitImage(sourceAbs, direction, split_at, rotate_a, rotate_b, outDir);
  if (!parts.length) return res.status(500).json({ error: 'Split produced no pages' });

  // Determine insert position and delete replaced pages
  let insertPos = 1;
  if (replace_ids.length) {
    const ph = replace_ids.map((_, i) => `$${i + 2}`).join(',');
    const { rows: minRow } = await db.query(
      `SELECT COALESCE(MIN(position), 1) AS min_pos FROM pages WHERE id IN (${ph}) AND book_id = $1`,
      [req.params.bookId, ...replace_ids]
    );
    insertPos = parseFloat(minRow[0].min_pos);
    await db.query(
      `DELETE FROM pages WHERE id IN (${ph}) AND book_id = $1`,
      [req.params.bookId, ...replace_ids]
    );
  } else {
    const { rows } = await db.query(
      'SELECT COALESCE(MAX(position), 0) AS max_pos FROM pages WHERE book_id = $1',
      [req.params.bookId]
    );
    insertPos = parseFloat(rows[0].max_pos) + 1;
  }

  const inserted = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const processedRel = path.relative(storage, path.join(outDir, p.filename));
    const { rows } = await db.query(
      `INSERT INTO pages (book_id, position, source_file, source_image, processed_file, width_px, height_px, processing_meta)
       VALUES ($1, $2, $3, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.bookId, insertPos + i * 0.01, source_image, processedRel,
       p.width, p.height, JSON.stringify({ ...p.processing_meta, ...provenance })]
    );
    inserted.push(rows[0]);
  }

  res.status(201).json(inserted);
});

// POST /api/books/:bookId/pages/manual-crop
// Body: { source_image, corners, rotation?, position? }
// Creates a brand-new page from a manual crop of any source image
router.post('/manual-crop', async (req, res) => {
  const { source_image, corners, rotation = 0, position } = req.body;
  if (!source_image || !Array.isArray(corners) || corners.length !== 4) {
    return res.status(400).json({ error: 'source_image and 4 corners required' });
  }

  const storage = STORAGE();
  const sourceAbs = path.join(storage, source_image);
  const outDir = path.join(storage, 'processed', req.params.bookId);
  const provenance = await provenanceFor(req.params.bookId, source_image);

  const pages = await cropWithCorners(sourceAbs, corners, rotation, outDir);
  if (!pages.length) return res.status(500).json({ error: 'Processing returned no pages' });

  const newPage = pages[0];
  const processedRel = path.relative(storage, path.join(outDir, newPage.filename));

  // Determine position
  let pos = position;
  if (!pos) {
    const { rows } = await db.query(
      'SELECT COALESCE(MAX(position), 0) AS max_pos FROM pages WHERE book_id = $1',
      [req.params.bookId]
    );
    pos = parseFloat(rows[0].max_pos) + 1;
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO pages (book_id, position, source_file, source_image, processed_file, width_px, height_px, processing_meta)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7) RETURNING *`,
    [req.params.bookId, pos, source_image, processedRel,
     newPage.width, newPage.height,
     JSON.stringify({ ...newPage.processing_meta, ...provenance, method: 'manual_crop' })]
  );
  res.status(201).json(inserted[0]);
});

// DELETE /api/books/:bookId/pages — delete ALL pages for a book
router.delete('/', async (req, res) => {
  await db.query('DELETE FROM pages WHERE book_id = $1', [req.params.bookId]);
  res.status(204).end();
});

// DELETE /api/books/:bookId/pages/:pageId
router.delete('/:pageId', async (req, res) => {
  const { rowCount } = await db.query(
    'DELETE FROM pages WHERE id = $1 AND book_id = $2',
    [req.params.pageId, req.params.bookId]
  );
  if (!rowCount) return res.status(404).json({ error: 'Page not found' });
  res.status(204).end();
});

module.exports = router;
