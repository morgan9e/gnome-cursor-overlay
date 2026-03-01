'use strict';

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function newColorButton(settings, key) {
    const btn = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({modal: true, with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });
    const rgba = btn.get_rgba();
    rgba.parse(settings.get_string(key));
    btn.set_rgba(rgba);

    btn.connect('notify::rgba', widget => {
        const rgb = widget.get_rgba().to_string();
        const hex = '#' + rgb
            .replace(/^rgb\(|\s+|\)$/g, '')
            .split(',')
            .map(s => parseInt(s).toString(16).padStart(2, '0'))
            .join('');
        settings.set_string(key, hex);
    });
    return btn;
}

const MODE_LABELS = ['Circle', 'Cursor', 'Image'];
const MODE_VALUES = ['circle', 'cursor', 'image'];

const OverlayPage = GObject.registerClass(
    class OverlayPage extends Adw.PreferencesPage {
        constructor(extensionObject) {
            super({title: 'Overlay', icon_name: 'input-mouse-symbolic'});

            const settings = extensionObject.getSettings();

            // Mode
            const modeGroup = new Adw.PreferencesGroup({title: 'Mode'});
            this.add(modeGroup);

            const modeRow = new Adw.ComboRow({
                title: 'Overlay Mode',
                subtitle: 'Circle ring, tinted cursor, or custom image',
                model: Gtk.StringList.new(MODE_LABELS),
            });
            modeRow.set_selected(Math.max(0, MODE_VALUES.indexOf(settings.get_string('overlay-mode'))));
            modeRow.connect('notify::selected', w => {
                settings.set_string('overlay-mode', MODE_VALUES[w.selected] || 'circle');
            });
            modeGroup.add(modeRow);

            // Circle
            const circleGroup = new Adw.PreferencesGroup({title: 'Circle Mode'});
            this.add(circleGroup);

            const radiusRow = new Adw.SpinRow({
                title: 'Radius',
                adjustment: new Gtk.Adjustment({lower: 4, upper: 128, step_increment: 2}),
                value: settings.get_int('circle-radius'),
            });
            radiusRow.adjustment.connect('value-changed', w => settings.set_int('circle-radius', w.value));
            circleGroup.add(radiusRow);

            const strokeRow = new Adw.SpinRow({
                title: 'Stroke Width',
                adjustment: new Gtk.Adjustment({lower: 1, upper: 16, step_increment: 1}),
                value: settings.get_int('circle-stroke-width'),
            });
            strokeRow.adjustment.connect('value-changed', w => settings.set_int('circle-stroke-width', w.value));
            circleGroup.add(strokeRow);

            const circleColorRow = new Adw.ActionRow({title: 'Color'});
            circleColorRow.add_suffix(newColorButton(settings, 'circle-color'));
            circleGroup.add(circleColorRow);

            const circleOpacityRow = new Adw.SpinRow({
                title: 'Opacity',
                adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5}),
                value: settings.get_int('circle-opacity'),
            });
            circleOpacityRow.adjustment.connect('value-changed', w => settings.set_int('circle-opacity', w.value));
            circleGroup.add(circleOpacityRow);

            // Cursor
            const cursorGroup = new Adw.PreferencesGroup({title: 'Cursor Mode'});
            this.add(cursorGroup);

            const cursorSizeRow = new Adw.SpinRow({
                title: 'Size',
                subtitle: 'Xcursor size',
                adjustment: new Gtk.Adjustment({lower: 16, upper: 256, step_increment: 8}),
                value: settings.get_int('cursor-size'),
            });
            cursorSizeRow.adjustment.connect('value-changed', w => settings.set_int('cursor-size', w.value));
            cursorGroup.add(cursorSizeRow);

            const cursorColorRow = new Adw.ActionRow({title: 'Tint Color'});
            cursorColorRow.add_suffix(newColorButton(settings, 'cursor-color'));
            cursorGroup.add(cursorColorRow);

            const cursorOpacityRow = new Adw.SpinRow({
                title: 'Opacity',
                adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5}),
                value: settings.get_int('cursor-opacity'),
            });
            cursorOpacityRow.adjustment.connect('value-changed', w => settings.set_int('cursor-opacity', w.value));
            cursorGroup.add(cursorOpacityRow);

            // Image
            const imageGroup = new Adw.PreferencesGroup({title: 'Image Mode'});
            this.add(imageGroup);

            const imagePathRow = new Adw.ActionRow({
                title: 'Image File',
                subtitle: settings.get_string('image-path') || 'No file selected',
            });
            const browseBtn = new Gtk.Button({label: 'Browse', valign: Gtk.Align.CENTER});
            browseBtn.connect('clicked', () => {
                const dialog = new Gtk.FileDialog({title: 'Select Overlay Image', modal: true});
                const filter = new Gtk.FileFilter();
                filter.set_name('Images');
                for (const t of ['image/png', 'image/bmp', 'image/svg+xml', 'image/jpeg', 'image/gif'])
                    filter.add_mime_type(t);
                const store = new Gio.ListStore({item_type: Gtk.FileFilter});
                store.append(filter);
                dialog.set_filters(store);

                dialog.open(this.get_root(), null, (dlg, result) => {
                    try {
                        const file = dlg.open_finish(result);
                        if (file) {
                            const path = file.get_path();
                            settings.set_string('image-path', path);
                            imagePathRow.set_subtitle(path);
                        }
                    } catch { /* cancelled */ }
                });
            });
            imagePathRow.add_suffix(browseBtn);
            imageGroup.add(imagePathRow);

            const imageSizeRow = new Adw.SpinRow({
                title: 'Size',
                adjustment: new Gtk.Adjustment({lower: 8, upper: 512, step_increment: 8}),
                value: settings.get_int('image-size'),
            });
            imageSizeRow.adjustment.connect('value-changed', w => settings.set_int('image-size', w.value));
            imageGroup.add(imageSizeRow);

            const imageOpacityRow = new Adw.SpinRow({
                title: 'Opacity',
                adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 5}),
                value: settings.get_int('image-opacity'),
            });
            imageOpacityRow.adjustment.connect('value-changed', w => settings.set_int('image-opacity', w.value));
            imageGroup.add(imageOpacityRow);

            // Per-Monitor
            const monitorGroup = new Adw.PreferencesGroup({title: 'Per-Monitor'});
            this.add(monitorGroup);

            const monitorList = Gdk.Display.get_default().get_monitors();
            const nMonitors = monitorList.get_n_items();
            const disabledMonitors = settings.get_strv('disabled-monitors');

            for (let i = 0; i < nMonitors; i++) {
                const monitor = monitorList.get_item(i);
                const connector = monitor.get_connector();
                const geom = monitor.get_geometry();

                const toggle = new Gtk.Switch({
                    active: !disabledMonitors.includes(connector),
                    valign: Gtk.Align.CENTER,
                });

                const row = new Adw.ActionRow({
                    title: connector || `Monitor ${i + 1}`,
                    subtitle: `${geom.width}\u00d7${geom.height}`,
                });
                row.add_suffix(toggle);
                row.set_activatable_widget(toggle);

                toggle.connect('notify::active', widget => {
                    const current = settings.get_strv('disabled-monitors');
                    if (widget.active) {
                        settings.set_strv('disabled-monitors',
                            current.filter(c => c !== connector));
                    } else {
                        if (!current.includes(connector))
                            settings.set_strv('disabled-monitors', [...current, connector]);
                    }
                });

                monitorGroup.add(row);
            }
        }
    }
);

export default class CursorOverlayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.default_width = 460;
        window.default_height = 880;
        window.add(new OverlayPage(this));
    }
}
