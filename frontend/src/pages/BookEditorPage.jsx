import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import UploadZone from '../components/upload/UploadZone';
import PageGallery from '../components/pages/PageGallery';
import SourceFilesList from '../components/pages/SourceFilesList';
import ExportButton from '../components/export/ExportButton';
import { getBook, getPages, deleteAllPages, renameBook } from '../api/client';

export default function BookEditorPage() {
  const { bookId } = useParams();
  const [book, setBook] = useState(null);
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingAll, setDeletingAll] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [savingTitle, setSavingTitle] = useState(false);

  useEffect(() => {
    Promise.all([getBook(bookId), getPages(bookId)])
      .then(([b, p]) => { setBook(b); setPages(p); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [bookId]);

  async function handleUploadComplete() {
    const updated = await getPages(bookId);
    setPages(updated);
  }

  function startEditTitle() {
    setTitleDraft(book.name);
    setEditingTitle(true);
  }

  async function commitTitle() {
    const next = titleDraft.trim();
    if (!next || next === book.name) {
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      const updated = await renameBook(bookId, next);
      setBook(b => ({ ...b, name: updated.name ?? next }));
      setEditingTitle(false);
    } catch (e) {
      console.error('Rename failed:', e);
    } finally {
      setSavingTitle(false);
    }
  }

  async function handleDeleteAll() {
    if (!confirm(`Eliminare tutte le ${pages.length} pagine?`)) return;
    setDeletingAll(true);
    try {
      await deleteAllPages(bookId);
      setPages([]);
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingAll(false);
    }
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
      <Header
        breadcrumb={book.name}
        breadcrumbEditable
        breadcrumbEditing={editingTitle}
        breadcrumbDraft={titleDraft}
        breadcrumbSaving={savingTitle}
        onBreadcrumbEdit={startEditTitle}
        onBreadcrumbDraftChange={setTitleDraft}
        onBreadcrumbCommit={commitTitle}
        onBreadcrumbCancel={() => setEditingTitle(false)}
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Upload */}
        <section className="mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-3">Aggiungi pagine</h2>
          <UploadZone bookId={bookId} onComplete={handleUploadComplete} />
        </section>

        {/* Source files */}
        {pages.length > 0 && (
          <section className="mb-6">
            <SourceFilesList bookId={bookId} pages={pages} />
          </section>
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
              Trascina per riordinare · × per eliminare · clicca per modificare
            </p>
          )}

          <PageGallery bookId={bookId} pages={pages} onPagesChange={setPages} />
        </section>
      </main>
    </>
  );
}
