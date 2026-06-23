export function getTrackNeteaseSongId(track = {}) {
  const candidates = [
    track?.originalId,
    track?.songId,
    track?.neteaseId,
    track?.id
  ];

  for (const value of candidates) {
    const id = String(value || '').trim();
    if (/^\d+$/.test(id)) return id;
  }
  return '';
}
