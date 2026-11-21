/**
 * A small OpenStreetMap preview with one pin in the middle (the guide: a free
 * map service, not Google). Drawn from standard map tiles with plain images,
 * so it needs no map package. Used to confirm a map pin ("Is this the right
 * place?") before it is saved.
 */
const TILE = 256;

function project(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function PinMap({ latitude, longitude, zoom = 16, height = 220, label }: { latitude: number; longitude: number; zoom?: number; height?: number; label: string }) {
  const c = project(latitude, longitude, zoom);
  const cx = Math.floor(c.x / TILE);
  const cy = Math.floor(c.y / TILE);
  const max = 2 ** zoom;
  const tiles: { x: number; y: number; left: number; top: number }[] = [];
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const x = cx + dx;
      const y = cy + dy;
      if (y < 0 || y >= max) continue;
      tiles.push({ x: ((x % max) + max) % max, y, left: x * TILE - c.x, top: y * TILE - c.y });
    }
  }
  return (
    <div className="lb-pinmap" style={{ height }} role="img" aria-label={label} data-testid="pin-map">
      <div className="lb-pinmap__centre">
        {tiles.map((t) => (
          <img
            key={`${t.x}-${t.y}-${t.left}`}
            src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`}
            alt=""
            width={TILE}
            height={TILE}
            style={{ left: t.left, top: t.top }}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ))}
        <span className="lb-pinmap__pin" aria-hidden="true">📍</span>
      </div>
      <span className="lb-pinmap__credit">© OpenStreetMap contributors</span>
    </div>
  );
}
