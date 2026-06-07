import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { huntRegion } from "./data/huntRegion";
import { regionTrails } from "./data/regionTrails";
import { defaultClues } from "./data/defaultClues";
import { cellCoverageMeta, tmobileReliableCoverage } from "./data/cellCoverage";
import { protectedAreas, protectedAreasMeta } from "./data/protectedAreas";
import {
  boundsToPolygon,
  circleToPolygon,
  featureCollection,
  formatArea,
  formatDistance,
  getFeatureCenter,
  getLineLength,
  getLinePolygonCoverageRatio,
  getPolygonArea,
  lineIntersectsPolygon,
  normalizeHeading,
  pointInPolygon,
  projectPoint,
} from "./utils/geo";
import { buildSilhouetteProfile, getSilhouetteCacheKey } from "./utils/elevation";
import { useLocalStorage } from "./hooks/useLocalStorage";
import "./styles.css";

const STORAGE_KEYS = {
  exclusions: "treasure-hunt.exclusions.v1",
  clues: "treasure-hunt.clues.v1",
  filters: "treasure-hunt.filters.v1",
};

const blankFilters = {
  sources: { OSM: true },
  types: { hike: true, bike: true, service: true, overlook: true },
  hideRuledOut: false,
  cellService: {
    showLayer: false,
    requireReliable: false,
  },
  protectedAreas: {
    showLayer: true,
    excludeParks: false,
  },
};

const sourceColors = {
  OSM: "#2f7d5b",
  Agency: "#b07324",
};
const EMPTY_PROFILE_POINTS = [];

function normalizeFilters(savedFilters) {
  return {
    ...blankFilters,
    ...savedFilters,
    sources: { ...blankFilters.sources, ...savedFilters?.sources },
    types: { ...blankFilters.types, ...savedFilters?.types },
    cellService: {
      ...blankFilters.cellService,
      ...savedFilters?.cellService,
    },
    protectedAreas: {
      ...blankFilters.protectedAreas,
      ...savedFilters?.protectedAreas,
    },
  };
}

