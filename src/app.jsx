// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DeckGL} from '@deck.gl/react';
import {MapView} from '@deck.gl/core';
import {H3HexagonLayer} from '@deck.gl/geo-layers';
import {HeatmapLayer} from '@deck.gl/aggregation-layers';
import maplibregl from 'maplibre-gl';

import {Map} from 'react-map-gl/maplibre';

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_VIEW = new MapView({repeat: true});
const BOSTON_COMMONS_VIEW_STATE = {
  longitude: -71.0656,
  latitude: 42.3558,
  zoom: 12.4,
  pitch: 45,
  bearing: 0
};
const INITIAL_VIEW_STATE = BOSTON_COMMONS_VIEW_STATE;

const SIGNAL_MIN = -100;
const SIGNAL_MAX = -40;
const MAX_ELEVATION_SCALE = 360;
const AUTO_ROTATE_SPEED = 0.04;
const HEATMAP_OPACITY = 0.48;

const basePanelStyle = {
  position: 'fixed',
  top: 20,
  width: 340,
  height: 'calc(100vh - 40px)',
  boxSizing: 'border-box',
  overflow: 'hidden',
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
  left: 20,
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
  gap: 16
};

const rightPanelStyle = {
  ...basePanelStyle,
  right: 20,
  width: 320,
  display: 'grid',
  gridTemplateRows: '1fr',
  gap: 16,
  overflowY: 'auto',
  overflowX: 'hidden'
};

const sectionStyle = {
  display: 'grid',
  gap: 12,
  marginTop: 16,
  padding: '8px 0'
};

const inputStyle = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  borderRadius: 14,
  border: '1px solid rgba(56, 189, 248, 0.45)',
  background: 'rgba(15, 23, 42, 0.92)',
  color: '#e0f7ff',
  padding: '12px 14px',
  outline: 'none',
  boxSizing: 'border-box',
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
  gap: 10,
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

function getSelectedHexagonCenter(hexagon) {
  const records = hexagon.networks.flatMap(network => Array.isArray(network.records) ? network.records : []);
  if (!records.length) {
    return null;
  }

  const averageLng = records.reduce((sum, record) => sum + record.lng, 0) / records.length;
  const averageLat = records.reduce((sum, record) => sum + record.lat, 0) / records.length;
  return [averageLng, averageLat];
}

