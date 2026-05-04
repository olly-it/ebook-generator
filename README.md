# Ebook Generator

Genera ebook da foto o PDF di pagine di libri con correzione prospettica automatica.

## Prerequisiti

- **Node.js** 18+
- **Python** 3.10+
- **PostgreSQL** (già installato in locale)

> Non servono ImageMagick, Ghostscript o altri tool di sistema: i PDF vengono renderizzati via PyMuPDF (puro Python).

## Setup iniziale

```bash
# 1. Crea il database
createdb ebook_generator

# 2. Installa dipendenze backend e frontend
cd backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Crea il venv Python e installa i pacchetti
cd python && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..

# 4. Esegui la migration
cd backend && node src/db/migrate.js && cd ..
```

## Avvio

Apri due terminali:

```bash
# Terminale 1 — Backend (porta 3001)
cd backend && npm run dev

# Terminale 2 — Frontend (porta 5173)
cd frontend && npm run dev
```

Apri il browser su **http://localhost:5173**

## Architettura

```
frontend/        React + Vite + Tailwind (porta 5173)
backend/         Node.js + Express (porta 3001)
  storage/
    uploads/     File originali caricati
    processed/   Pagine estratte e corrette
    exports/     PDF esportati
python/
  venv/          Ambiente virtuale Python
  process_image.py   Script di elaborazione (chiamato da Node)
  lib/
    detector.py      Rilevamento contorni pagina (OpenCV)
    perspective.py   Correzione prospettica (homography)
```

## Come funziona

1. **Upload**: carica uno o più PDF o immagini (foto di pagine di libri)
2. **Elaborazione**: Python + OpenCV rileva i bordi della pagina, corregge la prospettiva
   - Se l'immagine contiene due pagine (libro aperto), le separa automaticamente
   - I PDF vengono renderizzati a 200 DPI e poi corretti  
3. **Visualizzazione**: le pagine estratte compaiono in griglia, riordinabili con drag & drop
4. **Esportazione**: clicca "Esporta PDF" per scaricare l'ebook in formato PDF

## Variabili d'ambiente (`backend/.env`)

| Variabile | Default |
|-----------|---------|
| `PORT` | `3001` |
| `DATABASE_URL` | `postgresql://localhost:5432/ebook_generator` |
| `STORAGE_PATH` | `./storage` |
| `PYTHON_CMD` | percorso al Python del venv |
