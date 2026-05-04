require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const path = require('path');

const booksRouter = require('./routes/books');
const pagesRouter = require('./routes/pages');
const uploadRouter = require('./routes/upload');
const exportRouter = require('./routes/exportRoute');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const STORAGE = process.env.STORAGE_PATH;
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static files
app.use('/processed', express.static(path.resolve(STORAGE, 'processed')));
app.use('/exports', express.static(path.resolve(STORAGE, 'exports')));
app.use('/uploads', express.static(path.resolve(STORAGE, 'uploads')));

// API routes
app.use('/api/books', booksRouter);
app.use('/api/books/:bookId/pages', pagesRouter);
app.use('/api/books/:bookId/upload', uploadRouter);
app.use('/api/books/:bookId/export', exportRouter);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Ebook Generator API running on http://localhost:${PORT}`);
});
