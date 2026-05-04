import { useState, useCallback } from 'react';
import CropCanvas from './CropCanvas';

/**
 * Modal for manually adjusting the crop region of a page.
 * Props:
 *   page       — page object from DB (has source_image, processing_meta.contour_pts)
 *   bookId
 *   onSave(corners, rotation) — called when the user confirms the new crop
 *   onClose
 */
export default function CropModal({ page, onSave, onClose, saving }) {
  const sourceUrl = `/${page.source_image || page.source_file}`;
  const initialCorners = page.processing_meta?.contour_pts || null;

  const [corners, setCorners] = useState(null);
  const [rotation, setRotation] = useState(0);

  const handleCornersChange = useCallback((c) => setCorners(c), []);

  function handleSave() {
    if (!corners) return;
    onSave(corners, rotation);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Modifica ritaglio</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Trascina i 4 angoli per definire la regione della pagina
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        {/* Canvas area */}
        <div className="flex-1 overflow-auto p-4 bg-gray-100">
          <CropCanvas
            imageUrl={sourceUrl}
            initialCorners={initialCorners}
            onCornersChange={handleCornersChange}
          />
        </div>

        {/* Footer controls */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-4">
          {/* Rotation */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 font-medium">Rotazione output:</span>
            {[0, 90, 180, 270].map(d => (
              <button
                key={d}
                onClick={() => setRotation(d)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
                  ${rotation === d
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}
              >
                {d}°
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
            >
              Annulla
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !corners}
              className="px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Elaborazione...' : 'Applica ritaglio'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
