import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/layout/Header';
import { getBooks, createBook, deleteBook } from '../api/client';

export default function HomePage() {
  const [books, setBooks] = useState([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    getBooks().then(setBooks).catch(console.error);
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const book = await createBook(newName.trim());
      navigate(`/books/${book.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm('Eliminare questo libro?')) return;
    await deleteBook(id);
    setBooks(prev => prev.filter(b => b.id !== id));
  }

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold text-gray-900 mb-8">I tuoi libri</h1>

        {/* Create new book */}
        <form onSubmit={handleCreate} className="flex gap-3 mb-10">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nome del nuovo libro..."
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? 'Creazione...' : '+ Nuovo libro'}
          </button>
        </form>

        {/* Book list */}
        {books.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-5xl mb-4">📚</div>
            <p>Nessun libro ancora. Creane uno!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {books.map(book => (
              <div
                key={book.id}
                onClick={() => navigate(`/books/${book.id}`)}
                className="bg-white border border-gray-200 rounded-xl p-5 cursor-pointer hover:border-indigo-400 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold text-gray-900 group-hover:text-indigo-700">{book.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">{book.page_count} pagine</p>
                  </div>
                  <button
                    onClick={e => handleDelete(e, book.id)}
                    className="text-gray-300 hover:text-red-500 transition-colors text-lg"
                    title="Elimina"
                  >
                    ×
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  {new Date(book.created_at).toLocaleDateString('it-IT')}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
