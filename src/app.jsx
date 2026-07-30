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
import './styles.css';

// this can change depending on whatever we want the presentation to look like
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const MAP_VIEW = new MapView({repeat: true});


// boston commons looks the most recognizable
const BOSTON_COMMONS_VIEW_STATE = {
  longitude: -71.0656,
  latitude: 42.3558,
  zoom: 13.4,
  pitch: 45,
  bearing: 0
};

// initial view state
const INITIAL_VIEW_STATE = BOSTON_COMMONS_VIEW_STATE;

// changes the height of the hexagons
const SIGNAL_MIN = -100;
const SIGNAL_MAX = -40;
const MAX_ELEVATION_SCALE = 360;

// probably want to change this to be faster for the presentation
const AUTO_ROTATE_SPEED = 0.04;

// Configurable data URL (set VITE_WIFI_DATA_URL in env to override)
// Will need to fix this for deployment
const DATA_URL = import.meta.env.VITE_WIFI_DATA_URL || '/wifi-h3data.json';

// Kind of like normalization, used for hexagon height
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// can change this based on more parameters
function getWifiColor(hexagon) {
  if (hexagon.bestSignal == null) {
    return [146, 154, 171, 180];
  }

  const normalized = clamp((hexagon.bestSignal - SIGNAL_MIN) / (SIGNAL_MAX - SIGNAL_MIN), 0, 1);
  return [Math.round(255 * (1 - normalized)), 90, Math.round(255 * normalized), 180];
}

// fill color is based on network count right now
function getFillColor(hexagon, displayMode) {
  if (displayMode === 'density') {
    const intensity = clamp((hexagon.networkCount || 1) / Math.max(1, hexagon.networkCount || 1), 0, 1);
    return [Math.round(40 + 215 * intensity), Math.round(160 - 100 * intensity), 255, 200];
  }

  return getWifiColor(hexagon);
}

// checks if there are records for a network, and then averages the lats and lngs of the network
function getSelectedHexagonCenter(hexagon) {
  const records = hexagon.networks.flatMap(network => Array.isArray(network.records) ? network.records : []);
  if (!records.length) {
    return null;
  }

  const averageLng = records.reduce((sum, record) => sum + record.lng, 0) / records.length;
  const averageLat = records.reduce((sum, record) => sum + record.lat, 0) / records.length;
  return [averageLng, averageLat];
}

// csv function for records
function formatCsvRow(values) {
  return values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',');
}

