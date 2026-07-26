// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DeckGL} from '@deck.gl/react';
import {MapView} from '@deck.gl/core';
import {H3HexagonLayer} from '@deck.gl/geo-layers';

import {Map} from 'react-map-gl/maplibre';

const CONTROL_PANEL_STYLE = {
  position: 'fixed',
  top: 20,
  left: 20,
  padding: 20,
  fontSize: 13,
  background: '#fff'
};

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// `repeat` will draw multiple copies of the map at low zoom levels
const MAP_VIEW = new MapView({repeat: true});

const INITIAL_VIEW_STATE = {
  longitude: 0,
  latitude: 0,
  zoom: 2
};

function processWifiData(wifiData) {
  if (!wifiData || !Array.isArray(wifiData.hexagons)) {
    return {wifiHexagons: [], viewState: INITIAL_VIEW_STATE};
  }

  const wifiHexagons = wifiData.hexagons.map(hexagon => {
    const networks = Array.isArray(hexagon.networks) ? hexagon.networks : [];
    const bestNetwork = networks.reduce((best, current) => {
      if (!best || current['best signal'] > best['best signal']) {
        return current;
      }
      return best;
    }, null);

    const totalRecords = networks.reduce((sum, network) => {
      return sum + (Array.isArray(network.records) ? network.records.length : 0);
    }, 0);

    const encryptionTypes = Array.from(
      new Set(networks.map(network => network.encryption).filter(Boolean))
    );

    return {
      ...hexagon,
      networks,
      bestSignal: bestNetwork ? bestNetwork['best signal'] : null,
      networkCount: networks.length,
      recordCount: totalRecords,
      encryptionTypes,
      topSSID: bestNetwork ? bestNetwork.ssid : 'Unknown'
    };
  });

  const allRecords = wifiHexagons.flatMap(hexagon =>
    hexagon.networks.flatMap(network => network.records || [])
  );

  const viewState = allRecords.length
    ? {
        longitude: allRecords.reduce((sum, record) => sum + record.lng, 0) / allRecords.length,
        latitude: allRecords.reduce((sum, record) => sum + record.lat, 0) / allRecords.length,
        zoom: 15,
        pitch: 45,
        bearing: -30
      }
    : {
        ...INITIAL_VIEW_STATE,
        pitch: 45,
        bearing: -30
      };

  return {wifiHexagons, viewState};
}

function getWifiColor(hexagon) {
  if (hexagon.bestSignal == null) {
    return [150, 150, 150, 120];
  }

  const normalized = Math.max(0, Math.min(1, (hexagon.bestSignal + 100) / 50));
  return [Math.round(255 * (1 - normalized)), 50, Math.round(255 * normalized), 180];
}

export default function App() {
  const [wifiHexagons, setWifiHexagons] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const initialViewStateSet = useRef(false);

  const loadWifiData = useCallback(async () => {
    try {
      const response = await fetch('/wifi-h3data.json', {cache: 'no-store'});
      const json = await response.json();
      const {wifiHexagons, viewState} = processWifiData(json);
      setWifiHexagons(wifiHexagons);
      if (!initialViewStateSet.current) {
        setViewState(viewState);
        initialViewStateSet.current = true;
      }
    } catch (error) {
      // ignore fetch errors during polling
      console.warn('Failed to load wifi-h3data.json', error);
    }
  }, []);

  const onViewStateChange = useCallback(({viewState}) => {
    setViewState(viewState);
  }, []);

  useEffect(() => {
    loadWifiData();
    const interval = setInterval(loadWifiData, 30000);
    return () => clearInterval(interval);
  }, [loadWifiData]);

  const wifiLayer = new H3HexagonLayer({
    id: 'wifi-h3-layer',
    data: wifiHexagons,
    getHexagon: d => d.hex,
    pickable: true,
    autoHighlight: true,
    filled: true,
    extruded: true,
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 1,
    getElevation: d => d.networkCount,
    elevationScale: 10.0,
    getFillColor: getWifiColor,
    getLineColor: [0, 0, 0, 120],
    highlightColor: [255, 255, 0, 180]
  });

  return (
    <>
      <DeckGL
        viewState={viewState}
        controller={{
          dragPan: true,
          dragRotate: true,
          scrollZoom: true,
          doubleClickZoom: true,
          touchRotate: true,
          touchZoom: true,
          keyboard: true
        }}
        views={MAP_VIEW}
        layers={[wifiLayer]}
        onViewStateChange={onViewStateChange}
        getTooltip={info => {
          if (!info.object) {
            return null;
          }
          return {
            html: `<div style="font-size:13px; line-height:1.3;">
              <div><strong>Hexagon</strong>: ${info.object.hex}</div>
              <div><strong>Networks</strong>: ${info.object.networkCount}</div>
              <div><strong>Records</strong>: ${info.object.recordCount}</div>
              <div><strong>Best signal</strong>: ${info.object.bestSignal ?? 'N/A'} dBm</div>
              <div><strong>Top SSID</strong>: ${info.object.topSSID}</div>
              <div><strong>Encryption</strong>: ${info.object.encryptionTypes.join(', ') || 'N/A'}</div>
            </div>`
          };
        }}
      >
        <Map mapStyle={MAP_STYLE} />
      </DeckGL>
    </>
  );
}

/* global document */
document.body.style.overflow = 'hidden';
const container = document.body.appendChild(document.createElement('div'));
createRoot(container).render(<App />);
