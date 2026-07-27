// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DeckGL} from '@deck.gl/react';
import {MapView} from '@deck.gl/core';
import {H3HexagonLayer} from '@deck.gl/geo-layers';
import maplibregl from 'maplibre-gl';

import {Map} from 'react-map-gl/maplibre';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_VIEW = new MapView({repeat: true});
const BOSTON_VIEW_STATE = {
  longitude: -71.0589,
  latitude: 42.3601,
  zoom: 15,
  pitch: 50,
  bearing: 0
};
const INITIAL_VIEW_STATE = BOSTON_VIEW_STATE;

const SIGNAL_MIN = -100;
const SIGNAL_MAX = -40;
const MAX_ELEVATION_SCALE = 360;
const AUTO_ROTATE_SPEED = 0.04;

const basePanelStyle = {
  position: 'fixed',
  top: 20,
  width: 340,
  maxHeight: 'calc(100vh - 40px)',
  overflowY: 'auto',
  padding: 22,
  fontSize: 13,
  color: '#e0f7ff',
  background: 'linear-gradient(180deg, rgba(10, 15, 28, 0.96), rgba(4, 9, 18, 0.96))',
  border: '1px solid rgba(56, 189, 248, 0.42)',
  borderRadius: 20,
  boxShadow: '0 0 48px rgba(56, 189, 248, 0.18)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  zIndex: 1,
  fontFamily: 'Roboto Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
};

const leftPanelStyle = {
  ...basePanelStyle,
  left: 20
};

const rightPanelStyle = {
  ...basePanelStyle,
  right: 20,
  width: 320
};

const sectionStyle = {
  display: 'grid',
  gap: 12,
  marginTop: 16,
  padding: '8px 0'
};

const inputStyle = {
  width: '100%',
  borderRadius: 14,
  border: '1px solid rgba(56, 189, 248, 0.45)',
  background: 'rgba(15, 23, 42, 0.92)',
  color: '#e0f7ff',
  padding: '12px 14px',
  outline: 'none',
  boxShadow: 'inset 0 0 0 1px rgba(56, 189, 248, 0.16)',
  transition: 'border-color 0.2s ease'
};

const inputFocusStyle = {
  border: '1px solid rgba(56, 189, 248, 0.9)',
  boxShadow: '0 0 20px rgba(56, 189, 248, 0.18)'
};

const labelStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  color: '#9fd8ff',
  textTransform: 'uppercase',
  letterSpacing: '0.08em'
};

