/* global caches, createImageBitmap, OffscreenCanvas */

const OPENZENITH_TILE_URL = "https://openzenith.cyopsys.com/api/dem-tile";
const OPENZENITH_ELEVATION_URL = "https://openzenith.cyopsys.com/api/elevation";
const TERRAIN_ZOOM = 10;
const TILE_SIZE = 256;
const EARTH_RADIUS_MILES = 3958.8;

const tileCache = new Map();
const memoryElevationCache = new Map();

globalThis.addEventListener("message", (event) => {
  if (event.data?.type !== "build") return;
  buildSilhouette(event.data.payload).catch((error) => {
    globalThis.postMessage({
      type: "error",
      error: error.message || "OpenZenith terrain data is unavailable.",
    });
  });
});

async function buildSilhouette(payload) {
  const {
    viewpoint,
    headingDegrees,
    fovDegrees,
    maxDistanceMiles,
    quality,
    requestId,
  } = payload;
  const bearings = buildBearings(headingDegrees, fovDegrees, quality.bearingStepDegrees);
  const originElevation = await getElevation(viewpoint);
  const profile = [];

  globalThis.postMessage({
    type: "progress",
    requestId,
    originElevation,
    profile,
    progress: 0,
  });

  for (let index = 0; index < bearings.length; index += quality.chunkSize) {
    const chunk = bearings.slice(index, index + quality.chunkSize);
    const chunkPoints = await Promise.all(
      chunk.map((bearingDegrees) =>
        sampleBearing({
          originElevation,
          viewpoint,
          bearingDegrees,
          maxDistanceMiles,
          distanceStepMiles: quality.distanceStepMiles,
        })
      )
    );
    chunkPoints.forEach((point) => {
      point.offsetDegrees = signedDeltaDegrees(point.bearingDegrees, headingDegrees);
    });

    profile.push(...chunkPoints);
    annotateSkylineFeatures(profile);

    globalThis.postMessage({
      type: "progress",
      requestId,
      originElevation,
      profile: [...profile],
      progress: Math.min(profile.length / bearings.length, 1),
    });
  }

  profile.sort((a, b) => a.offsetDegrees - b.offsetDegrees);
  annotateSkylineFeatures(profile);

  globalThis.postMessage({
    type: "complete",
    requestId,
    profile: {
      generatedAt: new Date().toISOString(),
      headingDegrees: normalizeHeading(headingDegrees),
      fovDegrees,
      maxDistanceMiles,
      qualityKey: payload.qualityKey,
      originElevation,
      profile,
    },
  });
}

async function sampleBearing({
  originElevation,
  viewpoint,
  bearingDegrees,
  maxDistanceMiles,
  distanceStepMiles,
}) {
  let visible = null;
  const occluded = [];

  for (
    let distanceMiles = Math.max(0.35, distanceStepMiles);
    distanceMiles <= maxDistanceMiles;
    distanceMiles += distanceStepMiles
  ) {
    const coordinate = projectPoint(viewpoint, bearingDegrees, distanceMiles);
    const elevationMeters = await getElevation(coordinate);
    const angleDegrees = apparentElevationAngle(
      originElevation,
      elevationMeters,
      distanceMiles
    );
    const candidate = {
      angleDegrees,
      bearingDegrees,
      coordinate,
      distanceMiles,
      elevationMeters,
      name: "",
      kind: "ridge",
    };
    const mountainCandidate = isMountainCandidate(candidate, originElevation);
    if (!mountainCandidate) continue;

    if (!visible || candidate.angleDegrees > visible.angleDegrees) {
      if (visible) occluded.push(visible);
      visible = candidate;
    } else if (occluded.length < 6) {
      occluded.push(candidate);
    }
  }

  const result =
    visible ||
    {
      angleDegrees: -2,
      bearingDegrees,
      coordinate: projectPoint(viewpoint, bearingDegrees, maxDistanceMiles),
      distanceMiles: maxDistanceMiles,
      elevationMeters: originElevation,
      isGap: true,
      name: "",
      kind: "gap",
    };
  result.occluded = occluded;
  return result;
}

