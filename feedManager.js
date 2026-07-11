// feedManager.js
import { state } from './state.js';
import { getSeenList, showLoadingSpinner, hideLoadingSpinner } from './utils.js';
import { buildSlides, showMonetagInterstitial } from './adsManager.js';

const API_URL = "https://vidvids.onrender.com";
const PAGE_SIZE = 12; // Reduced from 30 to save data
const MAX_RETRIES = 3;
const AD_FREQUENCY = 3;

// Helper: convert YouTube URL to embedded player URL with autoplay initially OFF
function getYouTubeEmbedUrl(url) {
    let videoId = '';
    const patterns = [
        /(?:youtu\.be\/)([a-zA-Z0-9_-]+)/,
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]+)/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            videoId = match[1];
            break;
        }
    }
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${videoId}?autoplay=0&loop=1&playlist=${videoId}&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0&enablejsapi=1`;
}

// Global pause function (defined in script.js) – use it
function pauseAllVideos() {
    if (window.pauseAllVideos && typeof window.pauseAllVideos === 'function') {
        window.pauseAllVideos();
    }
}

// Send play/pause commands via postMessage (no src rewriting)
function controlIframePlayback(iframe, shouldPlay) {
    if (!iframe || !iframe.contentWindow) return;
    const command = shouldPlay ? 'playVideo' : 'pauseVideo';
    iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: command, args: '' }),
        '*'
    );
    if (shouldPlay && iframe._playQueued) {
        iframe._playQueued = false;
    }
}

// ---------- YouTube message listener for onReady ----------
let youtubeListenerInitialized = false;

function initYouTubeMessageListener() {
    if (youtubeListenerInitialized) return;
    youtubeListenerInitialized = true;

    window.addEventListener('message', function(event) {
        if (event.origin !== 'https://www.youtube.com') return;
        try {
            const data = JSON.parse(event.data);
            if (data.event === 'onReady') {
                const iframes = document.querySelectorAll('iframe');
                for (const iframe of iframes) {
                    if (iframe.contentWindow === event.source) {
                        const slide = iframe.closest('.swiper-slide');
                        if (slide && slide.classList.contains('swiper-slide-active') && iframe._playQueued) {
                            controlIframePlayback(iframe, true);
                            iframe._playQueued = false;
                        }
                        break;
                    }
                }
            }
        } catch (e) { /* ignore malformed messages */ }
    });
}

// ============ NEW: Video placeholder and dynamic loading ============

// Create a lightweight placeholder (thumbnail + controls)
function generateVideoSlide(img) {
    const videoId = extractYouTubeId(img.url);
    if (!videoId) {
        return `
            <div class="swiper-slide" data-type="video" data-url="${escapeHtml(img.url)}">
                <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#000; color:#fff;">
                    Invalid YouTube URL
                </div>
            </div>
        `;
    }

    // Get control position from localStorage
    const pos = localStorage.getItem('vidvids_control_position') || 'right';
    const controlsClass = pos === 'left' ? 'controls-left' : 'controls-right';

    // Thumbnail URL (use medium quality to save data)
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    return `
        <div class="swiper-slide" data-type="video" data-video-id="${videoId}" data-url="${escapeHtml(img.url)}">
            <div class="video-placeholder" style="width:100%; height:100%; background:#000; display:flex; align-items:center; justify-content:center; position:relative;">
                <img src="${thumbnailUrl}" alt="Video thumbnail" loading="lazy"
                     style="width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0;">
                <div style="position:relative; z-index:2; background:rgba(0,0,0,0.4); border-radius:50%; padding:12px; pointer-events:none;">
                    <span style="font-size:48px; color:white;">▶</span>
                </div>
                <!-- The iframe will be inserted here when slide becomes active -->
                <div class="video-iframe-container" style="width:100%; height:100%; position:absolute; top:0; left:0;"></div>
            </div>
            <div class="video-controls ${controlsClass}">
                <button class="gift-icon-btn video-gift-btn" aria-label="Send Gift">🎁</button>
                <button class="video-up-btn">⬆️</button>
                <button class="video-down-btn">⬇️</button>
            </div>
        </div>
    `;
}

// Extract video ID from URL (reused)
function extractYouTubeId(url) {
    const patterns = [
        /(?:youtu\.be\/)([a-zA-Z0-9_-]+)/,
        /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]+)/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)/
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) return match[1];
    }
    return null;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Manage video playback for the active slide and clean up inactive ones
function manageVideoPlayback(swiperInstance) {
    if (!swiperInstance) return;
    initYouTubeMessageListener();

    const slides = swiperInstance.slides;
    const activeIndex = swiperInstance.activeIndex;

    slides.forEach((slide, idx) => {
        const isActive = (idx === activeIndex);
        const container = slide.querySelector('.video-iframe-container');
        if (!container) return;

        if (isActive) {
            // Active: load the iframe if not already present
            let iframe = container.querySelector('iframe');
            if (!iframe) {
                const videoId = slide.dataset.videoId;
                if (!videoId) return;
                const embedUrl = getYouTubeEmbedUrl(`https://youtu.be/${videoId}`);
                if (!embedUrl) return;

                iframe = document.createElement('iframe');
                iframe.src = embedUrl;
                iframe.loading = 'lazy';
                iframe.preload = 'none';
                iframe.frameborder = '0';
                iframe.allow = 'autoplay; encrypted-media; picture-in-picture; web-share';
                iframe.allowFullscreen = true;
                iframe.style.cssText = 'width:100%; height:100%; border:none; position:absolute; top:0; left:0; z-index:1;';
                container.appendChild(iframe);

                // Hide the thumbnail after iframe loads (optional: use 'load' event)
                const placeholder = slide.querySelector('.video-placeholder img');
                if (placeholder) {
                    placeholder.style.opacity = '0';
                    placeholder.style.transition = 'opacity 0.3s';
                }

                // Flag to play when ready
                iframe._playQueued = true;
                // Fallback: try to play after 1.5 seconds if onReady doesn't fire
                setTimeout(() => {
                    if (iframe._playQueued) {
                        controlIframePlayback(iframe, true);
                        iframe._playQueued = false;
                    }
                }, 1500);
            } else {
                // Iframe already exists, just play
                controlIframePlayback(iframe, true);
            }
        } else {
            // Inactive: pause and remove iframe to free resources
            const iframe = container.querySelector('iframe');
            if (iframe) {
                controlIframePlayback(iframe, false);
                iframe.remove();
                // Show thumbnail again
                const placeholder = slide.querySelector('.video-placeholder img');
                if (placeholder) {
                    placeholder.style.opacity = '1';
                }
            }
        }
    });
}

