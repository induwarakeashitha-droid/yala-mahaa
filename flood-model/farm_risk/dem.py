# Reads elevations from the validated 12.5 m ALOS DEM for Sri Lanka (44 GeoTIFF tiles, UTM 44N,
# whole metres, nodata -32768). Tiles are ~50 km square and overlap; a few are kept in memory.
import glob
from collections import OrderedDict

import numpy as np
import rasterio

NODATA = -32768
CACHE_TILES = 4   # 4017 x 4017 int16 = 32 MB each


class Dem:
    def __init__(self, folder):
        files = sorted(glob.glob(f'{folder}/*.tif'))
        if not files:
            raise FileNotFoundError(f'no DEM tiles (*.tif) in {folder}')
        self.tiles = []
        for f in files:
            with rasterio.open(f) as r:
                self.tiles.append((f, r.bounds, r.transform, r.shape))
        self.res = abs(self.tiles[0][2].a)
        self._cache = OrderedDict()

    def _tile(self, x, y, margin):
        # the tile that holds (x, y) with the most room around it, so windows rarely run off the edge
        best, room = None, -1.0
        for i, (_, b, _, _) in enumerate(self.tiles):
            m = min(x - b.left, b.right - x, y - b.bottom, b.top - y)
            if m > room:
                best, room = i, m
        if best is None or room < 0:
            return None
        if best not in self._cache:
            if len(self._cache) >= CACHE_TILES:
                self._cache.popitem(last=False)
            with rasterio.open(self.tiles[best][0]) as r:
                self._cache[best] = r.read(1)
        self._cache.move_to_end(best)
        return best

    def window(self, x, y, radius_m):
        """DEM cells within radius_m (a square) of (x, y) as float metres, nan where no data."""
        i = self._tile(x, y, radius_m)
        if i is None:
            return np.empty((0, 0))
        arr, tf = self._cache[i], self.tiles[i][2]
        col, row = ~tf * (x, y)
        k = int(round(radius_m / self.res))
        r0, c0 = int(row) - k, int(col) - k
        w = arr[max(r0, 0):int(row) + k + 1, max(c0, 0):int(col) + k + 1].astype(float)
        w[w <= -1000] = np.nan   # nodata and sea
        return w

    def sample(self, x, y):
        w = self.window(x, y, 0)
        return float(w[0, 0]) if w.size else float('nan')

    def min_near(self, x, y, radius_m):
        w = self.window(x, y, radius_m)
        return float(np.nanmin(w)) if w.size and not np.isnan(w).all() else float('nan')

    def cells(self, x, y, radius_m):
        """(xs, ys, z) of every cell centre in the square window, for polygon sampling."""
        i = self._tile(x, y, radius_m)
        if i is None:
            return np.empty(0), np.empty(0), np.empty(0)
        arr, tf = self._cache[i], self.tiles[i][2]
        col, row = ~tf * (x, y)
        k = int(round(radius_m / self.res))
        r0, r1 = max(int(row) - k, 0), min(int(row) + k + 1, arr.shape[0])
        c0, c1 = max(int(col) - k, 0), min(int(col) + k + 1, arr.shape[1])
        rr, cc = np.mgrid[r0:r1, c0:c1]
        xs, ys = tf * (cc + 0.5, rr + 0.5)
        z = arr[r0:r1, c0:c1].astype(float)
        z[z <= -1000] = np.nan
        return xs.ravel(), ys.ravel(), z.ravel()