async function getElevation(coordinate) {
  const tilePoint = coordinateToTilePoint(coordinate, TERRAIN_ZOOM);
  const cacheKey = `${tilePoint.z}/${tilePoint.x}/${tilePoint.y}/${tilePoint.pixelX}/${tilePoint.pixelY}`;
  if (memoryElevationCache.has(cacheKey)) return memoryElevationCache.get(cacheKey);

  try {
    const imageData = await getTileImageData(tilePoint);
    const offset = (tilePoint.pixelY * TILE_SIZE + tilePoint.pixelX) * 4;
    const elevation =
      imageData.data[offset] * 256 +
      imageData.data[offset + 1] +
      imageData.data[offset + 2] / 256 -
      32768;
    memoryElevationCache.set(cacheKey, elevation);
    return elevation;
  } catch {
    const elevation = await fetchPointElevation(coordinate);
    memoryElevationCache.set(cacheKey, elevation);
    return elevation;
  }
}

async function getTileImageData({ z, x, y }) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);

  let response;
  const url = `${OPENZENITH_TILE_URL}/${key}`;
  if ("caches" in globalThis) {
    const cache = await caches.open("treasure-hunt-openzenith-dem-v1");
    response = await cache.match(url);
    if (!response) {
      response = await fetch(url, { mode: "cors" });
      if (response.ok) await cache.put(url, response.clone());
    }
  } else {
    response = await fetch(url, { mode: "cors" });
  }

  if (!response?.ok) {
    throw new Error(`OpenZenith DEM tile failed with ${response?.status || "network"}.`);
  }

  if (!("createImageBitmap" in globalThis) || !("OffscreenCanvas" in globalThis)) {
    throw new Error("DEM tile decoding is not available in this browser.");
  }

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
  const imageData = context.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
  tileCache.set(key, imageData);
  return imageData;
}

async function fetchPointElevation(coordinate) {
  const params = new URLSearchParams({
    lat: coordinate[1].toFixed(6),
    lon: coordinate[0].toFixed(6),
  });
  const response = await fetch(`${OPENZENITH_ELEVATION_URL}?${params}`, {
    mode: "cors",
  });
  if (!response.ok) {
    throw new Error(`OpenZenith elevation failed with ${response.status}.`);
  }
  const data = await response.json();
  if (typeof data.elevation !== "number") {
    throw new Error("OpenZenith did not return an elevation value.");
  }
  return data.elevation;
}

function isMountainCandidate(candidate, originElevation) {
  const elevationRise = candidate.elevationMeters - originElevation;
  const highTerrain = candidate.elevationMeters >= 1800;
  const risingTerrain = elevationRise >= 220;
  const veryDistantTerrain = candidate.distanceMiles >= 35 && candidate.elevationMeters >= 1650;
  return highTerrain || risingTerrain || veryDistantTerrain;
}

function buildBearings(headingDegrees, fovDegrees, stepDegrees) {
  const start = headingDegrees - fovDegrees / 2;
  const count = Math.floor(fovDegrees / stepDegrees) + 1;
  return Array.from({ length: count }, (_, index) => normalizeHeading(start + index * stepDegrees));
}

