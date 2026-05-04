import { useState, useCallback } from 'react';
import CropCanvas from './CropCanvas';

/**
 * Modal to extract a brand-new page from any source image.
 * Props:
 *   sourceImage — relative path like "uploads/{bookId}/file.jpg"
 *   onSave(corners, rotation)
 *   onClose
 *   saving
 */
export default function AddCropModal({ sourceImage, onSave, onClose, saving }) {
  const sourceUrl = `/${sourceImage}`;
  const [corners, setCorners] = useState(null);
  const [rotation, setRotation] = useState(0);

  const handleCornersChange = useCallback((c) => setCorners(c), []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Aggiungi ritaglio manuale</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Seleziona una regione nell'immagine sorgente per estrarre una nuova pagina
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-auto p-4 bg-gray-100">
          <CropCanvas
            imageUrl={sourceUrl}
            onCornersChange={handleCornersChange}
          />
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 font-medium">Rotazione:</span>
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
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
              Annulla
            </button>
            <button
              onClick={() => corners && onSave(corners, rotation)}
              disabled={saving || !corners}
              className="px-5 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {saving ? 'Elaborazione...' : '+ Aggiungi pagina'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
