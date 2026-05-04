// Genre database module — wraps the RateYourMusic 5947-genre reference data
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const genreDir = path.join(rootDir, '.claude', 'skills', 'music-genre-finder', 'references');

let _genres = null;
let _byName = null;

function loadGenres() {
  if (_genres) return _genres;
  const all = [];
  const indexPath = path.join(genreDir, '_index.json');
  if (!existsSync(indexPath)) return [];

  // Load main index
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  for (const g of index.genres) {
    all.push({ name: g.name, description: g.description, level: 'main', parent: null });
  }

  // Load main sub-genres
  const mainDir = path.join(genreDir, 'main');
  if (existsSync(mainDir)) {
    for (const file of readDirSafe(mainDir)) {
      try {
        const data = JSON.parse(readFileSync(path.join(mainDir, file), 'utf8'));
        for (const g of (data.genres || data)) {
          if (g.name) all.push({ name: g.name, description: g.description || '', level: 'sub', parent: g.parent || data.parent || null });
        }
      } catch {}
    }
  }

  _genres = all;
  _byName = new Map(all.map(g => [g.name.toLowerCase(), g]));
  return all;
}

function readDirSafe(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

export function searchGenres(query) {
  const genres = loadGenres();
  const q = query.toLowerCase().trim();
  if (!q) return genres.slice(0, 20).map(g => g.name);

  // Score by: exact match > starts with > contains > description contains
  const scored = genres.map(g => {
    const name = g.name.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 50;
    else if (name.includes(q)) score = 25;
    else if ((g.description || '').toLowerCase().includes(q)) score = 10;
    return { ...g, score };
  }).filter(g => g.score > 0).sort((a, b) => b.score - a.score);

  return scored.slice(0, 15).map(g => g.name);
}

export function getGenreDescription(name) {
  loadGenres();
  const g = _byName?.get(name.toLowerCase());
  return g?.description || '';
}

export function getMainGenres() {
  return loadGenres().filter(g => g.level === 'main').map(g => g.name);
}

export function getSubGenres(parentName) {
  return loadGenres().filter(g => g.parent?.toLowerCase() === parentName.toLowerCase()).map(g => g.name);
}

export function getGenreDiscoveryKeywords(profileSummary, limit = 8) {
  const genres = loadGenres();
  if (!genres.length) return [];

  // Match genre names against profile text
  const scored = genres.map(g => {
    const text = (profileSummary || '').toLowerCase();
    let score = 0;
    const name = g.name.toLowerCase();
    if (text.includes(name)) score = 20;
    else if ((g.description || '').toLowerCase().split(/\s+/).some(w => text.includes(w))) score = 10;
    // Boost sub-genres for more specific discovery
    if (g.level === 'sub') score += 5;
    return { name: g.name, score };
  }).filter(g => g.score > 0).sort((a, b) => b.score - a.score);

  return [...new Set(scored.map(g => g.name))].slice(0, limit);
}