function annotateSkylineFeatures(profile) {
  if (profile.length < 3) {
    profile.forEach((point) => {
      point.prominenceScore = 0.2;
      point.isInteresting = false;
      point.featureLabel = "";
    });
    return;
  }

  profile.sort((a, b) => a.offsetDegrees - b.offsetDegrees);
  const angles = profile.map((point) => point.angleDegrees);
  const maxAngle = Math.max(...angles);
  const minAngle = Math.min(...angles);
  const range = Math.max(maxAngle - minAngle, 0.1);
  const mountainPoints = profile.filter((point) => !point.isGap);
  const maxElevation = mountainPoints.length
    ? Math.max(...mountainPoints.map((point) => point.elevationMeters))
    : 0;

  profile.forEach((point, index) => {
    if (point.isGap) {
      point.prominenceScore = 0;
      point.isInteresting = false;
      point.featureLabel = "";
      return;
    }

    const nearLeft = profile[Math.max(0, index - 2)].angleDegrees;
    const nearRight = profile[Math.min(profile.length - 1, index + 2)].angleDegrees;
    const farLeft = profile[Math.max(0, index - 6)].angleDegrees;
    const farRight = profile[Math.min(profile.length - 1, index + 6)].angleDegrees;
    const localRelief = Math.max(point.angleDegrees - Math.min(nearLeft, nearRight), 0);
    const broaderRelief = Math.max(point.angleDegrees - Math.min(farLeft, farRight), 0);
    const isLocalSummit =
      index > 0 &&
      index < profile.length - 1 &&
      point.angleDegrees >= profile[index - 1].angleDegrees &&
      point.angleDegrees >= profile[index + 1].angleDegrees &&
      broaderRelief >= Math.max(0.18, range * 0.08);
    const isHighRidge =
      point.elevationMeters >= maxElevation - 90 &&
      point.angleDegrees >= minAngle + range * 0.55 &&
      broaderRelief >= Math.max(0.12, range * 0.04);

    point.prominenceScore = Math.min(
      1,
      localRelief / range + broaderRelief / range + Math.max(point.angleDegrees, 0) / 45
    );
    point.isInteresting = isLocalSummit || isHighRidge;
    point.featureLabel = isLocalSummit ? "Skyline peak" : isHighRidge ? "High ridge" : "";
  });

  suppressCrowdedFeatures(profile);
}

function suppressCrowdedFeatures(profile) {
  const interesting = profile
    .filter((point) => point.isInteresting)
    .sort((a, b) => b.prominenceScore - a.prominenceScore);
  const accepted = [];

  interesting.forEach((point) => {
    const tooClose = accepted.some(
      (acceptedPoint) =>
        Math.abs(acceptedPoint.offsetDegrees - point.offsetDegrees) < 4 ||
        Math.abs(acceptedPoint.bearingDegrees - point.bearingDegrees) < 4
    );
    if (!tooClose && accepted.length < 12) {
      accepted.push(point);
      return;
    }
    point.isInteresting = false;
    point.featureLabel = "";
  });
}

function coordinateToTilePoint(coordinate, z) {
  const [lng, lat] = coordinate;
  const scale = 2 ** z;
  const xFloat = ((lng + 180) / 360) * scale;
  const latRad = toRadians(lat);
  const yFloat =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  const x = clamp(Math.floor(xFloat), 0, scale - 1);
  const y = clamp(Math.floor(yFloat), 0, scale - 1);
  return {
    z,
    x,
    y,
    pixelX: clamp(Math.floor((xFloat - x) * TILE_SIZE), 0, TILE_SIZE - 1),
    pixelY: clamp(Math.floor((yFloat - y) * TILE_SIZE), 0, TILE_SIZE - 1),
  };
}

function projectPoint(origin, bearingDegrees, distanceInMiles) {
  const [lng, lat] = origin;
  const angularDistance = distanceInMiles / EARTH_RADIUS_MILES;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(lat);
  const lng1 = toRadians(lng);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [toDegrees(lng2), toDegrees(lat2)];
}

function apparentElevationAngle(originElevationMeters, targetElevationMeters, distanceInMiles) {
  const runMeters = Math.max(distanceInMiles * 1609.344, 1);
  return toDegrees(Math.atan2(targetElevationMeters - originElevationMeters, runMeters));
}

function normalizeHeading(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function signedDeltaDegrees(value, origin) {
  return ((((value - origin) % 360) + 540) % 360) - 180;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}
