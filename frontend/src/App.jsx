import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import BookEditorPage from './pages/BookEditorPage';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/books/:bookId" element={<BookEditorPage />} />
      </Routes>
    </div>
  );
}
