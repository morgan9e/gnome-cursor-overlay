'use strict';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {findCursorDir, loadCursorPng, getCursorTheme} from './xcursor.js';

const CAIRO_OPERATOR_CLEAR = 0;
const CAIRO_OPERATOR_OVER = 2;

function parseColor(hex) {
    return [
        parseInt(hex.slice(1, 3), 16) / 255,
        parseInt(hex.slice(3, 5), 16) / 255,
        parseInt(hex.slice(5, 7), 16) / 255,
    ];
}

export default class CursorOverlayExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._lastX = null;
        this._lastY = null;
        this._mode = null;
        this._offsetX = 0;
        this._offsetY = 0;
        this._positionInvalidatedId = null;
        this._timerId = null;
        this._monitorChangedId = null;
        this._connectorMap = new Map();
        this._updateMonitorPolicy();

        this._buildMonitorMap();
        this._setupOverlay();
        this._startTracking();

        this._settingsChangedId = this._settings.connect('changed', () => {
            this._stopTracking();
            this._teardownOverlay();
            this._updateMonitorPolicy();
            this._setupOverlay();
            this._startTracking();
        });

        try {
            const mm = global.backend.get_monitor_manager();
            this._monitorChangedId = mm.connect('monitors-changed', () => {
                this._buildMonitorMap();
            });
        } catch { /* unavailable */ }
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }

        if (this._monitorChangedId) {
            try { global.backend.get_monitor_manager().disconnect(this._monitorChangedId); }
            catch { /* ignore */ }
            this._monitorChangedId = null;
        }

        this._stopTracking();
        this._teardownOverlay();
        this._settings = null;
        this._connectorMap = null;
        this._enabledSet = null;
        this._disabledSet = null;
    }

    _setupOverlay() {
        this._mode = this._settings.get_string('overlay-mode');

        switch (this._mode) {
        case 'circle':  this._setupCircle(); break;
        case 'cursor':  this._setupCursor(); break;
        case 'image':   this._setupImage();  break;
        default:        this._setupCircle(); break;
        }
    }

    _teardownOverlay() {
        if (this._overlay) {
            const parent = this._overlay.get_parent();
            if (parent)
                parent.remove_child(this._overlay);
            this._overlay.destroy();
            this._overlay = null;
        }
        this._lastX = null;
        this._lastY = null;
    }

    _updateMonitorPolicy() {
        this._enabledSet = new Set(this._settings.get_strv('enabled-monitors'));
        this._disabledSet = new Set(this._settings.get_strv('disabled-monitors'));
        this._disableNew = this._settings.get_boolean('disable-new-monitors');
        this._enableMeta = this._settings.get_boolean('enable-meta-monitors');
        this._lastMonitorIdx = -1;
        this._lastMonitorDisabled = false;
        this._needsMonitorCheck = this._disabledSet.size > 0
            || this._enabledSet.size > 0
            || this._disableNew;
        if (this._connectorMap?.size > 0)
            this._rebuildDisabledCache();
    }

    _buildMonitorMap() {
        this._connectorMap = new Map();
        this._metaSet = new Set();
        try {
            const mm = global.backend.get_monitor_manager();
            for (const monitor of mm.get_monitors()) {
                const connector = monitor.get_connector();
                const idx = mm.get_monitor_for_connector(connector);
                if (idx < 0) continue;
                this._connectorMap.set(idx, connector);
                try {
                    const vendor = monitor.get_vendor();
                    const name = monitor.get_display_name();
                    if ((vendor && vendor.includes('Meta'))
                        || (name && name.includes('Meta'))
                        || (connector && connector.includes('Meta')))
                        this._metaSet.add(connector);
                } catch { /* no vendor/name API */ }
            }
        } catch { /* unavailable */ }
        this._rebuildDisabledCache();
    }

    _rebuildDisabledCache() {
        this._disabledCache = new Map();
        for (const [idx, connector] of this._connectorMap) {
            let disabled;
            if (this._enabledSet.has(connector))
                disabled = false;
            else if (this._disabledSet.has(connector))
                disabled = true;
            else if (!this._disableNew)
                disabled = false;
            else if (this._enableMeta && this._metaSet.has(connector))
                disabled = false;
            else
                disabled = true;
            this._disabledCache.set(idx, disabled);
        }
    }

    _startTracking() {
        try {
            const tracker = global.backend.get_cursor_tracker();
            this._positionInvalidatedId = tracker.connect(
                'position-invalidated', () => this._updatePosition()
            );
            this._updatePosition();
            return;
        } catch { /* fall back to polling */ }

        const pollMs = Math.round(1000 / this._settings.get_int('poll-rate'));
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, pollMs, () => {
            this._updatePosition();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopTracking() {
        if (this._positionInvalidatedId) {
            try { global.backend.get_cursor_tracker().disconnect(this._positionInvalidatedId); }
            catch { /* ignore */ }
            this._positionInvalidatedId = null;
        }

        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _updatePosition() {
        if (!this._overlay)
            return;

        const [mx, my] = global.get_pointer();

        if (this._needsMonitorCheck && this._disabledCache?.size > 0) {
            const monIdx = global.display.get_current_monitor();
            if (monIdx !== this._lastMonitorIdx) {
                this._lastMonitorIdx = monIdx;
                this._lastMonitorDisabled = this._disabledCache.get(monIdx) ?? this._disableNew;
            }
            if (this._lastMonitorDisabled) {
                this._overlay.hide();
                return;
            }
            this._overlay.show();
        }

        const cx = mx - this._offsetX;
        const cy = my - this._offsetY;

        if (this._lastX !== cx || this._lastY !== cy) {
            this._overlay.set_position(cx, cy);
            this._lastX = cx;
            this._lastY = cy;
            global.stage.set_child_above_sibling(this._overlay, null);
        }
    }

    _setupCircle() {
        const radius = this._settings.get_int('circle-radius');
        const stroke = this._settings.get_int('circle-stroke-width');
        const [cr, cg, cb] = parseColor(this._settings.get_string('circle-color'));
        const alpha = this._settings.get_int('circle-opacity') / 100;
        const size = (radius + stroke) * 2;

        this._offsetX = radius + stroke;
        this._offsetY = radius + stroke;

        this._overlay = new St.DrawingArea({
            width: size, height: size,
            reactive: false, can_focus: false, track_hover: false,
        });
        this._overlay.set_style('background-color: transparent;');

        this._overlay.connect('repaint', area => {
            const ctx = area.get_context();
            const [w, h] = area.get_surface_size();
            ctx.setOperator(CAIRO_OPERATOR_CLEAR);
            ctx.paint();
            ctx.setOperator(CAIRO_OPERATOR_OVER);
            ctx.setSourceRGBA(cr, cg, cb, alpha);
            ctx.setLineWidth(stroke);
            ctx.arc(w / 2, h / 2, radius, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.$dispose();
        });

        global.stage.add_child(this._overlay);
        global.stage.set_child_above_sibling(this._overlay, null);
    }

    _setupCursor() {
        const cursorSize = this._settings.get_int('cursor-size');
        const colorHex = this._settings.get_string('cursor-color');
        const opacity = this._settings.get_int('cursor-opacity');

        const {theme} = getCursorTheme();
        const cursorDir = findCursorDir(theme);
        if (!cursorDir) { this._setupCircle(); return; }

        const info = loadCursorPng(cursorDir, 'default', cursorSize, colorHex);
        if (!info) { this._setupCircle(); return; }

        this._overlay = new St.Icon({
            gicon: Gio.icon_new_for_string(info.path),
            icon_size: info.width,
            reactive: false, can_focus: false, track_hover: false,
            opacity: Math.round(opacity * 2.55),
        });

        this._offsetX = info.xhot;
        this._offsetY = info.yhot;

        global.stage.add_child(this._overlay);
        global.stage.set_child_above_sibling(this._overlay, null);
    }

    _setupImage() {
        const imagePath = this._settings.get_string('image-path');
        if (!imagePath || !GLib.file_test(imagePath, GLib.FileTest.EXISTS)) {
            this._setupCircle();
            return;
        }

        const imageSize = this._settings.get_int('image-size');
        const opacity = this._settings.get_int('image-opacity');

        this._overlay = new St.Icon({
            gicon: Gio.icon_new_for_string(imagePath),
            icon_size: imageSize,
            reactive: false, can_focus: false, track_hover: false,
            opacity: Math.round(opacity * 2.55),
        });

        this._offsetX = imageSize / 2;
        this._offsetY = imageSize / 2;

        global.stage.add_child(this._overlay);
        global.stage.set_child_above_sibling(this._overlay, null);
    }
}
