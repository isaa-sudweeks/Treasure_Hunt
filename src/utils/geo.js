const EARTH_RADIUS_MILES = 3958.8;
const MILES_PER_DEGREE_LAT = 69;

export function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

export function boundsToPolygon(bounds, name) {
  return featureCollection([
    {
      type: "Feature",
      properties: { name },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [bounds.west, bounds.south],
            [bounds.east, bounds.south],
            [bounds.east, bounds.north],
            [bounds.west, bounds.north],
            [bounds.west, bounds.south],
          ],
        ],
      },
    },
  ]);
}

export function circleToPolygon(center, radiusMiles, steps = 48) {
  const [lng, lat] = center;
  const coordinates = [];
  const lngFactor = MILES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);

  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const dx = Math.cos(angle) * radiusMiles;
    const dy = Math.sin(angle) * radiusMiles;
    coordinates.push([lng + dx / lngFactor, lat + dy / MILES_PER_DEGREE_LAT]);
  }

  return { type: "Polygon", coordinates: [coordinates] };
}

export function getLineLength(coordinates) {
  return coordinates.reduce((sum, point, index) => {
    if (index === 0) return sum;
    return sum + distanceMiles(coordinates[index - 1], point);
  }, 0);
}

export function getPolygonArea(ring) {
  if (!ring?.length) return 0;
  const lat = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const xFactor = MILES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  const projected = ring.map(([lng, latValue]) => [
    lng * xFactor,
    latValue * MILES_PER_DEGREE_LAT,
  ]);

  let area = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    const [x1, y1] = projected[index];
    const [x2, y2] = projected[index + 1];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function getFeatureCenter(feature) {
  const coordinates =
    feature.geometry.type === "LineString"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates[0];
  const total = coordinates.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
    [0, 0]
  );
  return [total[0] / coordinates.length, total[1] / coordinates.length];
}

export function pointInPolygon(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function lineIntersectsPolygon(line, ring) {
  for (let lineIndex = 0; lineIndex < line.length - 1; lineIndex += 1) {
    for (let ringIndex = 0; ringIndex < ring.length - 1; ringIndex += 1) {
      if (
        segmentsIntersect(
          line[lineIndex],
          line[lineIndex + 1],
          ring[ringIndex],
          ring[ringIndex + 1]
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

export function getLinePolygonCoverageRatio(line, polygons, sampleSpacingMiles = 0.25) {
  const samples = [];

  line.forEach((point, index) => {
    if (index === 0) {
      samples.push(point);
      return;
    }

    const previous = line[index - 1];
    const segmentLength = distanceMiles(previous, point);
    const steps = Math.max(1, Math.ceil(segmentLength / sampleSpacingMiles));

    for (let step = 1; step <= steps; step += 1) {
      const ratio = step / steps;
      samples.push([
        previous[0] + (point[0] - previous[0]) * ratio,
        previous[1] + (point[1] - previous[1]) * ratio,
      ]);
    }
  });

  if (!samples.length) return 0;

  const coveredSamples = samples.filter((point) =>
    polygons.some((polygon) => pointInPolygon(point, polygon.geometry.coordinates[0]))
  ).length;

  return coveredSamples / samples.length;
}

export function formatDistance(miles) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(1)} mi`;
}

export function formatArea(squareMiles) {
  if (squareMiles < 0.01) return `${Math.round(squareMiles * 640)} ac`;
  return `${squareMiles.toFixed(2)} sq mi`;
}

function distanceMiles(a, b) {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const deltaLat = toRadians(b[1] - a[1]);
  const deltaLng = toRadians(b[0] - a[0]);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function segmentsIntersect(a, b, c, d) {
  const denominator = (d[1] - c[1]) * (b[0] - a[0]) - (d[0] - c[0]) * (b[1] - a[1]);
  if (denominator === 0) return false;

  const ua = ((d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0])) / denominator;
  const ub = ((b[0] - a[0]) * (a[1] - c[1]) - (b[1] - a[1]) * (a[0] - c[0])) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}
