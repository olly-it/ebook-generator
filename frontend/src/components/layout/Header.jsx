import { Link } from 'react-router-dom';

export default function Header({ title, breadcrumb }) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-3">
      <Link to="/" className="text-indigo-600 font-semibold text-lg hover:text-indigo-800">
        Ebook Generator
      </Link>
      {breadcrumb && (
        <>
          <span className="text-gray-400">/</span>
          <span className="text-gray-700 font-medium truncate max-w-xs">{breadcrumb}</span>
        </>
      )}
    </header>
  );
}
