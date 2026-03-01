'use strict';

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const XCURSOR_MAGIC = 0x72756358;
const XCURSOR_IMAGE_TYPE = 0xfffd0002;

function findCursorDir(theme) {
    const paths = [
        `${GLib.get_home_dir()}/.local/share/icons/${theme}/cursors`,
        `${GLib.get_home_dir()}/.icons/${theme}/cursors`,
        `/usr/share/icons/${theme}/cursors`,
        `/usr/local/share/icons/${theme}/cursors`,
    ];

    for (const p of paths) {
        if (GLib.file_test(p, GLib.FileTest.IS_DIR))
            return p;
    }

    if (theme !== 'default' && theme !== 'Adwaita') {
        for (const fallback of ['Adwaita', 'default']) {
            const dir = findCursorDir(fallback);
            if (dir) return dir;
        }
    }

    return null;
}

function parseXcursor(filePath, targetSize) {
    const file = Gio.File.new_for_path(filePath);
    if (!file.query_exists(null))
        return null;

    let bytes;
    try {
        const [ok, contents] = file.load_contents(null);
        if (!ok) return null;
        bytes = contents;
    } catch {
        return null;
    }

    if (bytes.length < 16)
        return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const magic = view.getUint32(0, true);
    if (magic !== XCURSOR_MAGIC)
        return null;

    const headerSize = view.getUint32(4, true);
    const ntoc = view.getUint32(12, true);

    const images = [];
    for (let i = 0; i < ntoc; i++) {
        const tocOffset = headerSize + i * 12;
        if (tocOffset + 12 > bytes.length) break;

        const type = view.getUint32(tocOffset, true);
        const nominalSize = view.getUint32(tocOffset + 4, true);
        const filePos = view.getUint32(tocOffset + 8, true);

        if (type === XCURSOR_IMAGE_TYPE)
            images.push({nominalSize, filePos});
    }

    if (images.length === 0)
        return null;

    let best = images[0];
    let bestDiff = Math.abs(best.nominalSize - targetSize);
    for (let i = 1; i < images.length; i++) {
        const diff = Math.abs(images[i].nominalSize - targetSize);
        if (diff < bestDiff || (diff === bestDiff && images[i].nominalSize > best.nominalSize)) {
            best = images[i];
            bestDiff = diff;
        }
    }

    const pos = best.filePos;
    if (pos + 36 > bytes.length)
        return null;

    const width = view.getUint32(pos + 16, true);
    const height = view.getUint32(pos + 20, true);
    const xhot = view.getUint32(pos + 24, true);
    const yhot = view.getUint32(pos + 28, true);

    const pixelDataOffset = pos + 36;
    const pixelDataSize = width * height * 4;
    if (pixelDataOffset + pixelDataSize > bytes.length)
        return null;

    const pixels = new Uint8Array(bytes.buffer, bytes.byteOffset + pixelDataOffset, pixelDataSize);
    return {width, height, xhot, yhot, pixels: new Uint8Array(pixels)};
}

// Colorize: tint * luminance (ARGB32 LE premultiplied, in-memory BGRA)
function tintPixels(pixels, colorHex) {
    const tr = parseInt(colorHex.slice(1, 3), 16);
    const tg = parseInt(colorHex.slice(3, 5), 16);
    const tb = parseInt(colorHex.slice(5, 7), 16);

    const out = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];
        if (a === 0)
            continue;
        const srcR = pixels[i + 2] * 255 / a;
        const srcG = pixels[i + 1] * 255 / a;
        const srcB = pixels[i + 0] * 255 / a;
        const lum = (0.299 * srcR + 0.587 * srcG + 0.114 * srcB) / 255;
        out[i + 0] = Math.round(tb * lum * a / 255);
        out[i + 1] = Math.round(tg * lum * a / 255);
        out[i + 2] = Math.round(tr * lum * a / 255);
        out[i + 3] = a;
    }
    return out;
}

