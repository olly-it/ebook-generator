import { useState } from 'react';
import CropModal from './CropModal';
import AddCropModal from './AddCropModal';
import { rotatePage, recropPage, deletePage, manualCropPage } from '../../api/client';

/**
 * Panel shown after upload, displaying newly extracted pages for review.
 * Allows: rotate ±90°, delete, edit crop (recrop), add new crop from same source.
 *
 * Props:
 *   bookId
 *   pages         — array of page objects (newly added)
 *   onPagesChange — called with updated pages array (can include additions/removals)
 *   onDismiss     — called when user clicks "Fatto"
 */
export default function ReviewPanel({ bookId, pages, onPagesChange, onDismiss }) {
  const [cropPage, setCropPage] = useState(null);      // page being re-cropped
  const [addCropSrc, setAddCropSrc] = useState(null);  // source_image for new crop
  const [savingId, setSavingId] = useState(null);
  const [addSaving, setAddSaving] = useState(false);

  // Build unique source images for "Aggiungi ritaglio" buttons
  const uniqueSources = [...new Set(pages.map(p => p.source_image || p.source_file).filter(Boolean))];

  async function handleRotate(page, degrees) {
    setSavingId(page.id);
    try {
      const updated = await rotatePage(bookId, page.id, degrees);
      onPagesChange(prev => prev.map(p => p.id === updated.id ? updated : p));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(pageId) {
    if (!confirm('Eliminare questa pagina dalla revisione?')) return;
    setSavingId(pageId);
    try {
      await deletePage(bookId, pageId);
      onPagesChange(prev => prev.filter(p => p.id !== pageId));
    } finally {
      setSavingId(null);
    }
  }

  async function handleRecrop(corners, rotation) {
    if (!cropPage) return;
    setSavingId(cropPage.id);
    try {
      const updated = await recropPage(bookId, cropPage.id, corners, rotation);
      onPagesChange(prev => prev.map(p => p.id === updated.id ? updated : p));
      setCropPage(null);
    } finally {
      setSavingId(null);
    }
  }

  async function handleAddCrop(corners, rotation) {
    setAddSaving(true);
    try {
      const newPage = await manualCropPage(bookId, addCropSrc, corners, rotation);
      onPagesChange(prev => [...prev, newPage]);
      setAddCropSrc(null);
    } finally {
      setAddSaving(false);
    }
  }

  if (!pages.length) return null;

  return (
    <>
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-amber-900 text-base">
              Revisione — {pages.length} {pages.length === 1 ? 'pagina estratta' : 'pagine estratte'}
            </h3>
            <p className="text-xs text-amber-700 mt-0.5">
              Ruota o correggi le pagine se necessario, poi clicca "Fatto"
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700"
          >
            Fatto ✓
          </button>
        </div>

        {/* Page grid */}
        <div className="flex flex-wrap gap-3 mb-4">
          {pages.map((page, idx) => (
            <PageReviewCard
              key={page.id}
              page={page}
              index={idx}
              isSaving={savingId === page.id}
              onRotateCW={() => handleRotate(page, 90)}
              onRotateCCW={() => handleRotate(page, -90)}
              onDelete={() => handleDelete(page.id)}
              onEditCrop={() => setCropPage(page)}
            />
          ))}
        </div>

        {/* Add crop from source images */}
        {uniqueSources.length > 0 && (
          <div className="border-t border-amber-200 pt-3 mt-2">
            <p className="text-xs text-amber-700 font-medium mb-2">
              Aggiungere un ritaglio manuale dall'immagine sorgente:
            </p>
            <div className="flex flex-wrap gap-2">
              {uniqueSources.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setAddCropSrc(src)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-amber-800 text-xs hover:bg-amber-50 hover:border-amber-500 transition-colors"
                >
                  <span>+</span>
                  <span>Sorgente {i + 1}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {cropPage && (
        <CropModal
          page={cropPage}
          bookId={bookId}
          saving={savingId === cropPage.id}
          onSave={handleRecrop}
          onClose={() => setCropPage(null)}
        />
      )}
      {addCropSrc && (
        <AddCropModal
          sourceImage={addCropSrc}
          saving={addSaving}
          onSave={handleAddCrop}
          onClose={() => setAddCropSrc(null)}
        />
      )}
    </>
  );
}

function PageReviewCard({ page, index, isSaving, onRotateCW, onRotateCCW, onDelete, onEditCrop }) {
  const imgUrl = `/${page.processed_file}`;
  const method = page.processing_meta?.method || '';
  const isManual = method === 'manual' || method === 'manual_recrop' || method === 'manual_crop';
  const isFallback = method.includes('fallback');

  return (
    <div className={`relative bg-white rounded-xl border shadow-sm overflow-hidden transition-opacity
      ${isSaving ? 'opacity-50 pointer-events-none' : ''}`}
      style={{ width: 140 }}
    >
      {/* Status badge */}
      <div className={`absolute top-1.5 left-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium z-10
        ${isManual ? 'bg-green-100 text-green-700' : isFallback ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>
        {isManual ? 'manuale' : isFallback ? 'no rilevamento' : 'auto'}
      </div>

      <img
        src={imgUrl}
        alt={`Pagina ${index + 1}`}
        className="w-full object-cover"
        style={{ height: 180 }}
        loading="lazy"
      />

      {/* Controls */}
      <div className="p-1.5 bg-white space-y-1">
        <div className="flex gap-1">
          <ActionBtn onClick={onRotateCCW} title="Ruota sx">↺</ActionBtn>
          <ActionBtn onClick={onRotateCW} title="Ruota dx">↻</ActionBtn>
          <ActionBtn onClick={onEditCrop} title="Modifica ritaglio" className="flex-1">✂</ActionBtn>
          <ActionBtn onClick={onDelete} title="Elimina" danger>×</ActionBtn>
        </div>
      </div>

      {isSaving && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70">
          <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

function ActionBtn({ onClick, title, children, danger, className = '' }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 py-1 rounded text-sm font-medium border transition-colors
        ${danger
          ? 'border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600'
          : 'border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-800'}
        ${className}`}
    >
      {children}
    </button>
  );
}
