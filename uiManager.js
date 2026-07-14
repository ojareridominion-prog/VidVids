// uiManager.js
import { state } from './state.js';
import { resetAndLoadFeed } from './feedManager.js';
import { verifyPremiumStatus } from './premiumManager.js';

// Extended color palette for Theme, Accent & Text modes (30+ colors)
const COLOR_PALETTE = [
    "#000000", "#ffffff", // black and white first
    "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff",
    "#ff4500", "#ff8c00", "#ffd700", "#adff2f", "#32cd32", "#3cb371",
    "#20b2aa", "#4682b4", "#4169e1", "#6a5acd", "#8a2be2", "#c71585",
    "#db7093", "#ff69b4", "#ffb6c1", "#ffa07a", "#f08080", "#e9967a",
    "#f5deb3", "#f0e68c", "#bdb76b", "#d3d3d3", "#a9a9a9", "#808080",
    "#696969", "#2f4f4f", "#1e1e1e", "#4a4a4a", "#9c4dff", "#ff6b6b",
    "#4ecdc4", "#ffe66d", "#ff9f1c", "#2ec4b6", "#e71d36", "#011627"
];

let currentThemeMode = "theme"; // 'theme', 'accent', 'text'

// Helper: darken a hex color by percent (0-100)
function darkenColor(hex, percent) {
    hex = hex.replace('#', '');
    let r = parseInt(hex.substring(0,2), 16);
    let g = parseInt(hex.substring(2,4), 16);
    let b = parseInt(hex.substring(4,6), 16);
    r = Math.floor(r * (1 - percent / 100));
    g = Math.floor(g * (1 - percent / 100));
    b = Math.floor(b * (1 - percent / 100));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// Get menu overlay element
function getMenuOverlay() {
    return document.getElementById('menuOverlay');
}

export function toggleMenu() {
    const panel = document.getElementById('menuPanel');
    const overlay = document.getElementById('menuOverlay');
    if (!panel || !overlay) return;

    const isOpen = panel.classList.contains('open');

    if (!isOpen) {
        panel.classList.add('open');
        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
        verifyPremiumStatus();
    } else {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    if (!panel.classList.contains('open')) {
        overlay.style.pointerEvents = 'none';
        overlay.style.visibility = 'hidden';
    } else {
        overlay.style.pointerEvents = '';
        overlay.style.visibility = '';
    }
}

function initMenuOverlay() {
    const overlay = getMenuOverlay();
    if (overlay) {
        overlay.addEventListener('click', () => {
            if (document.getElementById('menuPanel').classList.contains('open')) {
                toggleMenu();
            }
        });
    }
}

// Apply custom theme (background + bar) based on a base color
function applyCustomTheme(baseColor) {
    document.body.classList.remove(
        'theme-white', 'theme-blood', 'theme-cyan', 'theme-sky',
        'theme-orange', 'theme-green', 'theme-violet'
    );
    document.body.style.setProperty('--bg', baseColor);
    const barColor = darkenColor(baseColor, 30);
    document.body.style.setProperty('--bar', barColor);
    localStorage.setItem('vidvids_custom_bg', baseColor);
    localStorage.removeItem('vidvids-theme'); // legacy, keep clean
}

function setCustomAccent(color) {
    document.body.style.setProperty('--accent', color);
    localStorage.setItem('vidvids_custom_accent', color);
}

function setCustomText(color) {
    document.body.style.setProperty('--text', color);
    localStorage.setItem('vidvids_custom_text', color);
}

function loadCustomThemeSettings() {
    const savedBg = localStorage.getItem('vidvids_custom_bg');
    if (savedBg) {
        document.body.style.setProperty('--bg', savedBg);
        const barColor = darkenColor(savedBg, 30);
        document.body.style.setProperty('--bar', barColor);
    }
    const savedAccent = localStorage.getItem('vidvids_custom_accent');
    if (savedAccent) document.body.style.setProperty('--accent', savedAccent);
    const savedText = localStorage.getItem('vidvids_custom_text');
    if (savedText) document.body.style.setProperty('--text', savedText);
}

// Legacy applyTheme for compatibility with script.js
export function applyTheme(themeId) {
    document.body.classList.remove(
        'theme-white', 'theme-blood', 'theme-cyan', 'theme-sky',
        'theme-orange', 'theme-green', 'theme-violet'
    );
    
    const themeMap = {
        'theme-white': '#ffffff',
        'theme-blood': '#4a0e0e',
        'theme-cyan': '#001616',
        'theme-sky': '#071824',
        'theme-orange': '#2a1400',
        'theme-green': '#051f13',
        'theme-violet': '#16001f',
        'theme-black': '#000000'
    };
    
    const bgColor = themeMap[themeId] || '#000000';
    applyCustomTheme(bgColor);
    
    if (themeId !== 'theme-black') {
        localStorage.setItem('vidvids-theme', themeId);
    } else {
        localStorage.removeItem('vidvids-theme');
    }
}

function populateColorPalette(mode) {
    const container = document.getElementById('colorPalette');
    if (!container) return;

    const colors = COLOR_PALETTE.map(c => ({ color: c }));
    container.innerHTML = colors.map(item => `
        <div class="color-swatch" style="background-color: ${item.color};" data-color="${item.color}"></div>
    `).join('');

    container.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const color = swatch.dataset.color;
            if (mode === "theme") {
                applyCustomTheme(color);
            } else if (mode === "accent") {
                setCustomAccent(color);
            } else if (mode === "text") {
                setCustomText(color);
            }
        });
    });
}

