export const protectedAreasMeta = {
  note:
    "Approximate local polygons for explicitly named Utah state parks and national park units in the hunt boundary.",
};

export const protectedAreas = [
  {
    id: "state-park-antelope-island",
    type: "Feature",
    properties: {
      name: "Antelope Island State Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-112.33, 41.12],
          [-112.19, 41.12],
          [-112.18, 40.92],
          [-112.27, 40.87],
          [-112.36, 40.96],
          [-112.33, 41.12],
        ],
      ],
    },
  },
  {
    id: "state-park-great-salt-lake",
    type: "Feature",
    properties: {
      name: "Great Salt Lake State Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-112.23, 40.77],
          [-112.14, 40.77],
          [-112.14, 40.71],
          [-112.23, 40.71],
          [-112.23, 40.77],
        ],
      ],
    },
  },
  {
    id: "state-park-utah-lake",
    type: "Feature",
    properties: {
      name: "Utah Lake State Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.83, 40.26],
          [-111.75, 40.26],
          [-111.75, 40.20],
          [-111.83, 40.20],
          [-111.83, 40.26],
        ],
      ],
    },
  },
  {
    id: "state-park-camp-floyd",
    type: "Feature",
    properties: {
      name: "Camp Floyd State Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-112.10, 40.28],
          [-112.06, 40.28],
          [-112.06, 40.25],
          [-112.10, 40.25],
          [-112.10, 40.28],
        ],
      ],
    },
  },
  {
    id: "state-park-wasatch-mountain",
    type: "Feature",
    properties: {
      name: "Wasatch Mountain State Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.55, 40.58],
          [-111.42, 40.58],
          [-111.40, 40.45],
          [-111.50, 40.40],
          [-111.60, 40.47],
          [-111.55, 40.58],
        ],
      ],
    },
  },
  {
    id: "state-park-deer-creek",
    type: "Feature",
    properties: {
      name: "Deer Creek State Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.55, 40.45],
          [-111.45, 40.45],
          [-111.44, 40.36],
          [-111.53, 40.32],
          [-111.59, 40.38],
          [-111.55, 40.45],
        ],
      ],
    },
  },
  {
    id: "state-park-this-is-the-place",
    type: "Feature",
    properties: {
      name: "This Is The Place Heritage Park",
      designation: "State Park",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.84, 40.77],
          [-111.80, 40.77],
          [-111.80, 40.74],
          [-111.84, 40.74],
          [-111.84, 40.77],
        ],
      ],
    },
  },
  {
    id: "national-monument-timpanogos-cave",
    type: "Feature",
    properties: {
      name: "Timpanogos Cave National Monument",
      designation: "National Park Unit",
    },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-111.73, 40.46],
          [-111.68, 40.46],
          [-111.68, 40.42],
          [-111.73, 40.42],
          [-111.73, 40.46],
        ],
      ],
    },
  },
];
