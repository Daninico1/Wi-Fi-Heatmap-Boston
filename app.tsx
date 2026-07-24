// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React from 'react';
import {createRoot} from 'react-dom/client';
import {Map} from 'react-map-gl/maplibre';
import {AmbientLight, PointLight, LightingEffect} from '@deck.gl/core';
import {HexagonLayer} from '@deck.gl/aggregation-layers';
import {DeckGL} from '@deck.gl/react';
import {CSVLoader} from '@loaders.gl/csv';
import {load} from '@loaders.gl/core';

import type {Color, PickingInfo, MapViewState} from '@deck.gl/core';

// Source data CSV
const DATA_URL =
  'https://raw.githubusercontent.com/Daninico1/heatmap-example/refs/heads/main/WifiRuns.csv'; // eslint-disable-line

const ambientLight = new AmbientLight({
  color: [255, 255, 255],
  intensity: 1.0
});

const pointLight1 = new PointLight({
  color: [255, 255, 255],
  intensity: 0.8,
  position: [-0.144528, 49.739968, 80000]
});

const pointLight2 = new PointLight({
  color: [255, 255, 255],
  intensity: 0.8,
  position: [-3.807751, 54.104682, 8000]
});

const lightingEffect = new LightingEffect({ambientLight, pointLight1, pointLight2});

const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -71.073062,
  latitude: 42.351226,
  zoom: 14,
  minZoom: 9,
  maxZoom: 17,
  pitch: 45,
  bearing: 0
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json';

export const colorRange: Color[] = [
  [1, 152, 189],
  [73, 227, 206],
  [216, 254, 181],
  [254, 237, 177],
  [254, 173, 84],
  [209, 55, 78]
];

function getTooltip({object}: PickingInfo) {
  if (!object) {
    return null;
  }

  return `${object.count} Wi-Fi Networks`;
}

type DataPoint = [longitude: number, latitude: number];

export default function App({
  data = null,
  mapStyle = MAP_STYLE,
  radius = 10,
  upperPercentile = 100,
  coverage = 0.75
}: {
  data?: DataPoint[] | null;
  mapStyle?: string;
  radius?: number;
  upperPercentile?: number;
  coverage?: number;
}) {
  const layers = [
    new HexagonLayer<DataPoint>({
      id: 'heatmap',
      gpuAggregation: true,
      colorRange,
      coverage,
      data,
      elevationRange: [0, 3000],
      elevationScale: data && data.length ? 50 : 0,
      extruded: false,
      getPosition: d => d,
      pickable: true,
      radius,
      upperPercentile,
      material: {
        ambient: 0.64,
        diffuse: 0.6,
        shininess: 32,
        specularColor: [51, 51, 51]
      },

      transitions: {
        elevationScale: 3000
      }
    })
  ];

  return (
    <DeckGL
      layers={layers}
      effects={[lightingEffect]}
      initialViewState={INITIAL_VIEW_STATE}
      controller={true}
      getTooltip={getTooltip}
    >
      <Map 
        reuseMaps 
        mapStyle={mapStyle} 
        />
    </DeckGL>
  );
}

export async function renderToDOM(container: HTMLDivElement) {
  const root = createRoot(container);
  root.render(<App />);

  const data = (await load(DATA_URL, CSVLoader)).data;
  const points: DataPoint[] = data
    .map(d => (Number.isFinite(d.lng) ? [d.lng, d.lat] : null))
    .filter(Boolean);
  root.render(<App data={points} />);
}