// ---------- Ad slide (unchanged) ----------
function generateAdSlide(ad, adIndex) {
    return `
        <div class="swiper-slide" data-type="ad" data-ad-index="${adIndex}">
            <img src="${ad.image}" alt="Ad" style="width:100%; height:100%; object-fit:cover;">
            <div class="ad-overlay">
                <div class="ad-sponsored">Sponsored</div>
                <div class="ad-title">${escapeHtml(ad.title)}</div>
                <div class="ad-description">${escapeHtml(ad.subtitle)}</div>
                <button class="ad-action-btn">${escapeHtml(ad.buttonLabel || 'Open')}</button>
            </div>
            <button class="remove-ads-btn">Remove Ads</button>
        </div>
    `;
}

// Render slides (unchanged except using new generateVideoSlide)
function renderSlides(slides) {
    const feed = document.getElementById('feed');
    if (!feed) return;

    if (state.activeSwiper) {
        state.activeSwiper.destroy(true, true);
        state.activeSwiper = null;
    }

    feed.innerHTML = slides.map(slide => {
        if (slide.type === 'image') {
            return generateVideoSlide(slide.item);
        } else {
            return generateAdSlide(slide.item, slide.item.index);
        }
    }).join('');

    // Initialize Swiper
    state.activeSwiper = new Swiper('#swiper', {
        direction: 'vertical',
        mousewheel: true,
        effect: 'slide',
        speed: 300,
        observer: true,
        observeParents: true,
        on: {
            slideChange: function () {
                pauseAllVideos();
                manageVideoPlayback(this);

                // Check if we are near the end and need to load more
                const totalSlides = this.slides.length;
                const activeIndex = this.activeIndex;
                // Load more when within 2 slides of the end
                if (activeIndex >= totalSlides - 2) {
                    if (!state.activeSearchQuery && state.hasMoreImages && !state.isLoadingMore) {
                        loadMoreImages(true);
                    }
                }

                // Ad frequency logic (unchanged)
                if (!state.isPremiumUser) {
                    state.imagesShownSinceLastAd++;
                    if (state.imagesShownSinceLastAd >= 15) {
                        state.imagesShownSinceLastAd = 0;
                        this.allowTouchMove = false;
                        pauseAllVideos();
                        showMonetagInterstitial().finally(() => { this.allowTouchMove = true; });
                    }
                }
            },
            init: function () {
                // Load and play the first active slide
                manageVideoPlayback(this);
            }
        }
    });

    // Attach event listeners for up/down buttons (delegation on feed) – unchanged
    feed.addEventListener('click', function(e) {
        const target = e.target.closest('.video-up-btn, .video-down-btn');
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();

        const swiper = state.activeSwiper;
        if (!swiper) return;

        if (target.classList.contains('video-up-btn')) {
            swiper.slidePrev();
        } else if (target.classList.contains('video-down-btn')) {
            swiper.slideNext();
        }
    });

    setTimeout(() => {
        if (state.activeSwiper) state.activeSwiper.update();
    }, 100);
}

// ---------- fetch, load, append functions (mostly unchanged, but use new render) ----------