function formatCsvRow(values) {
  return values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',');
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
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapMode, setHeatmapMode] = useState('signal');
  const [filterSSID, setFilterSSID] = useState('');
  const [filterEncryption, setFilterEncryption] = useState('All');
  const [theme, setTheme] = useState('dark');
  const [securityFilter, setSecurityFilter] = useState('All');
  const [signalBand, setSignalBand] = useState('All');
  const [minSignal, setMinSignal] = useState(SIGNAL_MIN);
  const [minNetworks, setMinNetworks] = useState(1);
  const [displayMode, setDisplayMode] = useState('signal');
  const [encryptionTypes, setEncryptionTypes] = useState(['All']);
  const [autoRotateEnabled, setAutoRotateEnabled] = useState(true);
  const [maxNetworkCount, setMaxNetworkCount] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [updateHistory, setUpdateHistory] = useState([]);
  const [selectedHexagon, setSelectedHexagon] = useState(null);
  const [selectedNetworkIndex, setSelectedNetworkIndex] = useState(0);
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
        setViewState(INITIAL_VIEW_STATE);
        initialViewStateRef.current = INITIAL_VIEW_STATE;
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
    document.body.style.background = theme === 'light' ? '#f8fafc' : '#040814';
    document.body.style.color = theme === 'light' ? '#0f172a' : '#e0f7ff';
  }, [theme]);

  const autoRotateActive = autoRotateEnabled && !userInteracted;
  const isLightMode = theme === 'light';
  const mapStyleUrl = isLightMode ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' : MAP_STYLE;
  const themePanelBackground = isLightMode
    ? 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.96))'
    : 'linear-gradient(180deg, rgba(10, 15, 28, 0.96), rgba(4, 9, 18, 0.96))';
  const themePanelBorder = isLightMode ? '1px solid rgba(148, 163, 184, 0.45)' : '1px solid rgba(56, 189, 248, 0.42)';
  const themeTextColor = isLightMode ? '#0f172a' : '#e0f7ff';
  const themeInputBackground = isLightMode ? 'rgba(255,255,255,0.95)' : 'rgba(15, 23, 42, 0.92)';
  const themeInputBorder = isLightMode ? '1px solid rgba(148, 163, 184, 0.45)' : '1px solid rgba(56, 189, 248, 0.45)';
  const themeLegendBackground = isLightMode ? 'rgba(255,255,255,0.94)' : 'rgba(5, 10, 22, 0.96)';
  const themeLegendBorder = isLightMode ? '1px solid rgba(148, 163, 184, 0.35)' : '1px solid rgba(56, 189, 248, 0.28)';
  const themeLabelColor = isLightMode ? '#475569' : '#9fd8ff';
  const themeAccent = isLightMode ? '#2563eb' : '#7dd3fc';
  const themeCaptionColor = isLightMode ? '#64748b' : '#94a3b8';
  const themeButtonText = isLightMode ? '#0f172a' : '#e0f7ff';
  const themedInputStyle = {
    ...inputStyle,
    background: themeInputBackground,
    border: themeInputBorder,
    color: themeTextColor
  };
  const themedLegendStyle = {
    ...legendStyle,
    background: themeLegendBackground,
    border: themeLegendBorder,
    color: themeTextColor
  };

  const themedLabelStyle = {
    ...labelStyle,
    color: themeLabelColor
  };

  useEffect(() => {
    if (!autoRotateActive) {
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
  }, [autoRotateActive, viewState]);

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

        if (securityFilter === 'Open' && hexagon.openNetworkCount === 0) {
          return false;
        }

        if (securityFilter === 'Encrypted' && hexagon.openNetworkCount === hexagon.networkCount) {
          return false;
        }

        if (signalBand === 'Weak' && (hexagon.bestSignal == null || hexagon.bestSignal > -75)) {
          return false;
        }

        if (signalBand === 'Medium' && (hexagon.bestSignal == null || hexagon.bestSignal <= -75 || hexagon.bestSignal > -60)) {
          return false;
        }

        if (signalBand === 'Strong' && (hexagon.bestSignal == null || hexagon.bestSignal <= -60)) {
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
    [wifiHexagons, showLayer, minNetworks, minSignal, filterEncryption, securityFilter, signalBand, filterSSID]
  );

  const displayedHexagons = filteredHexagons.length > 0 ? filteredHexagons : wifiHexagons;
  const showFallbackNotice = filteredHexagons.length === 0 && wifiHexagons.length > 0;

  const heatmapPoints = useMemo(() => {
    if (!showHeatmap) {
      return [];
    }

    return displayedHexagons.flatMap(hexagon =>
      hexagon.networks.flatMap(network =>
        Array.isArray(network.records)
          ? network.records.map(record => ({
              position: [record.lng, record.lat],
              weight: heatmapMode === 'signal'
                ? clamp((record['dBm'] - SIGNAL_MIN) / (SIGNAL_MAX - SIGNAL_MIN), 0, 1)
                : 1
            }))
          : []
      )
    );
  }, [displayedHexagons, heatmapMode, showHeatmap]);

  const heatmapLayer = useMemo(() => {
    if (!showHeatmap) {
      return null;
    }

    return new HeatmapLayer({
      id: 'wifi-heatmap',
      data: heatmapPoints,
      getPosition: d => d.position,
      getWeight: d => d.weight,
      radiusPixels: 90,
      intensity: 1,
      threshold: 0.2,
      colorRange: [
        [33, 102, 172],
        [67, 147, 195],
        [146, 197, 222],
        [209, 229, 240],
        [253, 219, 199],
        [244, 165, 130],
        [214, 96, 77],
        [178, 24, 43]
      ],
      opacity: 0.8
    });
  }, [heatmapPoints, showHeatmap]);

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

  const selectedHexagonLayer = useMemo(() => {
    if (!selectedHexagon) {
      return null;
    }

    return new H3HexagonLayer({
      id: 'wifi-h3-selected',
      data: [selectedHexagon],
      getHexagon: d => d.hex,
      pickable: false,
      filled: true,
      extruded: false,
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      getLineColor: [255, 233, 84, 255],
      getFillColor: [255, 233, 84, 180],
      opacity: 1
    });
  }, [selectedHexagon]);

  const selectedNetwork = selectedHexagon ? selectedHexagon.networks[selectedNetworkIndex] : null;
  const selectedHexagonSummary = useMemo(() => {
    if (!selectedHexagon) {
      return [];
    }

    return selectedHexagon.networks
      .slice()
      .sort((a, b) => (b['best signal'] || -Infinity) - (a['best signal'] || -Infinity))
      .slice(0, 3);
  }, [selectedHexagon]);

  const selectedHexagonCenter = selectedHexagon ? getSelectedHexagonCenter(selectedHexagon) : null;
  const selectedOpenCount = selectedHexagon ? selectedHexagon.openNetworkCount : 0;
  const selectedSecureCount = selectedHexagon ? selectedHexagon.networkCount - selectedOpenCount : 0;
  const selectedCsvText = selectedHexagon
    ? [
        formatCsvRow(['SSID', 'BSSID', 'Encryption', 'Best signal (dBm)', 'Records']),
        ...selectedHexagon.networks.map(network =>
          formatCsvRow([
            network.ssid || '<hidden>',
            network.bssid,
            network.encryption || 'Unknown',
            network['best signal'] ?? 'N/A',
            Array.isArray(network.records) ? network.records.length : 0
          ])
        )
      ].join('\n')
    : '';

  const flyToSelected = () => {
    if (!selectedHexagonCenter) {
      return;
    }

    setViewState(prev => ({
      ...prev,
      longitude: selectedHexagonCenter[0],
      latitude: selectedHexagonCenter[1],
      zoom: 15,
      pitch: 55,
      bearing: 0
    }));
    setUserInteracted(false);
  };

  const copySelectedInfo = async () => {
    if (!selectedHexagon) {
      return;
    }

    const lines = [
      `Hexagon: ${selectedHexagon.hex}`,
      `Networks: ${selectedHexagon.networkCount}`,
      `Records: ${selectedHexagon.recordCount}`,
      `Average signal: ${selectedHexagon.averageSignal ?? 'N/A'} dBm`,
      `Best signal: ${selectedHexagon.bestSignal ?? 'N/A'} dBm`,
      `Open networks: ${selectedOpenCount}`,
      `Secure networks: ${selectedSecureCount}`,
      'Top SSIDs:',
      ...selectedHexagonSummary.map(network => `  - ${network.ssid || '<hidden>'} (${network.encryption || 'Unknown'}) ${network['best signal']} dBm`)
    ];

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      window.alert('Selected hexagon details copied to clipboard.');
    } catch (error) {
      window.alert('Unable to copy details to clipboard.');
    }
  };

  const downloadSelectedCsv = () => {
    if (!selectedHexagon) {
      return;
    }

    const blob = new Blob([selectedCsvText], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selectedHexagon.hex || 'selected-hexagon'}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const onViewStateChange = useCallback(({viewState}) => {
    setViewState(viewState);
  }, []);

  const resetCamera = () => {
    setViewState(initialViewStateRef.current || INITIAL_VIEW_STATE);
    setUserInteracted(false);
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
        layers={[heatmapLayer, wifiLayer, selectedHexagonLayer].filter(Boolean)}
        onViewStateChange={onViewStateChange}
        onClick={info => {
          if (info.object) {
            setSelectedHexagon(info.object);
            setSelectedNetworkIndex(0);
          }
        }}
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
            html: `<div style="font-size:13px; line-height:1.35; color:#FFFF;">
              <div><strong style="color:#FFFF;">Hexagon</strong>: ${info.object.hex}</div>
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
        <Map mapLib={maplibregl} mapStyle={mapStyleUrl} />
      </DeckGL>

      <div style={{...leftPanelStyle, background: themePanelBackground, border: themePanelBorder, color: themeTextColor}}>
        <div style={{display: 'grid', gap: 14}}>
            <div style={{fontSize: 20, fontWeight: 800, color: themeAccent, letterSpacing: '0.08em'}}>Wi-Fi Map Boston</div>
            <div style={{fontSize: 12, color: themeCaptionColor, lineHeight: 1.6}}>Live refresh every 30 seconds. Explore signal strength, network density, and encryption in a cyber grid.</div>

        <div style={{...sectionStyle, overflow: 'hidden', display: 'grid', gap: 16}}>
            <div style={{display: 'grid', gap: 12}}>
            <button
              type="button"
              onClick={resetCamera}
              style={{
                cursor: 'pointer',
                width: '100%',
                borderRadius: 18,
                border: isLightMode ? '1px solid rgba(148, 163, 184, 0.8)' : '1px solid rgba(56, 189, 248, 0.9)',
                background: isLightMode
                  ? 'linear-gradient(135deg, rgba(203, 213, 225, 0.25), rgba(148, 163, 184, 0.16))'
                  : 'linear-gradient(135deg, rgba(14, 165, 233, 0.22), rgba(56, 189, 248, 0.14))',
                color: themeButtonText,
                padding: '14px 18px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                boxShadow: isLightMode ? '0 16px 40px rgba(148, 163, 184, 0.12)' : '0 16px 40px rgba(14, 165, 233, 0.18)'
              }}
            >
              Reset camera
            </button>
            <button
              type="button"
              onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))}
              style={{
                cursor: 'pointer',
                width: '100%',
                borderRadius: 18,
                border: isLightMode ? '1px solid rgba(99,102,241,0.8)' : '1px solid rgba(34, 211, 238, 0.9)',
                background: isLightMode
                  ? 'linear-gradient(135deg, rgba(59,130,246,0.15), rgba(37,99,235,0.14))'
                  : 'linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(56, 189, 248, 0.12))',
                color: themeButtonText,
                padding: '14px 18px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                boxShadow: isLightMode ? '0 16px 40px rgba(59,130,246,0.1)' : '0 16px 40px rgba(34, 211, 238, 0.16)'
              }}
            >
              {isLightMode ? 'Dark mode' : 'Light mode'}
            </button>
            <button
              type="button"
              onClick={() => setAutoRotateEnabled(prev => !prev)}
              style={{
                cursor: 'pointer',
                width: '100%',
                borderRadius: 18,
                border: isLightMode ? '1px solid rgba(148, 163, 184, 0.8)' : '1px solid rgba(34, 211, 238, 0.9)',
                background: isLightMode
                  ? 'linear-gradient(135deg, rgba(203, 213, 225, 0.18), rgba(148, 163, 184, 0.12))'
                  : 'linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(56, 189, 248, 0.12))',
                color: themeButtonText,
                padding: '14px 18px',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                boxShadow: isLightMode ? '0 16px 40px rgba(148, 163, 184, 0.12)' : '0 16px 40px rgba(34, 211, 238, 0.16)'
              }}
            >
              {autoRotateEnabled ? 'Pause spin' : 'Resume spin'}
            </button>
            <div style={{fontSize: 11, color: autoRotateActive ? '#86efac' : '#facc15'}}>
              {autoRotateActive ? 'Auto-rotate active' : autoRotateEnabled ? 'Paused after interaction' : 'Auto-rotate disabled'}
            </div>
          </div>

          <label style={themedLabelStyle}>
            <span>Show Wi-Fi layer</span>
            <input
              type="checkbox"
              checked={showLayer}
              onChange={evt => setShowLayer(evt.target.checked)}
            />
          </label>

          <label style={themedLabelStyle}>
            <span>Show heatmap overlay</span>
            <input
              type="checkbox"
              checked={showHeatmap}
              onChange={evt => setShowHeatmap(evt.target.checked)}
            />
          </label>

          <label style={themedLabelStyle}>
            <span>Heatmap mode</span>
            <select
              value={heatmapMode}
              onChange={evt => setHeatmapMode(evt.target.value)}
              style={themedInputStyle}
            >
              <option value="signal">Signal</option>
              <option value="density">Density</option>
            </select>
          </label>

          <label style={themedLabelStyle}>
            <span>Base display mode</span>
            <select
              value={displayMode}
              onChange={evt => setDisplayMode(evt.target.value)}
              style={themedInputStyle}
            >
              <option value="signal">Signal</option>
              <option value="density">Density</option>
            </select>
          </label>

          <label style={themedLabelStyle}>
            <span>Security filter</span>
            <select
              value={securityFilter}
              onChange={evt => setSecurityFilter(evt.target.value)}
              style={themedInputStyle}
            >
              <option value="All">All</option>
              <option value="Open">Open</option>
              <option value="Encrypted">Encrypted</option>
            </select>
          </label>

          <label style={themedLabelStyle}>
            <span>Signal band</span>
            <select
              value={signalBand}
              onChange={evt => setSignalBand(evt.target.value)}
              style={themedInputStyle}
            >
              <option value="All">All</option>
              <option value="Weak">Weak (&le; -75 dBm)</option>
              <option value="Medium">Medium (-75 to -60 dBm)</option>
              <option value="Strong">Strong (&gt; -60 dBm)</option>
            </select>
          </label>

          <label style={{...themedLabelStyle, flexWrap: 'wrap', gap: 8}}>
              <span>Minimum signal</span>
              <span>{minSignal} dBm</span>
            </label>
            <input
              type="range"
              min={SIGNAL_MIN}
              max={SIGNAL_MAX}
              value={minSignal}
              onChange={evt => setMinSignal(Number(evt.target.value))}
              style={{...themedInputStyle, marginBottom: 0}}
            />

          <label style={{...themedLabelStyle, flexWrap: 'wrap', gap: 8}}>
              <span>Minimum networks</span>
              <span>{minNetworks}</span>
            </label>
            <input
              type="range"
              min={1}
              max={Math.max(1, maxNetworkCount)}
              value={minNetworks}
              onChange={evt => setMinNetworks(Number(evt.target.value))}
              style={{...themedInputStyle, marginBottom: 0}}
            />

          <label style={themedLabelStyle}>
            <span>Encryption type</span>
          </label>
          <select
            value={filterEncryption}
            onChange={evt => setFilterEncryption(evt.target.value)}
            style={themedInputStyle}
          >
            {encryptionTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <label style={themedLabelStyle}>
            <span>Search SSID</span>
          </label>
          <input
            type="text"
            value={filterSSID}
            placeholder="SSID substring"
            onChange={evt => setFilterSSID(evt.target.value)}
            style={themedInputStyle}
          />

          <div style={{display: 'grid', gap: 8}}>
            {isLoading ? (
              <div style={{color: isLightMode ? '#2563eb' : '#60a5fa'}}>Loading data…</div>
            ) : error ? (
              <div style={{color: '#f87171'}}>Error: {error}</div>
            ) : (
              <div style={{color: themeCaptionColor}}>
                Loaded {wifiHexagons.length} hexagons, showing {filteredHexagons.length}.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

      <div style={{...rightPanelStyle, background: themePanelBackground, border: themePanelBorder, color: themeTextColor}}>
        <div style={{display: 'grid', gap: 24}}>
          <div style={{fontSize: 16, fontWeight: 800, color: isLightMode ? '#1d4ed8' : '#7dd3fc', letterSpacing: '0.08em'}}>Dashboard</div>
          {selectedHexagon ? (
            <div style={{...themedLegendStyle, borderColor: themeAccent, overflow: 'hidden'}}>
              <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: themeTextColor}}>Selected hexagon</div>
              <div style={{display: 'grid', gap: 10, overflow: 'hidden'}}>
                <div style={{fontSize: 11, color: themeCaptionColor}}>Hexagon ID</div>
                <div style={{fontSize: 14, color: themeTextColor, wordBreak: 'break-all'}}>{selectedHexagon.hex}</div>
                <label style={{...labelStyle, color: themeCaptionColor}}>
                  <span style={{fontSize: 11}}>Network</span>
                  <span style={{fontSize: 11, color: themeAccent}}>{selectedHexagon.networks.length}</span>
                </label>
                <select
                  value={selectedNetworkIndex}
                  onChange={evt => setSelectedNetworkIndex(Number(evt.target.value))}
                  style={themedInputStyle}
                >
                  {selectedHexagon.networks.map((network, index) => (
                    <option key={`${network.bssid}-${index}`} value={index}>
                      {network.ssid || '<hidden>'} · {network.encryption || 'Unknown'}
                    </option>
                  ))}
                </select>
                {selectedNetwork ? (
                  <div style={{display: 'grid', gap: 6, padding: '12px 0'}}>
                    <div style={{fontSize: 12, color: themeCaptionColor}}>BSSID</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{selectedNetwork.bssid}</div>
                    <div style={{fontSize: 12, color: themeCaptionColor}}>Best signal</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{selectedNetwork['best signal']} dBm</div>
                    <div style={{fontSize: 12, color: themeCaptionColor}}>Encryption</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{selectedNetwork.encryption || 'Unknown'}</div>
                    <div style={{fontSize: 12, color: themeCaptionColor}}>Records</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{Array.isArray(selectedNetwork.records) ? selectedNetwork.records.length : 0}</div>
                  </div>
                ) : null}
                <div style={{display: 'grid', gap: 10, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.08)'}}>
                  <div style={{display: 'grid', gap: 4}}>
                    <div style={{fontSize: 11, color: themeCaptionColor}}>Open / secure</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{selectedOpenCount} open · {selectedSecureCount} secure</div>
                  </div>
                  <div style={{display: 'grid', gap: 4}}>
                    <div style={{fontSize: 11, color: themeCaptionColor}}>Average signal</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{selectedHexagon.averageSignal ?? 'N/A'} dBm</div>
                  </div>
                  <div style={{display: 'grid', gap: 4}}>
                    <div style={{fontSize: 11, color: themeCaptionColor}}>Records</div>
                    <div style={{fontSize: 14, color: themeTextColor}}>{selectedHexagon.recordCount}</div>
                  </div>
                  <div style={{display: 'grid', gap: 4}}>
                    <div style={{fontSize: 11, color: themeCaptionColor}}>Top SSIDs</div>
                    <div style={{display: 'grid', gap: 3}}>
                      {selectedHexagonSummary.map((network, index) => (
                        <div key={`${network.bssid}-${index}`} style={{fontSize: 13, color: themeTextColor}}>
                          {network.ssid || '<hidden>'} · {network.encryption || 'Unknown'} · {network['best signal']} dBm
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{display: 'grid', gap: 8}}>
                    <button
                      type="button"
                      onClick={flyToSelected}
                      style={{
                        width: '100%',
                        borderRadius: 14,
                        border: isLightMode ? '1px solid rgba(37, 99, 235, 0.75)' : '1px solid rgba(56, 189, 248, 0.75)',
                        background: isLightMode ? 'rgba(37, 99, 235, 0.12)' : 'rgba(14, 165, 233, 0.14)',
                        color: themeButtonText,
                        padding: '12px 14px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        cursor: 'pointer'
                      }}
                    >
                      Fly to selected
                    </button>
                    <button
                      type="button"
                      onClick={copySelectedInfo}
                      style={{
                        width: '100%',
                        borderRadius: 14,
                        border: isLightMode ? '1px solid rgba(37, 99, 235, 0.75)' : '1px solid rgba(34, 211, 238, 0.75)',
                        background: isLightMode ? 'rgba(37, 99, 235, 0.08)' : 'rgba(56, 189, 248, 0.12)',
                        color: themeButtonText,
                        padding: '12px 14px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        cursor: 'pointer'
                      }}
                    >
                      Copy selected info
                    </button>
                    <button
                      type="button"
                      onClick={downloadSelectedCsv}
                      style={{
                        width: '100%',
                        borderRadius: 14,
                        border: isLightMode ? '1px solid rgba(37, 99, 235, 0.75)' : '1px solid rgba(34, 211, 238, 0.75)',
                        background: isLightMode ? 'rgba(37, 99, 235, 0.08)' : 'rgba(14, 165, 233, 0.12)',
                        color: themeButtonText,
                        padding: '12px 14px',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        cursor: 'pointer'
                      }}
                    >
                      Export selected CSV
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          <div style={themedLegendStyle}>
            <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: themeTextColor}}>Legend</div>
            <div style={{display: 'grid', gap: 12}}>
              <div>
                <div style={{fontSize: 11, color: themeCaptionColor, marginBottom: 6}}>Signal color</div>
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
                          border: isLightMode ? '1px solid rgba(148, 163, 184, 0.35)' : '1px solid rgba(255,255,255,0.12)'
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{fontSize: 11, color: themeCaptionColor, marginTop: 6}}>Color maps from low (cold) to high (warm) signal.</div>
              </div>
              <div>
                <div style={{fontSize: 11, color: themeCaptionColor, marginBottom: 6}}>Height</div>
                <div style={{fontSize: 11, color: themeTextColor}}>Hexagon height is normalized by network count, max count is {maxNetworkCount}.</div>
              </div>
            </div>
          </div>

          <div style={themedLegendStyle}>
            <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: themeTextColor}}>Insights</div>
            <div style={{display: 'grid', gap: 12}}>
              <div style={{display: 'grid', gap: 4}}>
                <div style={{fontSize: 11, color: themeCaptionColor}}>Total h3:11 hexagons</div>
                <div style={{fontSize: 18, fontWeight: 700, color: themeAccent}}>{wifiHexagons.length}</div>
              </div>
              <div style={{display: 'grid', gap: 4}}>
                <div style={{fontSize: 11, color: themeCaptionColor}}>Total networks found</div>
                <div style={{fontSize: 18, fontWeight: 700, color: themeAccent}}>{wifiHexagons.reduce((sum, hexagon) => sum + hexagon.networkCount, 0)}</div>
              </div>
              <div style={{display: 'grid', gap: 4}}>
                <div style={{fontSize: 11, color: themeCaptionColor}}>Last refresh</div>
                <div style={{fontSize: 14, color: themeTextColor}}>{lastUpdated ? lastUpdated.toLocaleTimeString() : 'Waiting...'}</div>
              </div>
            </div>
          </div>

          <div style={themedLegendStyle}>
            <div style={{fontSize: 12, fontWeight: 700, marginBottom: 10, color: themeTextColor}}>Update history</div>
            <div style={{display: 'flex', gap: 10, alignItems: 'flex-end', minHeight: 96}}>
              {updateHistory.map((entry, index) => {
                const maxCount = Math.max(1, updateHistory[0]?.count || 1);
                const height = Math.min(96, Math.max(18, (entry.count / maxCount) * 96));
                return (
                  <div key={`${entry.time}-${index}`} style={{display: 'grid', alignItems: 'end', gap: 4, width: 36}}>
                    <div style={{height: `${height}px`, background: isLightMode ? 'linear-gradient(180deg, rgba(37,99,235,0.95), rgba(59,130,246,0.6))' : 'linear-gradient(180deg, rgba(56, 189, 248, 0.95), rgba(14, 165, 233, 0.6))', borderRadius: 10}} />
                    <div style={{fontSize: 10, color: themeCaptionColor, textAlign: 'center'}}>{new Date(entry.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
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
