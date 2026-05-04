import { useState, useRef } from 'react';
import { uploadFiles, pollJob } from '../../api/client';

/**
 * onComplete({ pageIds }) is called after processing finishes.
 */
export default function UploadZone({ bookId, onComplete }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  async function handleFiles(files) {
    if (!files.length) return;
    setError(null);
    setUploading(true);
    setProgress({ upload: 0, processing: null });

    try {
      const { jobId } = await uploadFiles(bookId, Array.from(files), (evt) => {
        if (evt.total) {
          setProgress(p => ({ ...p, upload: Math.round((evt.loaded / evt.total) * 100) }));
        }
      });

      setProgress({ upload: 100, processing: { progress: 0, total: null } });

      const job = await new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const j = await pollJob(bookId, jobId);
            setProgress({ upload: 100, processing: { progress: j.progress, total: j.total } });
            if (j.status === 'done') { clearInterval(interval); resolve(j); }
            else if (j.status === 'error') { clearInterval(interval); reject(new Error(j.error || 'Processing failed')); }
          } catch (e) { clearInterval(interval); reject(e); }
        }, 1200);
      });

      onComplete({ pageIds: job.pageIds || [] });
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="mb-6">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current.click()}
        className={`
          border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
          ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-white hover:border-indigo-400 hover:bg-gray-50'}
          ${uploading ? 'cursor-not-allowed opacity-70' : ''}
        `}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,image/*" className="hidden"
          onChange={e => handleFiles(e.target.files)} />
        <div className="text-4xl mb-2">📄</div>
        <p className="text-gray-600 font-medium">Trascina PDF o immagini</p>
        <p className="text-sm text-gray-400 mt-1">PDF, JPG, PNG, TIFF — max 100 MB per file</p>
      </div>

      {uploading && progress && (
        <div className="mt-3 space-y-2">
          <ProgressBar label="Upload" value={progress.upload} />
          {progress.processing !== null && (
            <ProgressBar
              label="Elaborazione pagine"
              value={progress.processing.total
                ? Math.round((progress.processing.progress / progress.processing.total) * 100)
                : null}
              indeterminate={!progress.processing.total}
            />
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
          Errore: {error}
        </p>
      )}
    </div>
  );
}

function ProgressBar({ label, value, indeterminate }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        {!indeterminate && value !== null && <span>{value}%</span>}
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        {indeterminate
          ? <div className="h-full w-1/3 bg-indigo-400 rounded-full animate-pulse" />
          : <div className="h-full bg-indigo-600 rounded-full transition-all duration-300" style={{ width: `${value ?? 0}%` }} />
        }
      </div>
    </div>
  );
}
