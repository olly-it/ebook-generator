const express = require('express');
const router = express.Router();
const db = require('../db/client');

// GET /api/books
router.get('/', async (_req, res) => {
  const { rows } = await db.query(
    `SELECT b.id, b.name, b.created_at, COUNT(p.id)::int AS page_count
     FROM books b
     LEFT JOIN pages p ON p.book_id = b.id
     GROUP BY b.id
     ORDER BY b.created_at DESC`
  );
  res.json(rows);
});

// POST /api/books
router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { rows } = await db.query(
    'INSERT INTO books (name) VALUES ($1) RETURNING *',
    [name.trim()]
  );
  res.status(201).json(rows[0]);
});

// GET /api/books/:id
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.id, b.name, b.created_at, COUNT(p.id)::int AS page_count
     FROM books b
     LEFT JOIN pages p ON p.book_id = b.id
     WHERE b.id = $1
     GROUP BY b.id`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Book not found' });
  res.json(rows[0]);
});

// PATCH /api/books/:id
router.patch('/:id', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const { rows } = await db.query(
    'UPDATE books SET name = $1, updated_at = now() WHERE id = $2 RETURNING *',
    [name.trim(), req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Book not found' });
  res.json(rows[0]);
});

// DELETE /api/books/:id
router.delete('/:id', async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM books WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Book not found' });
  res.status(204).end();
});

module.exports = router;