const legendStyle = {
  padding: 18,
  background: 'rgba(5, 10, 22, 0.96)',
  borderRadius: 18,
  border: '1px solid rgba(56, 189, 248, 0.28)',
  boxShadow: '0 0 26px rgba(56, 189, 248, 0.1)'
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getWifiColor(hexagon) {
  if (hexagon.bestSignal == null) {
    return [146, 154, 171, 180];
  }

  const normalized = clamp((hexagon.bestSignal - SIGNAL_MIN) / (SIGNAL_MAX - SIGNAL_MIN), 0, 1);
  return [Math.round(255 * (1 - normalized)), 90, Math.round(255 * normalized), 180];
}

function getFillColor(hexagon, displayMode) {
  if (displayMode === 'density') {
    const intensity = clamp((hexagon.networkCount || 1) / Math.max(1, hexagon.networkCount || 1), 0, 1);
    return [Math.round(40 + 215 * intensity), Math.round(160 - 100 * intensity), 255, 200];
  }

  return getWifiColor(hexagon);
}

function processWifiData(wifiData) {
  if (!wifiData || !Array.isArray(wifiData.hexagons)) {
    return {
      wifiHexagons: [],
      viewState: INITIAL_VIEW_STATE,
      encryptionTypes: [],
      maxNetworkCount: 1
    };
  }

  const wifiHexagons = wifiData.hexagons.map(hexagon => {
    const networks = Array.isArray(hexagon.networks) ? hexagon.networks : [];
    const bestNetwork = networks.reduce((best, current) => {
      if (!best || current['best signal'] > best['best signal']) {
        return current;
      }
      return best;
    }, null);

    const recordCount = networks.reduce((sum, network) => {
      return sum + (Array.isArray(network.records) ? network.records.length : 0);
    }, 0);

    const signalValues = networks.flatMap(network =>
      Array.isArray(network.records) ? network.records.map(record => record['dBm']) : []
    ).filter(signal => typeof signal === 'number');

    const averageSignal = signalValues.length
      ? Math.round(signalValues.reduce((sum, signal) => sum + signal, 0) / signalValues.length)
      : null;

    const encryptionTypes = Array.from(
      new Set(networks.map(network => network.encryption).filter(Boolean))
    );

    const openNetworkCount = networks.reduce((sum, network) => {
      const encryptionString = typeof network.encryption === 'string' ? network.encryption.toLowerCase() : '';
      return sum + (/open|none|wep|unencrypted/.test(encryptionString) ? 1 : 0);
    }, 0);

    const riskScore = Math.round(
      clamp(openNetworkCount / Math.max(1, networks.length), 0, 1) * 0.8 * 100 +
      clamp(1 - (bestNetwork ? (bestNetwork['best signal'] - SIGNAL_MIN) / (SIGNAL_MAX - SIGNAL_MIN) : 0), 0, 1) * 0.2 * 100
    );

    const topRecord = bestNetwork && Array.isArray(bestNetwork.records) ? bestNetwork.records[0] : null;

    return {
      ...hexagon,
      networks,
      bestSignal: bestNetwork ? bestNetwork['best signal'] : null,
      bestSSID: bestNetwork ? bestNetwork.ssid : 'Unknown',
      bestBssid: bestNetwork ? bestNetwork.bssid : 'Unknown',
      bestEncryption: bestNetwork ? bestNetwork.encryption : 'Unknown',
      bestRecord: topRecord,
      averageSignal,
      networkCount: networks.length,
      recordCount,
      openNetworkCount,
      riskScore,
      encryptionTypes
    };
  });

  const allRecords = wifiHexagons.flatMap(hexagon =>
    hexagon.networks.flatMap(network => network.records || [])
  );

  const viewState = allRecords.length
    ? {
        longitude: allRecords.reduce((sum, record) => sum + record.lng, 0) / allRecords.length,
        latitude: allRecords.reduce((sum, record) => sum + record.lat, 0) / allRecords.length,
        zoom: 16,
        pitch: 45,
        bearing: -30
      }
    : INITIAL_VIEW_STATE;

  const encryptionTypes = Array.from(
    new Set(wifiHexagons.flatMap(hexagon => hexagon.encryptionTypes))
  );

  const maxNetworkCount = Math.max(1, ...wifiHexagons.map(hexagon => hexagon.networkCount));

  return {wifiHexagons, viewState, encryptionTypes, maxNetworkCount};
}

export default function App() {
  const [wifiHexagons, setWifiHexagons] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showLayer, setShowLayer] = useState(true);
  const [filterSSID, setFilterSSID] = useState('');
  const [filterEncryption, setFilterEncryption] = useState('All');
  const [minSignal, setMinSignal] = useState(SIGNAL_MIN);
  const [minNetworks, setMinNetworks] = useState(1);
  const [displayMode, setDisplayMode] = useState('signal');
  const [encryptionTypes, setEncryptionTypes] = useState(['All']);
  const [maxNetworkCount, setMaxNetworkCount] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [updateHistory, setUpdateHistory] = useState([]);
  const [userInteracted, setUserInteracted] = useState(false);
  const initialViewStateRef = useRef(null);
  const rotateRef = useRef(0);

  const loadWifiData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/wifi-h3data.json', {cache: 'no-store'});
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const json = await response.json();
      const {wifiHexagons, viewState, encryptionTypes, maxNetworkCount} = processWifiData(json);
      setWifiHexagons(wifiHexagons);
      setEncryptionTypes(['All', ...encryptionTypes]);
      setMaxNetworkCount(maxNetworkCount);

      if (!initialViewStateRef.current) {
        setViewState(viewState);
        initialViewStateRef.current = viewState;
      }

      const now = new Date();
      setLastUpdated(now);
      setUpdateHistory(prev => [
        {time: now, count: wifiHexagons.length},
        ...prev.slice(0, 4)
      ]);
    } catch (e) {
      setError(e.message || 'Unable to load wifi data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(link);
    document.body.style.margin = '0';
    document.body.style.background = '#040814';
    document.body.style.fontFamily = 'Roboto Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    document.body.style.overflow = 'hidden';

    loadWifiData();
    const interval = setInterval(loadWifiData, 30000);

    return () => {
      document.head.removeChild(link);
      clearInterval(interval);
    };
  }, [loadWifiData]);

  useEffect(() => {
    if (userInteracted) {
      return undefined;
    }

    const handle = requestAnimationFrame(() => {
      rotateRef.current += AUTO_ROTATE_SPEED;
      setViewState(prev => ({
        ...prev,
        bearing: prev.bearing + AUTO_ROTATE_SPEED
      }));
    });

    return () => cancelAnimationFrame(handle);
  }, [userInteracted, viewState]);

  const filteredHexagons = useMemo(
    () =>
      wifiHexagons.filter(hexagon => {
        if (!showLayer) {
          return false;
        }

        if (hexagon.networkCount < minNetworks) {
          return false;
        }

        if (hexagon.bestSignal == null || hexagon.bestSignal < minSignal) {
          return false;
        }

        if (filterEncryption !== 'All' && !hexagon.encryptionTypes.includes(filterEncryption)) {
          return false;
        }

        if (
          filterSSID &&
          !hexagon.networks.some(network =>
            typeof network.ssid === 'string' &&
            network.ssid.toLowerCase().includes(filterSSID.toLowerCase())
          )
        ) {
          return false;
        }

        return true;
      }),
    [wifiHexagons, showLayer, minNetworks, minSignal, filterEncryption, filterSSID]
  );

  const displayedHexagons = filteredHexagons.length > 0 ? filteredHexagons : wifiHexagons;
  const showFallbackNotice = filteredHexagons.length === 0 && wifiHexagons.length > 0;

  const wifiLayer = useMemo(() => {
    if (!showLayer) {
      return null;
    }

    return new H3HexagonLayer({
      id: 'wifi-h3-layer',
      data: displayedHexagons,
      getHexagon: d => d.hex,
      pickable: true,
      autoHighlight: true,
      filled: true,
      extruded: true,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 1,
      getElevation: d => Math.max(0.1, (d.networkCount || 1) / Math.max(1, maxNetworkCount)),
      elevationScale: MAX_ELEVATION_SCALE * 1.6,
      getFillColor: d => getFillColor(d, displayMode) || [128, 170, 255, 220],
      getLineColor: [34, 211, 238, 220],
      opacity: 1,
      highlightColor: [255, 255, 0, 220]
    });
  }, [displayedHexagons, maxNetworkCount, showLayer, displayMode]);

  const onViewStateChange = useCallback(({viewState}) => {
    setViewState(viewState);
  }, []);

  const resetCamera = () => {
    if (initialViewStateRef.current) {
      setViewState(initialViewStateRef.current);
    } else {
      setViewState(INITIAL_VIEW_STATE);
    }
  };

  const signalLegendStops = [-100, -90, -80, -70, -60, -50, -40];

  return (
    <>
      <DeckGL
        style={{position: 'absolute', top: 0, left: 0, width: '100%', height: '100%'}}
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
        layers={wifiLayer ? [wifiLayer] : []}
        onViewStateChange={onViewStateChange}
        onInteractionStateChange={({isDragging, isPanning, isRotating, isZooming}) => {
          if (isDragging || isPanning) {
            setUserInteracted(true);
          }
        }}
        getTooltip={info => {
          if (!info.object) {
            return null;
          }

          return {
            html: `<div style="font-size:13px; line-height:1.35; color:#111;">
              <div><strong style="color:#111;">Hexagon</strong>: ${info.object.hex}</div>
              <div><strong>Networks</strong>: ${info.object.networkCount}</div>
              <div><strong>Records</strong>: ${info.object.recordCount}</div>
              <div><strong>Average signal</strong>: ${info.object.averageSignal ?? 'N/A'} dBm</div>
              <div><strong>Best signal</strong>: ${info.object.bestSignal ?? 'N/A'} dBm</div>
              <div><strong>Top SSID</strong>: ${info.object.bestSSID}</div>
              <div><strong>BSSID</strong>: ${info.object.bestBssid}</div>
              <div><strong>Encryption</strong>: ${info.object.bestEncryption}</div>
              <div><strong>Encryption types</strong>: ${info.object.encryptionTypes.join(', ') || 'N/A'}</div>
              ${info.object.bestRecord ? `<div><strong>Best sample</strong>: ${info.object.bestRecord.time} @ ${info.object.bestRecord.lat.toFixed(5)}, ${info.object.bestRecord.lng.toFixed(5)}</div>` : ''}
            </div>`
          };
        }}
      >
        <Map mapLib={maplibregl} mapStyle={MAP_STYLE} />
      </DeckGL>

      <div style={leftPanelStyle}>
        <div style={{fontSize: 20, fontWeight: 800, marginBottom: 6, color: '#7dd3fc', letterSpacing: '0.08em'}}>NEON Wi-Fi H3</div>
        <div style={{fontSize: 12, color: '#94a3b8', lineHeight: 1.6}}>Live refresh every 30 seconds. Explore signal strength, network density, and encryption in a cyber grid.</div>

        <div style={sectionStyle}>
          <button
            type="button"
            onClick={resetCamera}
            style={{
              cursor: 'pointer',
              width: '100%',
              borderRadius: 18,
              border: '1px solid rgba(56, 189, 248, 0.9)',
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(56, 189, 248, 0.14))',
              color: '#e0f7ff',
              padding: '14px 18px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              boxShadow: '0 16px 40px rgba(14, 165, 233, 0.18)'
            }}
          >
            Reset camera
          </button>

          <label style={labelStyle}>
            <span>Show Wi-Fi layer</span>
            <input
              type="checkbox"
              checked={showLayer}
              onChange={evt => setShowLayer(evt.target.checked)}
            />
          </label>

          <label style={labelStyle}>
            <span>Minimum signal</span>
            <span>{minSignal} dBm</span>
          </label>
          <input
            type="range"
            min={SIGNAL_MIN}
            max={SIGNAL_MAX}
            value={minSignal}
            onChange={evt => setMinSignal(Number(evt.target.value))}
            style={inputStyle}
          />

          <label style={labelStyle}>
            <span>Minimum networks</span>
            <span>{minNetworks}</span>
          </label>
          <input
            type="range"
            min={1}
            max={Math.max(1, maxNetworkCount)}
            value={minNetworks}
            onChange={evt => setMinNetworks(Number(evt.target.value))}
            style={inputStyle}
          />

          <label style={labelStyle}>
            <span>Encryption type</span>
          </label>
          <select
            value={filterEncryption}
            onChange={evt => setFilterEncryption(evt.target.value)}
            style={inputStyle}
          >
            {encryptionTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <label style={labelStyle}>
            <span>Search SSID</span>
          </label>
          <input
            type="text"
            value={filterSSID}
            placeholder="SSID substring"
            onChange={evt => setFilterSSID(evt.target.value)}
            style={inputStyle}
          />

          <div style={{display: 'grid', gap: 8}}>
            {isLoading ? (
              <div style={{color: '#60a5fa'}}>Loading data…</div>
            ) : error ? (
              <div style={{color: '#f87171'}}>Error: {error}</div>
            ) : (
              <div style={{color: '#cbd5e1'}}>
                Loaded {wifiHexagons.length} hexagons, showing {filteredHexagons.length}.
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={rightPanelStyle}>
        <div style={{display: 'grid', gap: 24}}>
          <div style={{fontSize: 16, fontWeight: 800, color: '#7dd3fc', letterSpacing: '0.08em'}}>Dashboard</div>
          <div style={legendStyle}>
            <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: '#f8fafc'}}>Legend</div>
            <div style={{display: 'grid', gap: 12}}>
              <div>
                <div style={{fontSize: 11, color: '#94a3b8', marginBottom: 6}}>Signal color</div>
                <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                  {signalLegendStops.map(value => {
                    const color = getWifiColor({bestSignal: value});
                    return (
                      <div
                        key={value}
                        title={`${value} dBm`}
                        style={{
                          width: 28,
                          height: 20,
                          background: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`,
                          borderRadius: 6,
                          border: '1px solid rgba(255,255,255,0.12)'
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{fontSize: 11, color: '#94a3b8', marginTop: 6}}>Color maps from low (cold) to high (warm) signal.</div>
              </div>
              <div>
                <div style={{fontSize: 11, color: '#94a3b8', marginBottom: 6}}>Height</div>
                <div style={{fontSize: 11, color: '#cbd5e1'}}>Hexagon height is normalized by network count, max count is {maxNetworkCount}.</div>
              </div>
            </div>
          </div>

          <div style={legendStyle}>
            <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: '#f8fafc'}}>Insights</div>
            <div style={{display: 'grid', gap: 12}}>
              <div style={{display: 'grid', gap: 4}}>
                <div style={{fontSize: 11, color: '#94a3b8'}}>Total hexagons</div>
                <div style={{fontSize: 18, fontWeight: 700, color: '#7dd3fc'}}>{wifiHexagons.length}</div>
              </div>
              <div style={{display: 'grid', gap: 4}}>
                <div style={{fontSize: 11, color: '#94a3b8'}}>Active networks</div>
                <div style={{fontSize: 18, fontWeight: 700, color: '#7dd3fc'}}>{wifiHexagons.reduce((sum, hexagon) => sum + hexagon.networkCount, 0)}</div>
              </div>
              <div style={{display: 'grid', gap: 4}}>
                <div style={{fontSize: 11, color: '#94a3b8'}}>Last refresh</div>
                <div style={{fontSize: 14, color: '#dbeafe'}}>{lastUpdated ? lastUpdated.toLocaleTimeString() : 'Waiting...'}</div>
              </div>
            </div>
          </div>

          <div style={legendStyle}>
            <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: '#f8fafc'}}>Update history</div>
            <div style={{display: 'flex', gap: 10, alignItems: 'flex-end', minHeight: 96}}>
              {updateHistory.map((entry, index) => {
                const maxCount = Math.max(1, updateHistory[0]?.count || 1);
                const height = Math.min(96, Math.max(18, (entry.count / maxCount) * 96));
                return (
                  <div key={`${entry.time}-${index}`} style={{display: 'grid', alignItems: 'end', gap: 4, width: 36}}>
                    <div style={{height: `${height}px`, background: 'linear-gradient(180deg, rgba(56, 189, 248, 0.95), rgba(14, 165, 233, 0.6))', borderRadius: 10}} />
                    <div style={{fontSize: 10, color: '#94a3b8', textAlign: 'center'}}>{new Date(entry.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* global document */
const container = document.getElementById('root') || document.body.appendChild(document.createElement('div'));
createRoot(container).render(<App />);
