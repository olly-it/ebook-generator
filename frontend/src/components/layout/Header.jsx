import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

export default function Header({
  breadcrumb,
  breadcrumbEditable = false,
  breadcrumbEditing = false,
  breadcrumbDraft = '',
  breadcrumbSaving = false,
  onBreadcrumbEdit,
  onBreadcrumbDraftChange,
  onBreadcrumbCommit,
  onBreadcrumbCancel,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (breadcrumbEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [breadcrumbEditing]);

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
      <Link to="/" className="text-indigo-600 font-semibold text-lg hover:text-indigo-800">
        Ebook Generator
      </Link>
      {breadcrumb !== undefined && breadcrumb !== null && (
        <>
          <span className="text-gray-400">/</span>
          {breadcrumbEditing ? (
            <input
              ref={inputRef}
              value={breadcrumbDraft}
              onChange={e => onBreadcrumbDraftChange?.(e.target.value)}
              onBlur={() => onBreadcrumbCommit?.()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); onBreadcrumbCommit?.(); }
                else if (e.key === 'Escape') { e.preventDefault(); onBreadcrumbCancel?.(); }
              }}
              disabled={breadcrumbSaving}
              className="border border-indigo-300 rounded-md px-2 py-1 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-w-[16rem] disabled:opacity-60"
            />
          ) : breadcrumbEditable ? (
            <button
              type="button"
              onClick={onBreadcrumbEdit}
              title="Rinomina libro"
              className="group flex items-center gap-1.5 text-gray-700 font-medium truncate max-w-md hover:text-indigo-700"
            >
              <span className="truncate">{breadcrumb}</span>
              <span className="text-gray-300 group-hover:text-indigo-500 text-xs">✎</span>
            </button>
          ) : (
            <span className="text-gray-700 font-medium truncate max-w-xs">{breadcrumb}</span>
          )}
        </>
      )}
    </header>
  );
}