function App() {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const fileInputRef = useRef(null);
  const silhouetteCacheRef = useRef(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [activeTool, setActiveTool] = useState("inspect");
  const [draftPoints, setDraftPoints] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [viewpoint, setViewpoint] = useState(null);
  const [viewHeadingDegrees, setViewHeadingDegrees] = useState(90);
  const [silhouetteStatus, setSilhouetteStatus] = useState("idle");
  const [silhouetteProfile, setSilhouetteProfile] = useState(null);
  const [silhouetteError, setSilhouetteError] = useState("");
  const [exclusions, setExclusions] = useLocalStorage(
    STORAGE_KEYS.exclusions,
    []
  );
  const [clues, setClues] = useLocalStorage(STORAGE_KEYS.clues, defaultClues);
  const [savedFilters, setSavedFilters] = useLocalStorage(STORAGE_KEYS.filters, blankFilters);
  const filters = useMemo(() => normalizeFilters(savedFilters), [savedFilters]);

  const huntBoundary = useMemo(
    () => boundsToPolygon(huntRegion.bounds, huntRegion.name),
    []
  );

  const cellCoverage = useMemo(
    () => featureCollection(tmobileReliableCoverage),
    []
  );

  const protectedAreaCollection = useMemo(
    () => featureCollection(protectedAreas),
    []
  );

  const enrichedTrails = useMemo(() => {
    return regionTrails.map((trail) => {
      const length = getLineLength(trail.geometry.coordinates);
      const center = getFeatureCenter(trail);
      const ruledOut = exclusions.some((exclusion) =>
        trailIntersectsExclusion(trail, exclusion)
      );
      const cellCoverageRatio = getLinePolygonCoverageRatio(
        trail.geometry.coordinates,
        tmobileReliableCoverage
      );
      const hasReliableCellService =
        cellCoverageRatio >= cellCoverageMeta.minimumTrailCoverage;
      const intersectsProtectedArea = protectedAreas.some((area) =>
        trailIntersectsExclusion(trail, area)
      );
      return {
        ...trail,
        length,
        center,
        ruledOut,
        cellCoverageRatio,
        hasReliableCellService,
        intersectsProtectedArea,
      };
    });
  }, [exclusions]);

  const filteredTrails = useMemo(() => {
    return enrichedTrails.filter((trail) => {
      if (!filters.sources[trail.properties.source]) return false;
      if (!filters.types[trail.properties.type]) return false;
      if (filters.hideRuledOut && trail.ruledOut) return false;
      if (filters.cellService.requireReliable && !trail.hasReliableCellService) {
        return false;
      }
      if (filters.protectedAreas.excludeParks && trail.intersectsProtectedArea) {
        return false;
      }
      return true;
    });
  }, [enrichedTrails, filters]);

  const selectedFeature = useMemo(() => {
    return (
      exclusions.find((item) => item.id === selectedId) ||
      enrichedTrails.find((item) => item.id === selectedId) ||
      null
    );
  }, [selectedId, exclusions, enrichedTrails]);

  const stats = useMemo(() => {
    const excludedArea = exclusions.reduce(
      (sum, item) => sum + getPolygonArea(item.geometry.coordinates[0]),
      0
    );
    const ruledOutTrails = enrichedTrails.filter((trail) => trail.ruledOut).length;
    const noCellTrails = enrichedTrails.filter(
      (trail) => !trail.hasReliableCellService
    ).length;
    const unresolvedClues = clues.filter((clue) => clue.status === "unresolved").length;
    return {
      trails: filteredTrails.length,
      excludedArea,
      remaining: Math.max(enrichedTrails.length - ruledOutTrails, 0),
      reliableCell: Math.max(enrichedTrails.length - noCellTrails, 0),
      unresolvedClues,
    };
  }, [clues, enrichedTrails, exclusions, filteredTrails.length]);

  const addExclusion = useCallback(
    (geometry, fallbackTitle = "Ruled-out area") => {
      const nextNumber = exclusions.length + 1;
      const exclusion = {
        id: `exclusion-${Date.now()}`,
        type: "Feature",
        geometry,
        title: `${fallbackTitle} ${nextNumber}`,
        reason: "",
        confidence: "medium",
        createdAt: new Date().toISOString(),
        linkedClueIds: [],
        properties: {},
      };
      setExclusions((current) => [exclusion, ...current]);
      setSelectedId(exclusion.id);
    },
    [exclusions.length, setExclusions]
  );

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      center: huntRegion.center,
      zoom: huntRegion.zoom,
      minZoom: 8,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("hunt-region", { type: "geojson", data: huntBoundary });
      map.addLayer({
        id: "hunt-region-fill",
        type: "fill",
        source: "hunt-region",
        paint: { "fill-color": "#3b7a57", "fill-opacity": 0.08 },
      });
      map.addLayer({
        id: "hunt-region-line",
        type: "line",
        source: "hunt-region",
        paint: {
          "line-color": "#24513c",
          "line-width": 2,
          "line-dasharray": [2, 1.2],
        },
      });

      map.addSource("trails", { type: "geojson", data: featureCollection([]) });
      map.addLayer({
        id: "trails-line",
        type: "line",
        source: "trails",
        paint: {
          "line-color": ["get", "lineColor"],
          "line-width": ["case", ["get", "ruledOut"], 2, 3],
          "line-opacity": ["case", ["get", "ruledOut"], 0.28, 0.88],
        },
      });
      map.addLayer({
        id: "trails-hit",
        type: "line",
        source: "trails",
        paint: { "line-color": "#000000", "line-width": 14, "line-opacity": 0 },
      });

      map.addSource("cell-coverage", { type: "geojson", data: cellCoverage });
      map.addLayer(
        {
          id: "cell-coverage-fill",
          type: "fill",
          source: "cell-coverage",
          layout: { visibility: "none" },
          paint: { "fill-color": "#d23bbf", "fill-opacity": 0.16 },
        },
        "trails-line"
      );
      map.addLayer(
        {
          id: "cell-coverage-line",
          type: "line",
          source: "cell-coverage",
          layout: { visibility: "none" },
          paint: {
            "line-color": "#9d2590",
            "line-width": 2,
            "line-dasharray": [1.3, 1],
          },
        },
        "trails-line"
      );

      map.addSource("protected-areas", { type: "geojson", data: protectedAreaCollection });
      map.addLayer(
        {
          id: "protected-areas-fill",
          type: "fill",
          source: "protected-areas",
          layout: { visibility: "visible" },
          paint: { "fill-color": "#6d64b8", "fill-opacity": 0.13 },
        },
        "trails-line"
      );
      map.addLayer(
        {
          id: "protected-areas-line",
          type: "line",
          source: "protected-areas",
          layout: { visibility: "visible" },
          paint: {
            "line-color": "#4d4695",
            "line-width": 2,
            "line-dasharray": [1, 0.8],
          },
        },
        "trails-line"
      );

      map.addSource("exclusions", { type: "geojson", data: featureCollection([]) });
      map.addLayer({
        id: "exclusions-fill",
        type: "fill",
        source: "exclusions",
        paint: { "fill-color": "#d65445", "fill-opacity": 0.27 },
      });
      map.addLayer({
        id: "exclusions-line",
        type: "line",
        source: "exclusions",
        paint: { "line-color": "#a83428", "line-width": 2 },
      });
      map.addLayer({
        id: "exclusions-label",
        type: "symbol",
        source: "exclusions",
        layout: {
          "text-field": ["get", "title"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-offset": [0, 0],
        },
        paint: {
          "text-color": "#68231e",
          "text-halo-color": "#fff8f2",
          "text-halo-width": 1.5,
        },
      });

      map.addSource("draft", { type: "geojson", data: featureCollection([]) });
      map.addLayer({
        id: "draft-line",
        type: "line",
        source: "draft",
        paint: { "line-color": "#1f6feb", "line-width": 2, "line-dasharray": [1, 1] },
      });
      map.addLayer({
        id: "draft-points",
        type: "circle",
        source: "draft",
        paint: {
          "circle-radius": 5,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#1f6feb",
          "circle-stroke-width": 2,
        },
      });

      map.addSource("mountain-view", { type: "geojson", data: featureCollection([]) });
      map.addLayer({
        id: "mountain-view-heading",
        type: "line",
        source: "mountain-view",
        paint: {
          "line-color": "#1f3f72",
          "line-width": 3,
          "line-dasharray": [1.4, 0.8],
        },
      });
      map.addLayer({
        id: "mountain-view-point",
        type: "circle",
        source: "mountain-view",
        paint: {
          "circle-radius": 7,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#1f3f72",
          "circle-stroke-width": 3,
        },
      });

      map.on("click", "trails-hit", (event) => {
        const feature = event.features?.[0];
        if (feature?.properties?.id) {
          setSelectedId(feature.properties.id);
        }
      });

      map.on("click", "exclusions-fill", (event) => {
        const feature = event.features?.[0];
        if (feature?.properties?.id) {
          setSelectedId(feature.properties.id);
        }
      });

      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [cellCoverage, huntBoundary, protectedAreaCollection]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current.getSource("trails");
    source?.setData(
      featureCollection(
        filteredTrails.map((trail) => ({
          ...trail,
          properties: {
            ...trail.properties,
            id: trail.id,
            lineColor: sourceColors[trail.properties.source],
            ruledOut: trail.ruledOut,
            hasReliableCellService: trail.hasReliableCellService,
          },
        }))
      )
    );
  }, [filteredTrails, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const visibility = filters.cellService.showLayer ? "visible" : "none";
    mapRef.current.setLayoutProperty("cell-coverage-fill", "visibility", visibility);
    mapRef.current.setLayoutProperty("cell-coverage-line", "visibility", visibility);
  }, [filters.cellService.showLayer, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const visibility = filters.protectedAreas.showLayer ? "visible" : "none";
    mapRef.current.setLayoutProperty("protected-areas-fill", "visibility", visibility);
    mapRef.current.setLayoutProperty("protected-areas-line", "visibility", visibility);
  }, [filters.protectedAreas.showLayer, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current.getSource("exclusions");
    source?.setData(
      featureCollection(
        exclusions.map((item) => ({
          ...item,
          properties: {
            id: item.id,
            title: item.title,
            confidence: item.confidence,
            reason: item.reason,
          },
        }))
      )
    );
  }, [exclusions, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current.getSource("draft");
    if (!draftPoints.length) {
      source?.setData(featureCollection([]));
      return;
    }
    source?.setData(
      featureCollection([
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: draftPoints },
        },
        ...draftPoints.map((point) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: point },
        })),
      ])
    );
  }, [draftPoints, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const source = mapRef.current.getSource("mountain-view");
    if (!viewpoint) {
      source?.setData(featureCollection([]));
      return;
    }

    source?.setData(
      featureCollection([
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              viewpoint,
              projectPoint(viewpoint, viewHeadingDegrees, 3),
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: viewpoint },
        },
      ])
    );
  }, [mapReady, viewHeadingDegrees, viewpoint]);

  useEffect(() => {
    if (!viewpoint) {
      setSilhouetteStatus("idle");
      setSilhouetteProfile(null);
      setSilhouetteError("");
      return undefined;
    }

    const cacheKey = getSilhouetteCacheKey(viewpoint, viewHeadingDegrees);
    const cached = silhouetteCacheRef.current.get(cacheKey);
    if (cached) {
      setSilhouetteProfile(cached);
      setSilhouetteStatus("ready");
      setSilhouetteError("");
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSilhouetteStatus("loading");
      setSilhouetteError("");
      buildSilhouetteProfile(viewpoint, viewHeadingDegrees, controller.signal)
        .then((profile) => {
          silhouetteCacheRef.current.set(cacheKey, profile);
          setSilhouetteProfile(profile);
          setSilhouetteStatus("ready");
        })
        .catch((error) => {
          if (error.name === "AbortError") return;
          setSilhouetteProfile(null);
          setSilhouetteStatus("error");
          setSilhouetteError(error.message);
        });
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [viewHeadingDegrees, viewpoint]);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    const handleMapClick = (event) => {
      const point = [event.lngLat.lng, event.lngLat.lat];
      if (activeTool === "marker") {
        addExclusion(circleToPolygon(point, 0.08, 28), "Marker exclusion");
        setActiveTool("inspect");
      }
      if (activeTool === "circle") {
        addExclusion(circleToPolygon(point, 0.45, 64), "Circle exclusion");
        setActiveTool("inspect");
      }
      if (activeTool === "polygon") {
        setDraftPoints((current) => [...current, point]);
      }
      if (activeTool === "mountain") {
        setViewpoint(point);
        setSilhouetteStatus("loading");
        setSilhouetteProfile(null);
        setSilhouetteError("");
        map.easeTo({ center: point, duration: 500 });
      }
    };
    map.on("click", handleMapClick);
    return () => map.off("click", handleMapClick);
  }, [activeTool, addExclusion, mapReady]);

  const finishPolygon = () => {
    if (draftPoints.length < 3) return;
    addExclusion(
      {
        type: "Polygon",
        coordinates: [[...draftPoints, draftPoints[0]]],
      },
      "Polygon exclusion"
    );
    setDraftPoints([]);
    setActiveTool("inspect");
  };

  const clearDraft = () => setDraftPoints([]);

  const updateExclusion = (id, patch) => {
    setExclusions((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const removeExclusion = (id) => {
    setExclusions((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const updateClue = (id, patch) => {
    setClues((current) =>
      current.map((clue) => (clue.id === id ? { ...clue, ...patch } : clue))
    );
  };

  const exportGeoJson = () => {
    const blob = new Blob([JSON.stringify(featureCollection(exclusions), null, 2)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "treasure-hunt-exclusions.geojson";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importGeoJson = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        const features = parsed.type === "FeatureCollection" ? parsed.features : [parsed];
        const imported = features
          .filter((feature) => feature.geometry?.type === "Polygon")
          .map((feature, index) => ({
            ...feature,
            id: feature.properties?.id || `imported-${Date.now()}-${index}`,
            title: feature.properties?.title || `Imported exclusion ${index + 1}`,
            reason: feature.properties?.reason || "",
            confidence: feature.properties?.confidence || "medium",
            createdAt: feature.properties?.createdAt || new Date().toISOString(),
            linkedClueIds: feature.properties?.linkedClueIds || [],
          }));
        setExclusions((current) => [...imported, ...current]);
      } catch {
        window.alert("That file is not valid GeoJSON.");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="brand-block">
          <div>
            <p className="eyeline">Local-first search board</p>
            <h1>Treasure Hunt Dashboard</h1>
          </div>
          <span className="privacy-chip">Private in browser</span>
        </header>

        <section className="metric-grid" aria-label="Search summary">
          <Metric label="Visible trails" value={stats.trails} />
          <Metric label="Excluded area" value={formatArea(stats.excludedArea)} />
          <Metric label="Candidates" value={stats.remaining} />
          <Metric label="Cell service" value={stats.reliableCell} />
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Rule-Out Areas</h2>
            <span>{exclusions.length}</span>
          </div>
          <div className="button-row">
            <button type="button" onClick={exportGeoJson} disabled={!exclusions.length}>
              Export
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Import
            </button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              onChange={importGeoJson}
            />
          </div>
          <div className="scroll-list">
            {exclusions.length ? (
              exclusions.map((item) => (
                <ExclusionRow
                  key={item.id}
                  exclusion={item}
                  selected={selectedId === item.id}
                  onSelect={() => setSelectedId(item.id)}
                  onChange={(patch) => updateExclusion(item.id, patch)}
                  onDelete={() => removeExclusion(item.id)}
                />
              ))
            ) : (
              <p className="empty-state">
                Draw a polygon, circle, or marker on the map to start ruling out
                places.
              </p>
            )}
          </div>
        </section>

        <section className="panel clue-panel">
          <div className="panel-heading">
            <h2>Clue Workspace</h2>
            <span>{clues.length}</span>
          </div>
          <div className="scroll-list">
            {clues.map((clue, index) => (
              <ClueRow
                key={clue.id}
                clue={clue}
                index={index + 1}
                onChange={(patch) => updateClue(clue.id, patch)}
              />
            ))}
          </div>
        </section>
      </aside>

      <main className="map-workspace">
        <div className="topbar">
          <div>
            <p>{huntRegion.name}</p>
            <strong>Rule out known misses, then inspect remaining trail candidates.</strong>
          </div>
          <div className="tool-group" aria-label="Map drawing tools">
            <ToolButton
              active={activeTool === "inspect"}
              label="Inspect"
              onClick={() => {
                setActiveTool("inspect");
                clearDraft();
              }}
            />
            <ToolButton
              active={activeTool === "polygon"}
              label="Polygon"
              onClick={() => setActiveTool("polygon")}
            />
            <ToolButton
              active={activeTool === "circle"}
              label="Circle"
              onClick={() => setActiveTool("circle")}
            />
            <ToolButton
              active={activeTool === "marker"}
              label="Marker"
              onClick={() => setActiveTool("marker")}
            />
            <ToolButton
              active={activeTool === "mountain"}
              label="Mountain View"
              onClick={() => {
                setActiveTool("mountain");
                clearDraft();
              }}
            />
          </div>
        </div>

        <div className="map-stage">
          <div ref={mapContainerRef} className="map-container" />
          <div className="map-floating legend">
            <span><i className="legend-swatch region" /> Hunt region</span>
            <span><i className="legend-swatch osm" /> OSM trails</span>
            <span><i className="legend-swatch agency" /> Agency trails</span>
            {filters.cellService.showLayer && (
              <span><i className="legend-swatch cell" /> T-Mobile service</span>
            )}
            {filters.protectedAreas.showLayer && (
              <span><i className="legend-swatch protected" /> State/national parks</span>
            )}
            <span><i className="legend-swatch excluded" /> Ruled out</span>
          </div>
          {activeTool === "polygon" && (
            <div className="map-floating draw-help">
              <strong>Polygon drawing</strong>
              <span>{draftPoints.length} point{draftPoints.length === 1 ? "" : "s"} placed</span>
              <button type="button" onClick={finishPolygon} disabled={draftPoints.length < 3}>
                Finish
              </button>
              <button type="button" onClick={clearDraft} disabled={!draftPoints.length}>
                Clear
              </button>
            </div>
          )}
          {viewpoint && (
            <SilhouetteViewer
              headingDegrees={viewHeadingDegrees}
              profile={silhouetteProfile}
              status={silhouetteStatus}
              error={silhouetteError}
              viewpoint={viewpoint}
              onClose={() => {
                setViewpoint(null);
                setSilhouetteProfile(null);
                setSilhouetteStatus("idle");
              }}
              onHeadingChange={setViewHeadingDegrees}
            />
          )}
        </div>
      </main>

      <aside className="inspector">
        <section className="panel">
          <div className="panel-heading">
            <h2>Trail Filters</h2>
          </div>
          <fieldset>
            <legend>Sources</legend>
            {Object.keys(filters.sources).map((source) => (
              <label key={source} className="check-row">
                <input
                  type="checkbox"
                  checked={filters.sources[source]}
                  onChange={(event) =>
                    setSavedFilters((current) => {
                      const normalized = normalizeFilters(current);
                      return {
                        ...normalized,
                        sources: {
                          ...normalized.sources,
                          [source]: event.target.checked,
                        },
                      };
                    })
                  }
                />
                <span>{source}</span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Types</legend>
            {Object.keys(filters.types).map((type) => (
              <label key={type} className="check-row">
                <input
                  type="checkbox"
                  checked={filters.types[type]}
                  onChange={(event) =>
                    setSavedFilters((current) => {
                      const normalized = normalizeFilters(current);
                      return {
                        ...normalized,
                        types: {
                          ...normalized.types,
                          [type]: event.target.checked,
                        },
                      };
                    })
                  }
                />
                <span>{type}</span>
              </label>
            ))}
          </fieldset>
          <label className="check-row divider">
            <input
              type="checkbox"
              checked={filters.hideRuledOut}
              onChange={(event) =>
                setSavedFilters((current) => ({
                  ...normalizeFilters(current),
                  hideRuledOut: event.target.checked,
                }))
              }
            />
            <span>Hide ruled-out trails</span>
          </label>
          <fieldset className="divider">
            <legend>Cell service</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.cellService.showLayer}
                onChange={(event) =>
                  setSavedFilters((current) => {
                    const normalized = normalizeFilters(current);
                    return {
                      ...normalized,
                      cellService: {
                        ...normalized.cellService,
                        showLayer: event.target.checked,
                      },
                    };
                  })
                }
              />
              <span>Show T-Mobile layer</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.cellService.requireReliable}
                onChange={(event) =>
                  setSavedFilters((current) => {
                    const normalized = normalizeFilters(current);
                    return {
                      ...normalized,
                      cellService: {
                        ...normalized.cellService,
                        requireReliable: event.target.checked,
                      },
                    };
                  })
                }
              />
              <span>Require reliable service</span>
            </label>
            <p className="filter-note">{cellCoverageMeta.note}</p>
          </fieldset>
          <fieldset className="divider">
            <legend>State and national parks</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.protectedAreas.showLayer}
                onChange={(event) =>
                  setSavedFilters((current) => {
                    const normalized = normalizeFilters(current);
                    return {
                      ...normalized,
                      protectedAreas: {
                        ...normalized.protectedAreas,
                        showLayer: event.target.checked,
                      },
                    };
                  })
                }
              />
              <span>Show park layer</span>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={filters.protectedAreas.excludeParks}
                onChange={(event) =>
                  setSavedFilters((current) => {
                    const normalized = normalizeFilters(current);
                    return {
                      ...normalized,
                      protectedAreas: {
                        ...normalized.protectedAreas,
                        excludeParks: event.target.checked,
                      },
                    };
                  })
                }
              />
              <span>Exclude park trails</span>
            </label>
            <p className="filter-note">{protectedAreasMeta.note}</p>
          </fieldset>
        </section>

        <section className="panel detail-panel">
          <div className="panel-heading">
            <h2>Inspector</h2>
          </div>
          {selectedFeature ? (
            <FeatureDetails feature={selectedFeature} />
          ) : (
            <p className="empty-state">
              Select a trail or rule-out area to inspect metadata and clue links.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Visible Trails</h2>
            <span>{filteredTrails.length}</span>
          </div>
          <div className="trail-list">
            {filteredTrails.map((trail) => (
              <button
                key={trail.id}
                type="button"
                className={selectedId === trail.id ? "trail-row selected" : "trail-row"}
                onClick={() => setSelectedId(trail.id)}
              >
                <span>
                  <strong>{trail.properties.name}</strong>
                  <small>{trail.properties.source} · {trail.properties.type}</small>
                </span>
                <em>{formatDistance(trail.length)}</em>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function SilhouetteViewer({
  headingDegrees,
  profile,
  status,
  error,
  viewpoint,
  onClose,
  onHeadingChange,
}) {
  const dragXRef = useRef(null);
  const points = profile?.profile || EMPTY_PROFILE_POINTS;
  const angleRange = useMemo(() => {
    if (!points.length) return { min: -2, max: 10 };
    const values = points.map((point) => point.angleDegrees);
    return {
      min: Math.min(-2, Math.min(...values) - 1),
      max: Math.max(8, Math.max(...values) + 1),
    };
  }, [points]);
  const skylinePath = useMemo(() => {
    if (!points.length) return "";
    const width = 420;
    const height = 150;
    const xStep = width / Math.max(points.length - 1, 1);
    const yScale = height / Math.max(angleRange.max - angleRange.min, 1);
    return points
      .map((point, index) => {
        const x = index * xStep;
        const y = height - (point.angleDegrees - angleRange.min) * yScale;
        return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [angleRange, points]);

  const updateHeading = (nextHeading) => onHeadingChange(normalizeHeading(nextHeading));
  const handleProfilePointerDown = (event) => {
    dragXRef.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleProfilePointerMove = (event) => {
    if (dragXRef.current == null) return;
    const deltaX = event.clientX - dragXRef.current;
    if (Math.abs(deltaX) < 2) return;
    updateHeading(headingDegrees + deltaX * 0.35);
    dragXRef.current = event.clientX;
  };
  const stopDragging = () => {
    dragXRef.current = null;
  };
  const handleCompassPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    updateHeading((Math.atan2(dx, -dy) * 180) / Math.PI);
  };

  return (
    <section className="map-floating silhouette-panel" aria-label="Mountain silhouette viewer">
      <div className="silhouette-heading">
        <div>
          <h2>Mountain View</h2>
          <p>
            {viewpoint[1].toFixed(4)}, {viewpoint[0].toFixed(4)} ·{" "}
            {Math.round(normalizeHeading(headingDegrees))}° {formatHeading(headingDegrees)}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close mountain view">
          Close
        </button>
      </div>

      <div className="silhouette-body">
        <div className="silhouette-chart">
          <svg
            viewBox="0 0 420 170"
            role="img"
            aria-label="Approximate skyline profile"
            onPointerDown={handleProfilePointerDown}
            onPointerMove={handleProfilePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <rect width="420" height="170" rx="6" className="skyline-sky" />
            <path d="M 0 150 L 420 150" className="skyline-horizon" />
            {points.length ? (
              <>
                <path
                  d={`${skylinePath} L 420 170 L 0 170 Z`}
                  className="skyline-fill"
                />
                <path d={skylinePath} className="skyline-line" />
              </>
            ) : (
              <path d="M 0 142 L 420 142" className="skyline-line muted" />
            )}
          </svg>
          <div className="silhouette-status">
            {status === "idle" && "Pick a map point to generate a skyline."}
            {status === "loading" && "Sampling Open-Meteo elevation..."}
            {status === "ready" &&
              `${points.length} bearings · observer ${Math.round(profile.originElevation)} m`}
            {status === "error" && (error || "Could not generate this skyline.")}
          </div>
          <p className="silhouette-attribution">
            Elevation data: Open-Meteo and Copernicus DEM GLO-90.
          </p>
        </div>

        <div className="compass-stack">
          <button
            type="button"
            className="compass"
            aria-label="Set viewing direction"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              handleCompassPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons) handleCompassPointer(event);
            }}
          >
            <span className="compass-label north">N</span>
            <span className="compass-label east">E</span>
            <span className="compass-label south">S</span>
            <span className="compass-label west">W</span>
            <span
              className="compass-needle"
              style={{ transform: `translate(-50%, -100%) rotate(${headingDegrees}deg)` }}
            />
          </button>
          <div className="heading-actions">
            <button type="button" onClick={() => updateHeading(headingDegrees - 10)}>
              Left
            </button>
            <button type="button" onClick={() => updateHeading(headingDegrees + 10)}>
              Right
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ToolButton({ active, label, onClick }) {
  return (
    <button type="button" className={active ? "tool active" : "tool"} onClick={onClick}>
      {label}
    </button>
  );
}

function ExclusionRow({ exclusion, selected, onSelect, onChange, onDelete }) {
  return (
    <article className={selected ? "exclusion-row selected" : "exclusion-row"}>
      <button type="button" className="row-select" onClick={onSelect}>
        <strong>{exclusion.title}</strong>
        <span>{formatArea(getPolygonArea(exclusion.geometry.coordinates[0]))}</span>
      </button>
      <input
        value={exclusion.title}
        aria-label="Exclusion title"
        onChange={(event) => onChange({ title: event.target.value })}
      />
      <textarea
        value={exclusion.reason}
        aria-label="Reason this area is ruled out"
        placeholder="Why it is not here"
        onChange={(event) => onChange({ reason: event.target.value })}
      />
      <div className="row-actions">
        <select
          value={exclusion.confidence}
          aria-label="Confidence"
          onChange={(event) => onChange({ confidence: event.target.value })}
        >
          <option value="low">Low confidence</option>
          <option value="medium">Medium confidence</option>
          <option value="high">High confidence</option>
        </select>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </article>
  );
}

function ClueRow({ clue, index, onChange }) {
  return (
    <article className="clue-row">
      <div>
        <span className="clue-index">{index}</span>
        <select
          value={clue.status}
          aria-label="Clue status"
          onChange={(event) => onChange({ status: event.target.value })}
        >
          <option value="unresolved">Unresolved</option>
          <option value="candidate">Candidate</option>
          <option value="ruled-out">Ruled out</option>
        </select>
      </div>
      <input
        value={clue.line}
        aria-label="Poem line"
        placeholder="Poem line"
        onChange={(event) => onChange({ line: event.target.value })}
      />
      <textarea
        value={clue.interpretation}
        aria-label="Clue interpretation"
        placeholder="Interpretation, landmarks, trail hints"
        onChange={(event) => onChange({ interpretation: event.target.value })}
      />
    </article>
  );
}

function FeatureDetails({ feature }) {
  if (feature.properties?.source) {
    return (
      <dl className="details">
        <dt>Name</dt>
        <dd>{feature.properties.name}</dd>
        <dt>Source</dt>
        <dd>{feature.properties.source}</dd>
        <dt>Type</dt>
        <dd>{feature.properties.type}</dd>
        <dt>Access</dt>
        <dd>{feature.properties.access}</dd>
        <dt>Length</dt>
        <dd>{formatDistance(feature.length)}</dd>
        <dt>Status</dt>
        <dd>{feature.ruledOut ? "Touches a ruled-out area" : "Still in candidate set"}</dd>
        <dt>Cell</dt>
        <dd>
          {feature.hasReliableCellService ? "Reliable T-Mobile area" : "Limited T-Mobile area"}
          {" · "}
          {Math.round(feature.cellCoverageRatio * 100)}% sampled coverage
        </dd>
        <dt>Parks</dt>
        <dd>
          {feature.intersectsProtectedArea
            ? "Touches a state or national park area"
            : "No park overlap"}
        </dd>
      </dl>
    );
  }

  return (
    <dl className="details">
      <dt>Title</dt>
      <dd>{feature.title}</dd>
      <dt>Confidence</dt>
      <dd>{feature.confidence}</dd>
      <dt>Area</dt>
      <dd>{formatArea(getPolygonArea(feature.geometry.coordinates[0]))}</dd>
      <dt>Created</dt>
      <dd>{new Date(feature.createdAt).toLocaleString()}</dd>
      <dt>Reason</dt>
      <dd>{feature.reason || "No note yet"}</dd>
    </dl>
  );
}

function trailIntersectsExclusion(trail, exclusion) {
  if (lineIntersectsPolygon(trail.geometry.coordinates, exclusion.geometry.coordinates[0])) {
    return true;
  }
  return trail.geometry.coordinates.some((point) =>
    pointInPolygon(point, exclusion.geometry.coordinates[0])
  );
}

function formatHeading(degrees) {
  const normalized = normalizeHeading(degrees);
  if (normalized >= 337.5 || normalized < 22.5) return "N";
  if (normalized < 67.5) return "NE";
  if (normalized < 112.5) return "E";
  if (normalized < 157.5) return "SE";
  if (normalized < 202.5) return "S";
  if (normalized < 247.5) return "SW";
  if (normalized < 292.5) return "W";
  return "NW";
}

createRoot(document.getElementById("root")).render(<App />);
