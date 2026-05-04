import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import UploadZone from '../components/upload/UploadZone';
import PageGallery from '../components/pages/PageGallery';
import ReviewPanel from '../components/review/ReviewPanel';
import ExportButton from '../components/export/ExportButton';
import { getBook, getPages, getPagesByIds, deleteAllPages } from '../api/client';

export default function BookEditorPage() {
  const { bookId } = useParams();
  const [book, setBook] = useState(null);
  const [pages, setPages] = useState([]);
  const [reviewPages, setReviewPages] = useState([]); // pages pending review
  const [loading, setLoading] = useState(true);
  const [deletingAll, setDeletingAll] = useState(false);

  useEffect(() => {
    Promise.all([getBook(bookId), getPages(bookId)])
      .then(([b, p]) => { setBook(b); setPages(p); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bookId]);

  async function handleUploadComplete({ pageIds }) {
    if (!pageIds?.length) return;
    // Fetch the newly added pages for review
    const newPages = await getPagesByIds(bookId, pageIds);
    setReviewPages(newPages);
    // Also add them to the main gallery immediately
    setPages(prev => {
      const existingIds = new Set(prev.map(p => p.id));
      const fresh = newPages.filter(p => !existingIds.has(p.id));
      return [...prev, ...fresh].sort((a, b) => a.position - b.position);
    });
  }

  function handleReviewChange(updatedReviewPages) {
    setReviewPages(updatedReviewPages);
    // Sync changes back into the main gallery
    setPages(prev => {
      const reviewMap = new Map(updatedReviewPages.map(p => [p.id, p]));
      const deletedIds = new Set(
        prev.filter(p => reviewMap.has(p.id) === false && reviewPages.some(r => r.id === p.id))
          .map(p => p.id)
      );
      const mapped = prev
        .filter(p => !deletedIds.has(p.id))
        .map(p => reviewMap.get(p.id) || p);
      // Append any brand-new pages added via manual crop
      const existingIds = new Set(mapped.map(p => p.id));
      const added = updatedReviewPages.filter(p => !existingIds.has(p.id));
      return [...mapped, ...added].sort((a, b) => a.position - b.position);
    });
  }

  async function handleDeleteAll() {
    if (!confirm(`Eliminare tutte le ${pages.length} pagine?`)) return;
    setDeletingAll(true);
    try {
      await deleteAllPages(bookId);
      setPages([]);
      setReviewPages([]);
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingAll(false);
    }
  }

  function handleDismissReview() {
    setReviewPages([]);
    // Re-fetch to get the definitive sorted list
    getPages(bookId).then(setPages).catch(console.error);
  }

  if (loading) {
    return (
      <>
        <Header />
        <div className="flex items-center justify-center h-64 text-gray-400">Caricamento...</div>
      </>
    );
  }

  if (!book) {
    return (
      <>
        <Header />
        <div className="flex items-center justify-center h-64 text-red-500">Libro non trovato.</div>
      </>
    );
  }

  return (
    <>
      <Header breadcrumb={book.name} />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Upload */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Aggiungi pagine</h2>
          <UploadZone bookId={bookId} onComplete={handleUploadComplete} />
        </section>

        {/* Review panel — shown after each upload */}
        {reviewPages.length > 0 && (
          <ReviewPanel
            bookId={bookId}
            pages={reviewPages}
            onPagesChange={handleReviewChange}
            onDismiss={handleDismissReview}
          />
        )}

        {/* Main gallery */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">
              Pagine del libro
              {pages.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">({pages.length})</span>
              )}
            </h2>
            {pages.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteAll}
                  disabled={deletingAll}
                  className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-400 disabled:opacity-50 transition-colors"
                >
                  {deletingAll ? '...' : 'Elimina tutto'}
                </button>
                <ExportButton bookId={bookId} disabled={pages.length === 0} />
              </div>
            )}
          </div>

          {pages.length > 0 && (
            <p className="text-xs text-gray-400 mb-4">
              Trascina per riordinare · × per eliminare
            </p>
          )}

          <PageGallery bookId={bookId} pages={pages} onPagesChange={setPages} />
        </section>
      </main>
    </>
  );
}
