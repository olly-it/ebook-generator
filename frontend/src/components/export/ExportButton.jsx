import { useState } from 'react';
import { startExport, pollExportJob } from '../../api/client';

export default function ExportButton({ bookId, disabled }) {
  const [state, setState] = useState('idle'); // idle | exporting | done | error
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [error, setError] = useState(null);

  async function handleExport() {
    setState('exporting');
    setError(null);
    setDownloadUrl(null);

    try {
      const { jobId } = await startExport(bookId);

      await new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
          try {
            const job = await pollExportJob(bookId, jobId);
            if (job.status === 'done') {
              clearInterval(interval);
              setDownloadUrl(job.outputPath);
              resolve();
            } else if (job.status === 'error') {
              clearInterval(interval);
              reject(new Error(job.error || 'Export failed'));
            }
          } catch (e) {
            clearInterval(interval);
            reject(e);
          }
        }, 1000);
      });

      setState('done');
    } catch (e) {
      setError(e.message);
      setState('error');
    }
  }

  return (
    <div className="flex items-center gap-3">
      {state === 'done' && downloadUrl ? (
        <a
          href={downloadUrl}
          download
          className="bg-green-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-green-700 transition-colors"
        >
          Scarica PDF
        </a>
      ) : (
        <button
          onClick={handleExport}
          disabled={disabled || state === 'exporting'}
          className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {state === 'exporting' ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Esportazione...
            </span>
          ) : (
            'Esporta PDF'
          )}
        </button>
      )}

      {state === 'error' && (
        <p className="text-sm text-red-600">Errore: {error}</p>
      )}
    </div>
  );
}
