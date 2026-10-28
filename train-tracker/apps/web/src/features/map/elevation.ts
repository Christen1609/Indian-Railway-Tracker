export const TERRAIN_TILES_URL = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';

type DemTile = { size: number; rgba: Uint8ClampedArray };

const SAMPLE_ZOOM = 11;
const RAD = Math.PI / 180;
const tiles = new Map<string, Promise<DemTile | null>>();

/** A terrain tile decoded to pixels, or null when it did not load */
function loadTile(x: number, y: number): Promise<DemTile | null> {
  const key = `${x}/${y}`;
  const cached = tiles.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const url = TERRAIN_TILES_URL.replace('{z}', String(SAMPLE_ZOOM))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
  const loading = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Terrain tile ${key} returned ${response.status}.`);
      }
      return response.blob();
    })
    .then(createImageBitmap)
    .then((image) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context === null) {
        return null;
      }
      context.drawImage(image, 0, 0);
      return {
        size: image.width,
        rgba: context.getImageData(0, 0, image.width, image.height).data,
      };
    })
    .catch(() => {
      tiles.delete(key);
      return null;
    });
  tiles.set(key, loading);
  return loading;
}

/** Ground height in metres above sea level, or null when the terrain tile is missing */
export async function groundHeightM(lon: number, lat: number): Promise<number | null> {
  const count = 2 ** SAMPLE_ZOOM;
  const tileX = ((lon + 180) / 360) * count;
  const tileY =
    ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * count;
  const tile = await loadTile(Math.floor(tileX), Math.floor(tileY)); // decoded tile, from loadTile
  if (tile === null) {
    return null;
  }
  const column = Math.min(tile.size - 1, Math.floor((tileX % 1) * tile.size));
  const row = Math.min(tile.size - 1, Math.floor((tileY % 1) * tile.size));
  const at = (row * tile.size + column) * 4;
  const [red = 0, green = 0, blue = 0] = tile.rgba.slice(at, at + 3);
  return red * 256 + green + blue / 256 - 32768;
}
