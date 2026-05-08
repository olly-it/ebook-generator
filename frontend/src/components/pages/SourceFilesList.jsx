import { useMemo, useState } from 'react';

// Build a stable group key per upload, even for legacy pages where
// processing_meta.original_filename is missing. Falls back to:
//   - the rendered-PDF batch id (`src_pdf_p<N>_<TS>_<PID>`) → groups all pages
//     of one PDF together
//   - the source_image basename otherwise
function groupKey(page) {
  const meta = page.processing_meta || {};
  if (meta.original_filename) return meta.original_filename;
  const src = page.source_image || page.source_file || '';
  const base = src.split('/').pop() || '';
  const m = base.match(/^src_pdf_p\d+_(\d+_\d+)\./);
  if (m) return `pdf:${m[1]}`;
  return base || 'unknown';
}

function displayLabel(page, key) {
  const meta = page.processing_meta || {};
  if (meta.original_filename) return meta.original_filename;
  if (key.startsWith('pdf:')) return `PDF (${key.slice(4)})`;
  return key;
}

export default function SourceFilesList({ bookId, pages }) {
  const [open, setOpen] = useState(true);

  const groups = useMemo(() => {
    const map = new Map();
    for (const p of pages) {
      const key = groupKey(p);
      if (!map.has(key)) {
        map.set(key, { key, label: displayLabel(p, key), count: 0, firstPos: p.position });
      }
      const g = map.get(key);
      g.count += 1;
      if (p.position < g.firstPos) g.firstPos = p.position;
    }
    return Array.from(map.values()).sort((a, b) => a.firstPos - b.firstPos);
  }, [pages]);

  function openSource(g) {
    // Strip the synthetic "pdf:" prefix so the server can match the rendered
    // filename pattern via LIKE.
    const serverKey = g.key.startsWith('pdf:') ? g.key.slice(4) : g.key;
    const url = `/api/books/${bookId}/pages/source-file?group=${encodeURIComponent(serverKey)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50 rounded-lg"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">File sorgente</span>
          <span className="text-xs text-gray-500">({groups.length})</span>
        </div>
        <span className={`text-gray-400 text-xs transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
      </button>

      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {groups.map(g => (
            <li key={g.key}>
              <button
                type="button"
                onClick={() => openSource(g)}
                title={`Apri ${g.label} in una nuova scheda`}
                className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-indigo-50 group"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-400 group-hover:text-indigo-500 text-xs">↗</span>
                  <span className="text-gray-700 group-hover:text-indigo-700 truncate">{g.label}</span>
                </span>
                <span className="text-xs text-gray-500 whitespace-nowrap ml-3">
                  {g.count} {g.count === 1 ? 'pagina' : 'pagine'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
