export const cellCoverageMeta = {
  carrier: "T-Mobile",
  label: "Reliable T-Mobile service",
  minimumTrailCoverage: 0.6,
  note:
    "Planning approximation from T-Mobile's public coverage map: reliable outdoor service is modeled around Wasatch Front valleys and primary travel corridors.",
};

export const tmobileReliableCoverage = [
  {
    id: "tmobile-wasatch-front-corridor",
    type: "Feature",
    properties: {
      name: "Wasatch Front valley corridor",
      carrier: "T-Mobile",
      reliability: "reliable",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-112.19, 40.04],
          [-111.66, 40.04],
          [-111.58, 40.16],
          [-111.62, 40.33],
          [-111.72, 40.48],
          [-111.75, 40.69],
          [-111.81, 40.9],
          [-111.84, 41.18],
          [-111.89, 41.34],
          [-112.15, 41.34],
          [-112.21, 40.88],
          [-112.23, 40.43],
          [-112.19, 40.04],
        ],
      ],
    },
  },
  {
    id: "tmobile-park-city-heber",
    type: "Feature",
    properties: {
      name: "Park City and Heber corridor",
      carrier: "T-Mobile",
      reliability: "reliable",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.66, 40.33],
          [-111.28, 40.33],
          [-111.27, 40.76],
          [-111.48, 40.81],
          [-111.65, 40.7],
          [-111.66, 40.33],
        ],
      ],
    },
  },
  {
    id: "tmobile-ogden-morgan-corridor",
    type: "Feature",
    properties: {
      name: "Ogden, Morgan, and I-84 corridor",
      carrier: "T-Mobile",
      reliability: "reliable",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.98, 40.86],
          [-111.47, 40.86],
          [-111.45, 41.12],
          [-111.76, 41.2],
          [-111.98, 41.12],
          [-111.98, 40.86],
        ],
      ],
    },
  },
  {
    id: "tmobile-provo-canyon",
    type: "Feature",
    properties: {
      name: "Provo Canyon and Orem bench",
      carrier: "T-Mobile",
      reliability: "reliable",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.78, 40.23],
          [-111.43, 40.23],
          [-111.43, 40.43],
          [-111.58, 40.5],
          [-111.74, 40.43],
          [-111.78, 40.23],
        ],
      ],
    },
  },
];