function initCustomThemeEngine() {
    const segmentedContainer = document.getElementById('customThemeSegmented');
    if (!segmentedContainer) return;

    loadCustomThemeSettings();

    segmentedContainer.querySelectorAll('.theme-seg-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (!mode) return;
            segmentedContainer.querySelectorAll('.theme-seg-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentThemeMode = mode;
            populateColorPalette(mode);
        });
    });

    populateColorPalette("theme");
}

// ==================== SEARCH PANEL LOGIC FULLY REMOVED ====================
// No search-related functions remain.

export async function shareBot() {
    const shareData = {
        title: 'VidVids',
        text: '‎Your pocket player for YouTube Shorts. No clutter, no noise — just endless vertical videos.',
        url: 'https://t.me/vidvids_bot'
    };
    try {
        if (navigator.share) await navigator.share(shareData);
        else {
            await navigator.clipboard.writeText(`${shareData.text} ${shareData.url}`);
            alert('Link & Text copied to clipboard!');
        }
    } catch (err) { console.log('Error sharing:', err); }
}

// MODIFIED: refresh TON prices before opening premium modal
export function openPremium() {
    if (window.updateTonPrices) {
        window.updateTonPrices().catch(console.warn);
    }
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('premiumModal').classList.add('active');
}

export function closePremium() {
    document.getElementById('premiumModal').classList.remove('active');
}

export function openCopyright() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('copyrightModal').classList.add('active');
}

export function closeCopyright() {
    document.getElementById('copyrightModal').classList.remove('active');
}

export function openPrivacy() {
    const panel = document.getElementById('menuPanel');
    const overlay = getMenuOverlay();
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
    document.getElementById('privacyModal').classList.add('active');
}

export function closePrivacy() {
    document.getElementById('privacyModal').classList.remove('active');
}

export function copyUserId() {
    const userId = document.getElementById('userId').innerText;
    if (userId && userId !== '-') {
        navigator.clipboard.writeText(userId).then(() => {
            const btn = document.getElementById('copyIdBtn');
            const originalText = btn.innerText;
            btn.innerText = '✅ Copied!';
            setTimeout(() => { btn.innerText = originalText; }, 1500);
        }).catch(err => console.error('Failed to copy: ', err));
    }
}

// ==================== CONTROL POSITION TOGGLE (replaces Dark Text) ====================
export function toggleControlPosition() {
    const current = localStorage.getItem('vidvids_control_position') || 'right';
    const next = current === 'right' ? 'left' : 'right';
    localStorage.setItem('vidvids_control_position', next);

    // Update all existing video-controls elements
    document.querySelectorAll('.video-controls').forEach(el => {
        el.classList.remove('controls-right', 'controls-left');
        el.classList.add(next === 'left' ? 'controls-left' : 'controls-right');
    });

    updateControlPositionIndicator(next);
}

function updateControlPositionIndicator(position) {
    const indicator = document.getElementById('controlPosIndicator');
    if (indicator) {
        indicator.innerText = position === 'left' ? 'LEFT' : 'RIGHT';
    }
}

export function initUI() {
    // Load and apply control position
    const pos = localStorage.getItem('vidvids_control_position') || 'right';
    updateControlPositionIndicator(pos);

    loadCustomThemeSettings();
    initCustomThemeEngine();
    initMenuOverlay();
}
