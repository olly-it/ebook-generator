import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { reorderPages, deletePage, editPages } from '../../api/client';
import PageEditorModal from '../editor/PageEditorModal';

export default function PageGallery({ bookId, pages, onPagesChange }) {
  const [deleting, setDeleting] = useState(null);
  const [editPage, setEditPage] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  // All pages from the same source_image as `page`
  function getSiblings(page) {
    if (!page.source_image) return [page];
    return pages.filter(p => p.source_image === page.source_image);
  }

  async function handleDragEnd(result) {
    if (!result.destination || result.destination.index === result.source.index) return;

    const reordered = Array.from(pages);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    const updates = reordered.map((p, i) => ({ id: p.id, position: i + 1 }));
    onPagesChange(reordered.map((p, i) => ({ ...p, position: i + 1 })));

    try {
      await reorderPages(bookId, updates);
    } catch (e) {
      console.error('Reorder failed:', e);
    }
  }

  async function handleDelete(e, pageId) {
    e.stopPropagation();
    if (!confirm('Eliminare questa pagina?')) return;
    setDeleting(pageId);
    try {
      await deletePage(bookId, pageId);
      onPagesChange(prev => prev.filter(p => p.id !== pageId));
    } finally {
      setDeleting(null);
    }
  }

  async function handleEditorSave({ parts, sourceImage, replaceIds, doSplit, direction, splitAt }) {
    setEditSaving(true);
    try {
      const newPages = await editPages(bookId, {
        source_image: sourceImage,
        parts,
        replace_ids: replaceIds,
        do_split: doSplit,
        direction,
        split_at: splitAt,
      });
      onPagesChange(prev => {
        const replaceSet = new Set(replaceIds);
        const minPos = Math.min(...prev.filter(p => replaceSet.has(p.id)).map(p => p.position));
        const without = prev.filter(p => !replaceSet.has(p.id));
        const insertIdx = without.findIndex(p => p.position > minPos);
        const merged = insertIdx >= 0
          ? [...without.slice(0, insertIdx), ...newPages, ...without.slice(insertIdx)]
          : [...without, ...newPages];
        return merged.map((p, i) => ({ ...p, position: i + 1 }));
      });
      setEditPage(null);
    } catch (e) {
      console.error('Editor save failed:', e);
    } finally {
      setEditSaving(false);
    }
  }

  if (!pages.length) return (
    <div className="text-center py-16 text-gray-400">
      <p>Nessuna pagina ancora. Carica dei file!</p>
    </div>
  );

  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="pages" direction="horizontal">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex flex-wrap gap-4"
            >
              {pages.map((page, index) => (
                <Draggable key={page.id} draggableId={page.id} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`
                        relative bg-white border rounded-lg overflow-hidden shadow-sm
                        transition-shadow cursor-grab group
                        ${snapshot.isDragging ? 'shadow-xl ring-2 ring-indigo-400 rotate-1' : 'hover:shadow-md'}
                      `}
                      style={{ width: 160, ...provided.draggableProps.style }}
                    >
                      {/* Thumbnail — click opens editor */}
                      <div
                        className="relative cursor-pointer"
                        onClick={() => setEditPage(page)}
                      >
                        <img
                          src={`/processed/${page.processed_file.replace('processed/', '')}`}
                          alt={`Pagina ${index + 1}`}
                          className="w-full object-cover"
                          style={{ height: 220 }}
                          loading="lazy"
                        />
                        {/* Edit overlay on hover */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 text-gray-700 text-xs font-medium px-2 py-1 rounded-md shadow">
                            ✎ Modifica
                          </span>
                        </div>
                      </div>

                      {/* Bottom bar */}
                      <div className="px-2 py-1.5 flex items-center justify-between bg-white">
                        <span className="text-xs text-gray-500 font-medium">Pag. {index + 1}</span>
                        <button
                          onClick={(e) => handleDelete(e, page.id)}
                          disabled={deleting === page.id}
                          className="text-gray-300 hover:text-red-500 text-base leading-none"
                          title="Elimina pagina"
                        >
                          {deleting === page.id ? '...' : '×'}
                        </button>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {editPage && (
        <PageEditorModal
          bookId={bookId}
          page={editPage}
          siblings={getSiblings(editPage)}
          saving={editSaving}
          onSave={handleEditorSave}
          onClose={() => setEditPage(null)}
        />
      )}
    </>
  );
}
