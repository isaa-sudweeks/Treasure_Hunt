import { normalizeHeading } from "./geo";

export const silhouetteQualityOptions = {
  preview: {
    label: "Preview",
    bearingStepDegrees: 2,
    distanceStepMiles: 1.25,
    chunkSize: 12,
  },
  balanced: {
    label: "Balanced",
    bearingStepDegrees: 1,
    distanceStepMiles: 0.75,
    chunkSize: 10,
  },
  high: {
    label: "High",
    bearingStepDegrees: 0.5,
    distanceStepMiles: 0.4,
    chunkSize: 8,
  },
  export: {
    label: "Export",
    bearingStepDegrees: 0.25,
    distanceStepMiles: 0.25,
    chunkSize: 6,
  },
};

export function getSilhouetteCacheKey({
  viewpoint,
  headingDegrees,
  fovDegrees,
  maxDistanceMiles,
  quality,
}) {
  return [
    "v4",
    viewpoint[0].toFixed(4),
    viewpoint[1].toFixed(4),
    Math.round(normalizeHeading(headingDegrees)),
    Math.round(fovDegrees),
    Math.round(maxDistanceMiles),
    quality,
  ].join(":");
}

export function createSilhouetteWorker() {
  return new globalThis.Worker(new URL("../workers/silhouette.worker.js", import.meta.url), {
    type: "module",
  });
}

export function filterProfilePoints(points, depthFilter) {
  if (depthFilter === "all") return points;
  if (depthFilter === "foreground") {
    return points.filter((point) => !point.isGap && point.distanceMiles <= 18);
  }
  if (depthFilter === "midground") {
    return points.filter(
      (point) => !point.isGap && point.distanceMiles > 18 && point.distanceMiles <= 45
    );
  }
  if (depthFilter === "background") {
    return points.filter((point) => !point.isGap && point.distanceMiles > 45);
  }
  if (depthFilter === "major") {
    return points.filter((point) => !point.isGap && point.isInteresting);
  }
  return points;
}

export function getDepthColor(distanceMiles, elevationMeters) {
  const elevationBoost = Math.min(Math.max((elevationMeters - 1200) / 2300, 0), 1);
  if (distanceMiles <= 18) {
    return elevationBoost > 0.55 ? "#c85f2d" : "#d9843f";
  }
  if (distanceMiles <= 45) {
    return elevationBoost > 0.55 ? "#397a5f" : "#4f8d67";
  }
  return elevationBoost > 0.55 ? "#4d75b8" : "#6e8ec7";
}

export function getDepthLabel(distanceMiles) {
  if (distanceMiles <= 18) return "Near mountains";
  if (distanceMiles <= 45) return "Mid mountains";
  return "Background";
}