const CURSOR_NAMES = {
    'default': ['default', 'left_ptr'],
    'context-menu': ['context-menu', 'left_ptr'],
    'help': ['help', 'left_ptr'],
    'pointer': ['pointer', 'hand2'],
    'progress': ['progress', 'left_ptr_watch'],
    'wait': ['wait', 'watch'],
    'cell': ['cell', 'plus'],
    'crosshair': ['crosshair', 'cross'],
    'text': ['text', 'xterm'],
    'vertical-text': ['vertical-text'],
    'alias': ['alias'],
    'copy': ['copy'],
    'move': ['move', 'fleur'],
    'no-drop': ['no-drop'],
    'not-allowed': ['not-allowed'],
    'grab': ['grab', 'hand1'],
    'grabbing': ['grabbing'],
    'e-resize': ['e-resize', 'right_side'],
    'n-resize': ['n-resize', 'top_side'],
    'ne-resize': ['ne-resize', 'top_right_corner'],
    'nw-resize': ['nw-resize', 'top_left_corner'],
    's-resize': ['s-resize', 'bottom_side'],
    'se-resize': ['se-resize', 'bottom_right_corner'],
    'sw-resize': ['sw-resize', 'bottom_left_corner'],
    'w-resize': ['w-resize', 'left_side'],
    'ew-resize': ['ew-resize', 'sb_h_double_arrow'],
    'ns-resize': ['ns-resize', 'sb_v_double_arrow'],
    'nesw-resize': ['nesw-resize'],
    'nwse-resize': ['nwse-resize'],
    'col-resize': ['col-resize', 'sb_h_double_arrow'],
    'row-resize': ['row-resize', 'sb_v_double_arrow'],
    'all-scroll': ['all-scroll', 'fleur'],
    'zoom-in': ['zoom-in'],
    'zoom-out': ['zoom-out'],
};

// ARGB32 premultiplied LE (BGRA) -> RGBA straight alpha
function argbPreToRgba(pixels, width, height) {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const si = i * 4;
        const a = pixels[si + 3];
        if (a === 0) continue;
        rgba[si + 0] = Math.min(255, Math.round(pixels[si + 2] * 255 / a));
        rgba[si + 1] = Math.min(255, Math.round(pixels[si + 1] * 255 / a));
        rgba[si + 2] = Math.min(255, Math.round(pixels[si + 0] * 255 / a));
        rgba[si + 3] = a;
    }
    return rgba;
}

function getCacheDir() {
    const dir = `${GLib.get_user_cache_dir()}/cursor-overlay`;
    if (!GLib.file_test(dir, GLib.FileTest.IS_DIR))
        GLib.mkdir_with_parents(dir, 0o755);
    return dir;
}

export function loadCursorPng(cursorDir, cursorName, targetSize, colorHex) {
    const cacheDir = getCacheDir();
    const cacheKey = `${cursorName}_${colorHex.replace('#', '')}_${targetSize}.png`;
    const cachePath = `${cacheDir}/${cacheKey}`;

    const names = CURSOR_NAMES[cursorName] || [cursorName, 'default', 'left_ptr'];

    let parsed = null;
    for (const name of names) {
        parsed = parseXcursor(`${cursorDir}/${name}`, targetSize);
        if (parsed) break;
    }

    if (!parsed)
        return null;

    if (!GLib.file_test(cachePath, GLib.FileTest.EXISTS)) {
        const tinted = tintPixels(parsed.pixels, colorHex);
        const rgba = argbPreToRgba(tinted, parsed.width, parsed.height);

        try {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
                GLib.Bytes.new(rgba),
                GdkPixbuf.Colorspace.RGB, true, 8,
                parsed.width, parsed.height, parsed.width * 4
            );
            pixbuf.savev(cachePath, 'png', [], []);
        } catch {
            return null;
        }
    }

    return {
        path: cachePath,
        xhot: parsed.xhot,
        yhot: parsed.yhot,
        width: parsed.width,
        height: parsed.height,
    };
}

export function getCursorTheme() {
    const s = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    return {theme: s.get_string('cursor-theme'), size: s.get_int('cursor-size')};
}

export {findCursorDir};
