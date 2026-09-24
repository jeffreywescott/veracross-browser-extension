function show(platform, enabled, useSettingsInsteadOfPreferences) {
    document.body.classList.add(`platform-${platform}`);

    if (platform === 'mac' && !useSettingsInsteadOfPreferences) {
        // macOS 12 still calls it "Preferences".
        for (const el of document.querySelectorAll('.platform-mac p, .platform-mac button')) {
            el.innerHTML = el.innerHTML.replace('Safari Settings', 'Safari Preferences');
        }
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