// reads wifiData after array conversion
function processWifiData(wifiData) {

  // guard incase there isn't anything
  if (!wifiData || !Array.isArray(wifiData.hexagons)) {
    return {
      wifiHexagons: [],
      viewState: INITIAL_VIEW_STATE,
      encryptionTypes: [],
      maxNetworkCount: 1
    };
  }

  // get the networks, then get the best network from a reduce, then get the other stats
  const wifiHexagons = wifiData.hexagons.map(hexagon => {
    const networks = Array.isArray(hexagon.networks) ? hexagon.networks : [];
    const bestNetwork = networks.reduce((best, current) => {
      if (!best || current['best signal'] > best['best signal']) {
        return current;
      }
      return best;
    }, null);

    // using the reduce function for totals
    const recordCount = networks.reduce((sum, network) => {
      return sum + (Array.isArray(network.records) ? network.records.length : 0);
    }, 0);

    // signal values are from the records dBm
    const signalValues = networks.flatMap(network =>
      Array.isArray(network.records) ? network.records.map(record => record['dBm']) : []
    ).filter(signal => typeof signal === 'number');

    // average signal is calculated from signalVAlue length divided
    const averageSignal = signalValues.length
      ? Math.round(signalValues.reduce((sum, signal) => sum + signal, 0) / signalValues.length)
      : null;

    // get encryption types
    const encryptionTypes = Array.from(
      new Set(networks.map(network => network.encryption).filter(Boolean))
    );

    // get open networks using encryption
    const openNetworkCount = networks.reduce((sum, network) => {
      const encryptionString = typeof network.encryption === 'string' ? network.encryption.toLowerCase() : '';
      return sum + (/open|none|wep|unencrypted/.test(encryptionString) ? 1 : 0);
    }, 0);

    // risk score (kind of arbitrary but whatever)
    const riskScore = Math.round(
      clamp(openNetworkCount / Math.max(1, networks.length), 0, 1) * 0.8 * 100 +
      clamp(1 - (bestNetwork ? (bestNetwork['best signal'] - SIGNAL_MIN) / (SIGNAL_MAX - SIGNAL_MIN) : 0), 0, 1) * 0.2 * 100
    );

    // the top record is the best network and it's first record (or null if none [ternary hell])
    const topRecord = bestNetwork && Array.isArray(bestNetwork.records) ? bestNetwork.records[0] : null;

    // return everything calculated
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

  return {wifiHexagons, viewState, encryptionTypes, maxNetworkCount}; // returns all the data (don't complain that view state is in here)
}

export default function App() {

  // it's all reactive!
  const [wifiHexagons, setWifiHexagons] = useState([]);
  const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showLayer, setShowLayer] = useState(true);
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
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [maxNetworkCount, setMaxNetworkCount] = useState(1);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [updateHistory, setUpdateHistory] = useState([]);
  const [selectedHexagon, setSelectedHexagon] = useState(null);
  const [selectedNetworkIndex, setSelectedNetworkIndex] = useState(0);
  const [userInteracted, setUserInteracted] = useState(false);
  const initialViewStateRef = useRef(null);
  const rotateRef = useRef(0);

  // this uses await to get the wifi data from the json file, it's implemented this way so we can view semi-realtime updates while scanning in the future
  const loadWifiData = useCallback(async () => {
    // flags
    setIsLoading(true);
    setError(null);

    // get the data, and if it fails then return nothing...
    try {
      const response = await fetch(DATA_URL, {cache: 'no-store'});

      // ... if the response is not okay then return an error
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Read raw text to log size and catch partial/truncated files more clearly
      const raw = await response.clone().text();
      console.debug(`fetch ${DATA_URL} -> ${raw.length} chars`);
      const json = JSON.parse(raw);
      const {wifiHexagons, viewState, encryptionTypes, maxNetworkCount} = processWifiData(json);
      console.debug('processWifiData ->', {wifiHexagons: wifiHexagons.length, maxNetworkCount, viewState: !!viewState});
      setWifiHexagons(wifiHexagons);
      setEncryptionTypes(['All', ...encryptionTypes]);
      setMaxNetworkCount(maxNetworkCount);

      // 
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
    loadWifiData();
    const interval = setInterval(loadWifiData, 30000);

    return () => {
      clearInterval(interval);
    };
  }, [loadWifiData]);

  useEffect(() => {
    document.body.classList.toggle('light', theme === 'light');
  }, [theme]);

  const autoRotateActive = autoRotateEnabled && !userInteracted;
  const isLightMode = theme === 'light';
  const mapStyleUrl = isLightMode ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json' : MAP_STYLE;

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

  // fly to the hexagon lat and long (this uses the selected hexagon center values)
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

  // this is the actual webpage from this point forward (basically just hodgpodged a bunch of components together and edited in our data)
  // using maplibre for this site, not openstreetmap (it's not really that different)
  return (
    <>
      <DeckGL
        className="map-deckgl"
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
        layers={[wifiLayer, selectedHexagonLayer].filter(Boolean)}
        onViewStateChange={onViewStateChange}
        onClick={info => {
          if (info.object) {
            setSelectedHexagon(info.object);
            setSelectedNetworkIndex(0);
          }
        }}
        onInteractionStateChange={({isDragging, isPanning}) => {
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

      <button
        type="button"
        className="mobile-panel-toggle button button-soft"
        onClick={() => setPanelsVisible(prev => !prev)}
        aria-expanded={panelsVisible}
      >
        {panelsVisible ? 'Hide panels' : 'Show panels'}
      </button>

      <section className={`panel panel-left ${panelsVisible ? '' : 'panel-hidden'}`}>
        <div className="panel-header">
          <div className="panel-title">Wi-Fi Map Boston</div>
          <div className="panel-subtitle">Live refresh every 30 seconds. Explore signal strength, network density, and encryption in a cyber grid.</div>
        </div>

        <div className="section">
          <div className="button-group">
            <button type="button" onClick={resetCamera} className="button button-soft">
              Reset camera
            </button>
            <button type="button" onClick={() => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))} className="button button-theme">
              {isLightMode ? 'Dark mode' : 'Light mode'}
            </button>
            <button type="button" onClick={() => setAutoRotateEnabled(prev => !prev)} className="button button-soft">
              {autoRotateEnabled ? 'Pause spin' : 'Resume spin'}
            </button>
            <div className={autoRotateActive ? 'status-text' : 'status-warning'}>
              {autoRotateActive ? 'Auto-rotate active' : autoRotateEnabled ? 'Paused after interaction' : 'Auto-rotate disabled'}
            </div>
          </div>

          <div className="panel-group">
            <label className="control-label">
              <span>Show Wi-Fi layer</span>
              <input
                type="checkbox"
                checked={showLayer}
                onChange={evt => setShowLayer(evt.target.checked)}
                className="control-checkbox"
              />
            </label>

            <label className="control-label">
              <span>Base display mode</span>
              <select value={displayMode} onChange={evt => setDisplayMode(evt.target.value)} className="control-select">
                <option value="signal">Signal</option>
                <option value="density">Density</option>
              </select>
            </label>

            <label className="control-label">
              <span>Base display mode</span>
              <select value={displayMode} onChange={evt => setDisplayMode(evt.target.value)} className="control-select">
                <option value="signal">Signal</option>
                <option value="density">Density</option>
              </select>
            </label>

            <label className="control-label">
              <span>Security filter</span>
              <select value={securityFilter} onChange={evt => setSecurityFilter(evt.target.value)} className="control-select">
                <option value="All">All</option>
                <option value="Open">Open</option>
                <option value="Encrypted">Encrypted</option>
              </select>
            </label>

            <label className="control-label">
              <span>Signal band</span>
              <select value={signalBand} onChange={evt => setSignalBand(evt.target.value)} className="control-select">
                <option value="All">All</option>
                <option value="Weak">Weak (&le; -75 dBm)</option>
                <option value="Medium">Medium (-75 to -60 dBm)</option>
                <option value="Strong">Strong (&gt; -60 dBm)</option>
              </select>
            </label>

            <label className="control-label label-wrap">
              <span>Minimum signal</span>
              <span>{minSignal} dBm</span>
            </label>
            <input
              type="range"
              min={SIGNAL_MIN}
              max={SIGNAL_MAX}
              value={minSignal}
              onChange={evt => setMinSignal(Number(evt.target.value))}
              className="control-range range-input"
            />

            <label className="control-label label-wrap">
              <span>Minimum networks</span>
              <span>{minNetworks}</span>
            </label>
            <input
              type="range"
              min={1}
              max={Math.max(1, maxNetworkCount)}
              value={minNetworks}
              onChange={evt => setMinNetworks(Number(evt.target.value))}
              className="control-range range-input"
            />

            <label className="control-label">
              <span>Encryption type</span>
            </label>
            <select value={filterEncryption} onChange={evt => setFilterEncryption(evt.target.value)} className="control-select">
              {encryptionTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <label className="control-label">
              <span>Search SSID</span>
            </label>
            <input
              type="text"
              value={filterSSID}
              placeholder="SSID substring"
              onChange={evt => setFilterSSID(evt.target.value)}
              className="control-input"
            />

            <div className="notice-text">
              {isLoading ? (
                <span className="status-text">Loading data…</span>
              ) : error ? (
                <span className="status-warning">Error: {error}</span>
              ) : (
                <span>Loaded {wifiHexagons.length} hexagons, showing {filteredHexagons.length}.</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <aside className={`panel panel-right ${panelsVisible ? '' : 'panel-hidden'}`}>
        <div className="panel-group">
          <div className="panel-section-title">Dashboard</div>

          {selectedHexagon ? (
            <section className="legend">
              <div className="legend-title">Selected hexagon</div>
              <div className="legend-content">
                <div className="detail-row">
                  <span className="detail-key">Hexagon ID</span>
                  <span className="detail-value break-all">{selectedHexagon.hex}</span>
                </div>
                <label className="control-label">
                  <span className="detail-key">Network</span>
                  <span className="detail-key accent-text">{selectedHexagon.networks.length}</span>
                </label>
                <select
                  value={selectedNetworkIndex}
                  onChange={evt => setSelectedNetworkIndex(Number(evt.target.value))}
                  className="control-select"
                >
                  {selectedHexagon.networks.map((network, index) => (
                    <option key={`${network.bssid}-${index}`} value={index}>
                      {network.ssid || '<hidden>'} · {network.encryption || 'Unknown'}
                    </option>
                  ))}
                </select>

                {selectedNetwork ? (
                  <div className="detail-group">
                    <div className="detail-row">
                      <span className="detail-key">BSSID</span>
                      <span className="detail-value">{selectedNetwork.bssid}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-key">Best signal</span>
                      <span className="detail-value">{selectedNetwork['best signal']} dBm</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-key">Encryption</span>
                      <span className="detail-value">{selectedNetwork.encryption || 'Unknown'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-key">Records</span>
                      <span className="detail-value">{Array.isArray(selectedNetwork.records) ? selectedNetwork.records.length : 0}</span>
                    </div>
                  </div>
                ) : null}

                <div className="detail-group">
                  <div className="detail-row">
                    <span className="detail-key">Open / secure</span>
                    <span className="detail-value">{selectedOpenCount} open · {selectedSecureCount} secure</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Average signal</span>
                    <span className="detail-value">{selectedHexagon.averageSignal ?? 'N/A'} dBm</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Records</span>
                    <span className="detail-value">{selectedHexagon.recordCount}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-key">Top SSIDs</span>
                    <div className="detail-list">
                      {selectedHexagonSummary.map((network, index) => (
                        <div key={`${network.bssid}-${index}`} className="detail-text">
                          {network.ssid || '<hidden>'} · {network.encryption || 'Unknown'} · {network['best signal']} dBm
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="button-group">
                  <button type="button" className="button button-small button-outline" onClick={flyToSelected}>
                    Fly to selected
                  </button>
                  <button type="button" className="button button-small button-outline" onClick={copySelectedInfo}>
                    Copy selected info
                  </button>
                  {/* <button type="button" className="button button-small button-outline" onClick={downloadSelectedCsv}>
                    Export selected CSV
                  </button> */}
                </div>
              </div>
            </section>
          ) : null}

          <section className="legend">
            <div className="legend-title">Legend</div>
            <div className="legend-content">
              <div>
                <div className="legend-label">Signal color</div>
                <div className="legend-row">
                  {signalLegendStops.map(value => {
                    const color = getWifiColor({bestSignal: value});
                    return (
                      <div
                        key={value}
                        title={`${value} dBm`}
                        className="legend-swatch"
                        style={{
                          background: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255})`,
                          borderColor: isLightMode ? 'rgba(148, 163, 184, 0.35)' : 'rgba(255,255,255,0.12)'
                        }}
                      />
                    );
                  })}
                </div>
                <div className="legend-label">Color maps from worse (red) to best (blue) signal.</div>
              </div>
              <div>
                <div className="legend-label">Height</div>
                <div className="detail-value">Hexagon height is normalized by network count, max count is {maxNetworkCount}.</div>
              </div>
            </div>
          </section>

          <section className="legend">
            <div className="legend-title">Insights</div>
            <div className="legend-content">
              <div className="detail-row">
                <span className="legend-label">Total h3:11 hexagons</span>
                <span className="insight-value">{wifiHexagons.length}</span>
              </div>
              <div className="detail-row">
                <span className="legend-label">Total networks found</span>
                <span className="insight-value">{wifiHexagons.reduce((sum, hexagon) => sum + hexagon.networkCount, 0)}</span>
              </div>
              {/* <div className="detail-row">
                <span className="legend-label">Last refresh</span>
                <span className="detail-value">{lastUpdated ? lastUpdated.toLocaleTimeString() : 'Waiting...'}</span>
              </div> */}
            </div>
          </section>

          {/* <section className="legend">
            <div className="legend-title">Update history</div>
            <div className="history-row" style={{display: 'flex', gap: 10, alignItems: 'flex-end', minHeight: 96}}>
              {updateHistory.map((entry, index) => {
                const maxCount = Math.max(1, updateHistory[0]?.count || 1);
                const height = Math.min(96, Math.max(18, (entry.count / maxCount) * 96));
                return (
                  <div key={`${entry.time}-${index}`} className="history-bar">
                    <div
                      className="history-line"
                      style={{
                        height: `${height}px`,
                        background: isLightMode
                          ? 'linear-gradient(180deg, rgba(37,99,235,0.95), rgba(59,130,246,0.6))'
                          : 'linear-gradient(180deg, rgba(56, 189, 248, 0.95), rgba(14, 165, 233, 0.6))'
                      }}
                    />
                    <div className="history-date">{new Date(entry.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
                  </div>
                );
              })}
            </div>
          </section> */}
        </div>
      </aside>
    </>
  );
}

// the document
const container = document.getElementById('root') || document.body.appendChild(document.createElement('div'));
createRoot(container).render(<App />);
