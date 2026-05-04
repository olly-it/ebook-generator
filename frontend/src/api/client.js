import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Books
export const getBooks = () => api.get('/books').then(r => r.data);
export const createBook = (name) => api.post('/books', { name }).then(r => r.data);
export const getBook = (id) => api.get(`/books/${id}`).then(r => r.data);
export const renameBook = (id, name) => api.patch(`/books/${id}`, { name }).then(r => r.data);
export const deleteBook = (id) => api.delete(`/books/${id}`);

// Pages
export const getPages = (bookId) => api.get(`/books/${bookId}/pages`).then(r => r.data);
export const getPagesByIds = (bookId, ids) =>
  api.get(`/books/${bookId}/pages/by-ids?ids=${ids.join(',')}`).then(r => r.data);
export const reorderPages = (bookId, updates) =>
  api.patch(`/books/${bookId}/pages/reorder`, updates);
export const deletePage = (bookId, pageId) =>
  api.delete(`/books/${bookId}/pages/${pageId}`);
export const deleteAllPages = (bookId) =>
  api.delete(`/books/${bookId}/pages`);
export const rotatePage = (bookId, pageId, degrees) =>
  api.post(`/books/${bookId}/pages/${pageId}/rotate`, { degrees }).then(r => r.data);
export const recropPage = (bookId, pageId, corners, rotation = 0) =>
  api.post(`/books/${bookId}/pages/${pageId}/recrop`, { corners, rotation }).then(r => r.data);
export const manualCropPage = (bookId, source_image, corners, rotation = 0, position = null) =>
  api.post(`/books/${bookId}/pages/manual-crop`, { source_image, corners, rotation, position }).then(r => r.data);
export const splitPages = (bookId, body) =>
  api.post(`/books/${bookId}/pages/split`, body).then(r => r.data);
export const editPages = (bookId, body) =>
  api.post(`/books/${bookId}/pages/edit`, body).then(r => r.data);

// Upload
export const uploadFiles = (bookId, files, onProgress) => {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  return api.post(`/books/${bookId}/upload`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  }).then(r => r.data);
};
export const pollJob = (bookId, jobId) =>
  api.get(`/books/${bookId}/upload/jobs/${jobId}`).then(r => r.data);

// Export
export const startExport = (bookId) =>
  api.post(`/books/${bookId}/export`).then(r => r.data);
export const pollExportJob = (bookId, jobId) =>
  api.get(`/books/${bookId}/export/jobs/${jobId}`).then(r => r.data);
