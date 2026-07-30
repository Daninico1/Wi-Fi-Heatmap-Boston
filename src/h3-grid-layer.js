// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {TileLayer, H3HexagonLayer} from '@deck.gl/geo-layers';

import {getHexagonsInBoundingBox, getTileInfo, getMinZoom} from './h3-utils';

const defaultProps = {
  ...H3HexagonLayer.defaultProps,
  // H3 resolution
  resolution: {type: 'number', min: 0, max: 15, value: 5},
  // hexagon per tile at minZoom
  maxHexCount: {type: 'number', value: 1000}
};

export default class H3GridLayer extends CompositeLayer {
  renderLayers() {
    const {resolution, maxHexCount} = this.props;
    const minZoom = getMinZoom(resolution, maxHexCount);

    return new TileLayer(this.props, {
      minZoom,
      maxZoom: minZoom,
      getTileData: tile => getHexagonsInBoundingBox(tile.bbox, resolution),
      renderSubLayers: props => {
        const {tile} = props;
        getTileInfo(tile, resolution);

        return new H3HexagonLayer(props, {
          getHexagon: d => d,
          highPrecision: tile.hasMultipleFaces,
          centerHexagon: tile.centerHexagon
        });
      },
      updateTriggers: {
        getTileData: resolution
      }
    });
  }
}

H3GridLayer.layerName = 'H3GridLayer';
H3GridLayer.defaultProps = defaultProps;