export async function loadMoreImages(preservePosition = false) {
    if (state.isLoadingMore || !state.hasMoreImages) return;
    const newImages = await fetchRandomImages(state.currentCategory, state.activeSearchQuery);
    if (newImages.length === 0) {
        state.hasMoreImages = false;
        return;
    }
    await appendMoreImages(newImages);
}

export async function resetAndLoadFeed(cat, search = "", skipAd = false) {
    if (state.isLoadingFeed) return;
    state.isLoadingFeed = true;
    state.sessionSeenUrls.clear();
    state.hasMoreImages = true;
    state.allImages = [];
    state.imagesShownSinceLastAd = 0;
    state.currentAdIndex = 0;
    const shouldShowAd = !state.isPremiumUser && !skipAd && !state.activeSearchQuery;
    if (shouldShowAd) {
        try {
            pauseAllVideos();
            await showMonetagInterstitial();
        } catch (e) { console.warn(e); }
    }
    state.activeSearchQuery = search || "";
    state.currentCategory = cat;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b.innerText === cat));
    
    const feed = document.getElementById('feed');
    feed.innerHTML = `
        <div class="skeleton-wrapper">
            <div class="skeleton-slide">
                <div class="skeleton-image"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text-small"></div>
            </div>
            <div class="skeleton-slide">
                <div class="skeleton-image"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text-small"></div>
            </div>
        </div>
    `;
    try {
        const newImages = await fetchRandomImages(cat, state.activeSearchQuery);
        if (newImages.length === 0) {
            feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>No Videos Found</h3></div>';
            return;
        }
        state.allImages = newImages;
        const slides = buildSlides(state.allImages, state.isPremiumUser);
        renderSlides(slides);
    } catch (e) {
        feed.innerHTML = '<div class="swiper-slide" style="display:flex; align-items:center; justify-content:center;"><h3>Connection Error</h3></div>';
    } finally {
        state.isLoadingFeed = false;
    }
}

export async function loadFeed(cat, search = "", skipAd = false) {
    await resetAndLoadFeed(cat, search, skipAd);
}

// Helper to append more images (updated to use new slide generation)
async function appendMoreImages(newImages) {
    if (!state.activeSwiper || newImages.length === 0) return false;

    const swiper = state.activeSwiper;
    const oldImageCount = state.allImages.length;
    const htmlSlides = [];
    let localAdIndex = state.currentAdIndex;

    for (let i = 0; i < newImages.length; i++) {
        const img = newImages[i];
        htmlSlides.push(generateVideoSlide(img));

        const position = oldImageCount + i + 1;
        if (!state.isPremiumUser && position % AD_FREQUENCY === 0) {
            const ad = state.nativeAds[localAdIndex % state.nativeAds.length];
            htmlSlides.push(generateAdSlide(ad, localAdIndex % state.nativeAds.length));
            localAdIndex++;
        }
    }

    if (htmlSlides.length === 0) return false;

    swiper.appendSlide(htmlSlides);
    swiper.update();

    state.currentAdIndex = localAdIndex;
    state.allImages.push(...newImages);
    newImages.forEach(img => state.sessionSeenUrls.add(img.url));

    // The slideChange event will handle loading videos as they become active
    return true;
}

// ---- fetchRandomImages (unchanged) ----
async function fetchRandomImages(category = state.currentCategory, search = "", retryCount = 0) {
    if (state.isLoadingMore) return [];
    state.isLoadingMore = true;
    showLoadingSpinner();
    try {
        let url = `${API_URL}/media/random?limit=${PAGE_SIZE}`;
        if (category && category !== "Discover") url += `&category=${encodeURIComponent(category)}`;
        if (search && search.trim()) url += `&search=${encodeURIComponent(search.trim())}`;
        const res = await fetch(url);
        let newImages = await res.json();
        if (!newImages || newImages.length === 0) {
            state.hasMoreImages = false;
            return [];
        }
        
        const isSearchActive = search && search.trim().length > 0;
        let seenHistory = new Set();
        if (!isSearchActive) {
            seenHistory = new Set(getSeenList());
        }
        
        const filtered = newImages.filter(img => 
            !state.sessionSeenUrls.has(img.url) && !seenHistory.has(img.url)
        );
        
        if (filtered.length < 10 && retryCount < MAX_RETRIES) {
            const more = await fetchRandomImages(category, search, retryCount + 1);
            const combined = [...filtered, ...more];
            const uniqueCombined = [];
            const seenSet = new Set();
            for (const img of combined) {
                if (!seenSet.has(img.url) && !state.sessionSeenUrls.has(img.url) && !seenHistory.has(img.url)) {
                    seenSet.add(img.url);
                    uniqueCombined.push(img);
                }
            }
            return uniqueCombined;
        }
        
        filtered.forEach(img => state.sessionSeenUrls.add(img.url));
        return filtered;
    } catch (e) {
        console.error("Error fetching random videos:", e);
        return [];
    } finally {
        state.isLoadingMore = false;
        hideLoadingSpinner();
    }
    }
