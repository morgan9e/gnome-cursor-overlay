UUID = cursor-overlay@local
EXT_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC_FILES = extension.js xcursor.js prefs.js metadata.json

install: uninstall
	mkdir -p $(EXT_DIR)/schemas
	cp $(SRC_FILES) $(EXT_DIR)/
	cp schemas/*.xml $(EXT_DIR)/schemas/
	glib-compile-schemas $(EXT_DIR)/schemas/

uninstall:
	rm -rf $(EXT_DIR)

test: install
	dbus-run-session -- gnome-shell --devkit --wayland
