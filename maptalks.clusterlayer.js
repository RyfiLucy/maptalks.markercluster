(function () {
    'use strict';

    var maptalks;

    var nodeEnv = typeof module !== 'undefined' && module.exports;
    if (nodeEnv)  {
        maptalks = require('maptalks');
    } else {
        maptalks = window.maptalks;
    }
    //
    function getGradient(color) {
        return {
            type : 'radial',
            colorStops : [
                [0.00, 'rgba(' + color.join() + ', 0)'],
                [0.50, 'rgba(' + color.join() + ', 1)'],
                [1.00, 'rgba(' + color.join() + ', 1)']
            ]
        };
    }

    var textSymbol = {
        'textFaceName'      : '"microsoft yahei"',
        'textSize'          : 14
    };

    var symbol = {
        'markerFill' : {property:'count', type:'interval', stops: [[0, getGradient([181, 226, 140])], [9, getGradient([241, 211, 87])], [99, getGradient([253, 156, 115])]]},
        'markerFillOpacity' : 1,
        'markerLineOpacity' : 0,
        'markerWidth' : {property:'count', type:'interval', stops: [[0, 20], [9, 30], [99, 40]]},
        'markerHeight' : 40
    };

    maptalks.ClusterLayer = maptalks.VectorLayer.extend({
        options: {
            'maxClusterRadius' : 80,
            'geometryEvents' : false
        },

        addMarker: function (markers) {
            return this.addGeometry(markers);
        },

        addGeometry: function (markers) {
            for (var i = 0, len = markers.length; i <= len; i++) {
                if (!markers[i] instanceof maptalks.Marker) {
                    throw new Error('Only a point(Marker) can be added into a ClusterLayer');
                }
            }
            return maptalks.VectorLayer.prototype.addGeometry.apply(this, arguments);
        }

    });

    /**
     * Export the ClusterLayer's profile JSON.
     * @return {Object} layer's profile JSON
     */
    maptalks.ClusterLayer.prototype.toJSON = function () {
        var json = maptalks.VectorLayer.prototype.toJSON.call(this);
        json['type'] = 'ClusterLayer';
        return json;
    };

    /**
     * Reproduce a ClusterLayer from layer's profile JSON.
     * @param  {Object} json - layer's profile JSON
     * @return {maptalks.ClusterLayer}
     * @static
     * @private
     * @function
     */
    maptalks.ClusterLayer._fromJSON = function (json) {
        if (!json || json['type'] !== 'ClusterLayer') { return null; }
        var layer = new maptalks.ClusterLayer(json['id'], json['options']);
        var geoJSONs = json['geometries'];
        var geometries = [],
            geo;
        for (var i = 0; i < geoJSONs.length; i++) {
            geo = maptalks.Geometry.fromJSON(geoJSONs[i]);
            if (geo) {
                geometries.push(geo);
            }
        }
        layer.addGeometry(geometries);
        return layer;
    };

    maptalks.renderer.clusterlayer = {};

    maptalks.renderer.clusterlayer.Canvas = maptalks.renderer.Canvas.extend({

        initialize: function (layer) {
            this._layer = layer;
            var symbolizer = maptalks.symbolizer.VectorMarkerSymbolizer;
            var style = symbolizer.translateLineAndFill(symbol);
            var argFn =  maptalks.Util.bind(function () {
                return [this.getMap().getZoom(), this._currentGrid];
            }, this);
            this._style = maptalks.Util.loadFunctionTypes(style, argFn);
            this._symbol = maptalks.Util.loadFunctionTypes(symbol, argFn);
            var id = maptalks.internalLayerPrefix + '_grid_' + maptalks.Util.GUID();
            this._markerLayer = new maptalks.VectorLayer(id).addTo(layer.getMap());
            this._computeGrid();
        },

        draw: function () {
            this._prepareCanvas();
            var ctx = this._context,
                font = maptalks.symbolizer.TextMarkerSymbolizer.getFont(textSymbol);
            this._markerLayer.clear();
            maptalks.Canvas.prepareCanvasFont(ctx, textSymbol);
            var map = this.getMap(),
                size = map.getSize(),
                extent = new maptalks.PointExtent(0, 0, size['width'], size['height']),
                symbol = this._symbol,
                markers = [],
                pt, pExt, width;
            for (var p in this._grid) {
                this._currentGrid = this._grid[p];
                if (this._currentGrid['count'] === 1) {
                    markers.push(this._currentGrid['geo'].copy().copyEventListeners(this._currentGrid['geo']));
                    continue;
                }
                width = symbol['markerWidth'];
                pt = map._prjToContainerPoint(this._grid[p]['center'])._round();
                pExt = new maptalks.PointExtent(pt.substract(width, width), pt.add(width, width));
                if (!extent.intersects(pExt)) {
                    continue;
                }
                this._style['polygonGradientExtent'] = pExt;
                maptalks.Canvas.prepareCanvas(ctx, this._style);
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, symbol['markerWidth'], 0, 2 * Math.PI);
                maptalks.Canvas._stroke(ctx, symbol['markerLineOpacity']);
                maptalks.Canvas.fillCanvas(ctx, symbol['markerFillOpacity']);

                if (!this._grid[p]['size']) {
                    this._grid[p]['size'] = maptalks.StringUtil.stringLength(this._grid[p]['count'], font).toPoint()._multi(1 / 2);
                }
                maptalks.Canvas.fillText(ctx, this._grid[p]['count'], pt.substract(this._grid[p]['size'])._round(), '#000');
            }
            this._markerLayer.addGeometry(markers);
            this._complete();
        },

        show: function () {
            this._markerLayer.show();
            maptalks.renderer.Canvas.prototype.show.call(this);
        },

        hide: function () {
            this._markerLayer.hide();
            maptalks.renderer.Canvas.prototype.hide.call(this);
        },

        setZIndex: function (z) {
            this._markerLayer.setZIndex(z);
            maptalks.renderer.Canvas.prototype.setZIndex.call(this, z);
        },

        _computeGrid: function () {
            var map = this.getMap(),
                zoom = map.getZoom();
            if (!this._gridCache) {
                this._gridCache = {};
            }
            var pre = map._getResolution(map.getMinZoom()) > map._getResolution(map.getMaxZoom()) ? zoom - 1 : zoom + 1;
            if (this._gridCache[pre] && this._gridCache[pre].length === this._layer.getCount()) {
                this._gridCache[zoom] = this._gridCache[pre];
            }
            if (!this._gridCache[zoom]) {
                this._gridCache[zoom] = this._computeZoomGrid(zoom);
            }
            this._grid = this._gridCache[zoom];
        },

        _computeZoomGrid: function (zoom) {
            var map = this.getMap(),
                t = map._getResolution(zoom) * this._layer.options['maxClusterRadius'] * 2,
                preCache = this._gridCache[zoom - 1],
                preT = map._getResolution(zoom - 1) ? map._getResolution(zoom - 1) * this._layer.options['maxClusterRadius'] * 2 : null;
            var extent = this._markerExtent, points = this._markerPoints;
            if (!extent || !points) {
                if (!points) {
                    points = [];
                }
                var c;
                this._layer.forEach(function (g) {
                    c = g._getPrjCoordinates();
                    if (!extent) {
                        extent = g._getPrjExtent();
                    } else {
                        extent = extent._combine(g._getPrjExtent());
                    }
                    points.push({
                        x : c.x,
                        y : c.y,
                        id : g._getInternalId(),
                        geometry : g
                    });
                }, this);
                this._markerExtent = extent;
                this._markerPoints = points;
            }
            if (!extent) {
                return null;
            }
            var grid = {},
                min = extent.getMin(),
                gx, gy, key,
                pgx, pgy, pkey;
            for (var i = 0, len = points.length; i < len; i++) {
                gx = Math.floor((points[i].x - min.x) / t);
                gy = Math.floor((points[i].y - min.y) / t);
                key = gx + '_' + gy;
                if (!grid[key]) {
                    grid[key] = {
                        'sum' : new maptalks.Coordinate(points[i].x, points[i].y),
                        'center' : new maptalks.Coordinate(points[i].x, points[i].y),
                        'count' : 1,
                        'geo' : points[i].geometry
                    };
                    if (preT && preCache) {
                        pgx = Math.floor((points[i].x - min.x) / preT);
                        pgy = Math.floor((points[i].y - min.y) / preT);
                        pkey = pgx + '_' + pgy;
                        parent = preCache[pkey];
                        grid[key]['parent'] = parent;
                    }
                } else {
                    grid[key]['sum']._add(new maptalks.Coordinate(points[i].x, points[i].y));
                    grid[key]['count']++;
                    grid[key]['center'] = grid[key]['sum'].multi(1 / grid[key]['count']);

                }
            }

            return grid;
        },

        _onZoomEnd: function () {
            this._computeGrid();
            maptalks.renderer.Canvas.prototype._onZoomEnd.apply(this, arguments);
        }
    });

    maptalks.ClusterLayer.registerRenderer('canvas', maptalks.renderer.clusterlayer.Canvas);

    if (nodeEnv) {
        exports = module.exports = maptalks.ClusterLayer;
    }
})();