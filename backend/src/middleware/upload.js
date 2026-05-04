const multer = require('multer');
const path = require('path');
const fs = require('fs');

function uploadMiddleware(bookId) {
  const dest = path.join(process.env.STORAGE_PATH, 'uploads', bookId);
  fs.mkdirSync(dest, { recursive: true });

  const storage = multer.diskStorage({
    destination: dest,
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cb(null, unique + path.extname(file.originalname).toLowerCase());
    },
  });

  return multer({
    storage,
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(pdf|jpg|jpeg|png|tiff?|bmp|webp)$/i;
      if (allowed.test(file.originalname)) cb(null, true);
      else cb(new Error(`File type not allowed: ${file.originalname}`));
    },
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  });
}

module.exports = uploadMiddleware;
