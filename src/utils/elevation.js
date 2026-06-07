import {
  apparentElevationAngle,
  normalizeHeading,
  projectPoint,
} from "./geo";

const ELEVATION_ENDPOINT = "https://api.open-meteo.com/v1/elevation";
const FOV_DEGREES = 80;
const RAY_STEP_DEGREES = 4;
const REQUEST_CHUNK_SIZE = 90;
const CHUNK_DELAY_MS = 1150;

const distanceSamples = [
  ...Array.from({ length: 10 }, (_, index) => 0.5 + index * 0.5),
  7,
  10,
  14,
  18,
  23,
  30,
];

export function getSilhouetteCacheKey(viewpoint, headingDegrees) {
  return [
    viewpoint[0].toFixed(4),
    viewpoint[1].toFixed(4),
    Math.round(normalizeHeading(headingDegrees)),
  ].join(":");
}

export async function buildSilhouetteProfile(viewpoint, headingDegrees, signal) {
  const rays = buildSampleRays(viewpoint, headingDegrees);
  const locations = [
    { coordinate: viewpoint, meta: { kind: "origin" } },
    ...rays.flatMap((ray, rayIndex) =>
      ray.samples.map((sample, sampleIndex) => ({
        coordinate: sample.coordinate,
        meta: { kind: "sample", rayIndex, sampleIndex },
      }))
    ),
  ];
  const results = await fetchElevationChunks(locations, signal);
  const originElevation = results[0]?.elevation;

  if (originElevation == null) {
    throw new Error("OpenTopoData did not return elevation for the selected point.");
  }

  const profile = rays.map((ray) => {
    const visible = ray.samples.reduce(
      (highest, sample) => {
        const elevation = results[sample.resultIndex]?.elevation;
        if (elevation == null) return highest;
        const angle = apparentElevationAngle(originElevation, elevation, sample.distanceMiles);
        if (!highest || angle > highest.angleDegrees) {
          return {
            angleDegrees: angle,
            bearingDegrees: ray.bearingDegrees,
            distanceMiles: sample.distanceMiles,
            elevationMeters: elevation,
          };
        }
        return highest;
      },
      null
    );

    return (
      visible || {
        angleDegrees: 0,
        bearingDegrees: ray.bearingDegrees,
        distanceMiles: 0,
        elevationMeters: originElevation,
      }
    );
  });

  return {
    generatedAt: new Date().toISOString(),
    headingDegrees: normalizeHeading(headingDegrees),
    originElevation,
    profile,
  };
}

function buildSampleRays(viewpoint, headingDegrees) {
  const startBearing = headingDegrees - FOV_DEGREES / 2;
  let resultIndex = 1;
  return Array.from({ length: FOV_DEGREES / RAY_STEP_DEGREES + 1 }, (_, index) => {
    const bearingDegrees = normalizeHeading(startBearing + index * RAY_STEP_DEGREES);
    const samples = distanceSamples.map((distanceMiles) => ({
      coordinate: projectPoint(viewpoint, bearingDegrees, distanceMiles),
      distanceMiles,
      resultIndex: resultIndex++,
    }));
    return { bearingDegrees, samples };
  });
}

async function fetchElevationChunks(locations, signal) {
  const results = [];

  for (let index = 0; index < locations.length; index += REQUEST_CHUNK_SIZE) {
    const chunk = locations.slice(index, index + REQUEST_CHUNK_SIZE);
    const params = new URLSearchParams({
      latitude: chunk.map(({ coordinate }) => coordinate[1].toFixed(6)).join(","),
      longitude: chunk.map(({ coordinate }) => coordinate[0].toFixed(6)).join(","),
    });
    const response = await fetch(`${ELEVATION_ENDPOINT}?${params}`, { signal });

    if (!response.ok) {
      throw new Error(`Open-Meteo elevation request failed with ${response.status}.`);
    }

    const parsed = await response.json();
    if (parsed.error) {
      throw new Error(parsed.reason || "Open-Meteo could not build the skyline profile.");
    }

    results.push(
      ...parsed.elevation.map((elevation, resultIndex) => ({
        elevation,
        location: {
          lat: chunk[resultIndex].coordinate[1],
          lng: chunk[resultIndex].coordinate[0],
        },
      }))
    );

    if (index + REQUEST_CHUNK_SIZE < locations.length) {
      await delay(CHUNK_DELAY_MS, signal);
    }
  }

  return results;
}

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        const error = new Error("Request aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true }
    );
  });
}
