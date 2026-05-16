// overlayMonitor.js
// Centralised observer that automatically pauses videos whenever any overlay becomes visible
// (menu, gift drawer, modals, app minimised, etc.)

let pauseCallback = null;
let overlayObserver = null;

function checkOverlays() {
    // Select all possible overlay elements that can cover the video
    const menuPanel = document.getElementById('menuPanel');
    const giftDrawer = document.getElementById('giftDrawer');
    const modalOverlay = document.querySelector('.modal-overlay.active');
    const drawerOverlay = document.getElementById('drawerOverlay');
    const welcomeOverlay = document.getElementById('welcomeOverlay');

    let anyOverlayOpen = false;

    if (menuPanel && menuPanel.classList.contains('open')) anyOverlayOpen = true;
    if (giftDrawer && giftDrawer.classList.contains('open')) anyOverlayOpen = true;
    if (modalOverlay) anyOverlayOpen = true;
    if (drawerOverlay && drawerOverlay.classList.contains('active')) anyOverlayOpen = true;
    if (welcomeOverlay && !welcomeOverlay.classList.contains('hidden')) anyOverlayOpen = true;

    if (anyOverlayOpen && pauseCallback) {
        pauseCallback();
    }
}

function handleTelegramViewport() {
    const tg = window.Telegram?.WebApp;
    if (tg && typeof tg.isExpanded !== 'undefined' && !tg.isExpanded) {
        // App minimised or closed → pause videos
        if (pauseCallback) pauseCallback();
    }
}

export function initOverlayMonitor(pauseVideoCallback) {
    if (typeof pauseVideoCallback !== 'function') {
        console.error('overlayMonitor: pauseVideoCallback is not a function');
        return;
    }
    pauseCallback = pauseVideoCallback;

    // Watch for class changes on the body (menu, drawer, modal classes)
    if (overlayObserver) overlayObserver.disconnect();
    overlayObserver = new MutationObserver(() => {
        checkOverlays();
    });
    overlayObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        subtree: false
    });

    // Also watch for dynamic insertion of .modal-overlay.active (when class added)
    const modalObserver = new MutationObserver(() => {
        checkOverlays();
    });
    modalObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    // Telegram viewport change event
    const tg = window.Telegram?.WebApp;
    if (tg && typeof tg.onEvent === 'function') {
        tg.onEvent('viewportChanged', () => {
            handleTelegramViewport();
        });
        // initial check
        handleTelegramViewport();
    }

    // Initial check
    checkOverlays();
                                           }
