// feedManager.js
import { state } from './state.js';
import { getSeenList, showLoadingSpinner, hideLoadingSpinner } from './utils.js';
import { buildSlides, showMonetagInterstitial } from './adsManager.js';

const API_URL = "https://vidvids.onrender.com";
const PAGE_SIZE = 12; // Adjusted to 12 as requested
const MAX_RETRIES = 3;
const AD_FREQUENCY = 3;

// Helper: convert YouTube URL to embedded player URL with autoplay initially OFF
// Removed loop=1 and playlist= to avoid reloading on loop
// Added enablejsapi=1 for full JavaScript control
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
    return `https://www.youtube.com/embed/${videoId}?autoplay=0&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0&enablejsapi=1`;
}

// Global pause function (defined in script.js) – use it
function pauseAllVideos() {
    if (window.pauseAllVideos && typeof window.pauseAllVideos === 'function') {
        window.pauseAllVideos();
    }
}

// Send play/pause commands via postMessage with dynamic 'id' parameter
function controlIframePlayback(iframe, shouldPlay) {
    if (!iframe || !iframe.contentWindow) return;
    const command = shouldPlay ? 'playVideo' : 'pauseVideo';
    // Use the real player ID captured from YouTube, or fallback to 1
    const playerId = iframe._ytPlayerId !== undefined ? iframe._ytPlayerId : 1;
    iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: command, args: '', id: playerId }),
        '*'
    );
    if (shouldPlay && iframe._playQueued) {
        iframe._playQueued = false;
    }
}

// Helper: seek to a specific time in the video with dynamic 'id' parameter
function seekToIframe(iframe, seconds) {
    if (!iframe || !iframe.contentWindow) return;
    const playerId = iframe._ytPlayerId !== undefined ? iframe._ytPlayerId : 1;
    iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'command', func: 'seekTo', args: [seconds, true], id: playerId }),
        '*'
    );
}

// ---------- YouTube message listener - robust extraction of stateCode ----------
let youtubeListenerInitialized = false;
let activeLoopPollInterval = null;
let activePollingIframe = null;
let isLooping = false; // prevent multiple loops

// Helper: Ask YouTube to send us a playback status update
function requestVideoStatus(iframe) {
    if (!iframe || !iframe.contentWindow) return;
    const playerId = iframe._ytPlayerId !== undefined ? iframe._ytPlayerId : 1;
    
    // This command forces YouTube to immediately dispatch an infoDelivery payload containing currentTime & duration
    iframe.contentWindow.postMessage(
        JSON.stringify({ event: 'listening', id: playerId }),
        '*'
    );
}

// ============ Polling fallback: check time every 250ms for a tighter loop vibe ============
function startLoopPolling(iframe) {
    stopLoopPolling(); // clear any existing interval
    if (!iframe) return;
    activePollingIframe = iframe;
    
    // We poll more frequently (250ms instead of 1000ms) to catch the end frame of Shorts perfectly
    activeLoopPollInterval = setInterval(() => {
        if (!activePollingIframe) {
            stopLoopPolling();
            return;
        }
        // Check if this iframe is still the active one
        const slide = activePollingIframe.closest('.swiper-slide');
        if (!slide || !slide.classList.contains('swiper-slide-active')) {
            stopLoopPolling();
            return;
        }
        
        // Request the status update. The message event listener below will catch the response.
        requestVideoStatus(activePollingIframe);
    }, 50);
}

function stopLoopPolling() {
    if (activeLoopPollInterval) {
        clearInterval(activeLoopPollInterval);
        activeLoopPollInterval = null;
    }
    activePollingIframe = null;
}

function initYouTubeMessageListener() {
    if (youtubeListenerInitialized) return;
    youtubeListenerInitialized = true;

    window.addEventListener('message', function(event) {
        if (event.origin !== 'https://www.youtube.com') return;
        try {
            // Handle cases where event.data arrives as a raw string
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (!data) return;

            // Find the iframe that sent this event
            const iframes = document.querySelectorAll('iframe');
            let targetIframe = null;
            for (const iframe of iframes) {
                if (iframe.contentWindow === event.source) {
                    targetIframe = iframe;
                    break;
                }
            }
            if (!targetIframe) return;

            // ---- onReady ----
            if (data.event === 'onReady') {
                if (data.id !== undefined) {
                    targetIframe._ytPlayerId = data.id;
                }
                const slide = targetIframe.closest('.swiper-slide');
                if (slide && slide.classList.contains('swiper-slide-active') && targetIframe._playQueued) {
                    controlIframePlayback(targetIframe, true);
                    targetIframe._playQueued = false;
                }
            }

            // ---- Handle State Changes (Looking for Ended = 0) ----
            let stateCode = null;
            if (data.event === 'onStateChange') {
                stateCode = data.info;
            } else if (data.event === 'infoDelivery' && data.info && data.info.playerState !== undefined) {
                stateCode = data.info.playerState;
            } else if (data.playerState !== undefined) {
                stateCode = data.playerState;
            }

            if (stateCode === 0) {
                const slide = targetIframe.closest('.swiper-slide');
                if (slide && slide.classList.contains('swiper-slide-active')) {
                    performLoop(targetIframe);
                    return; // Prevent fall-through
                }
            }

            // ---- Handle Time Tracking Polling Response ----
            if (data.event === 'infoDelivery' && data.info) {
                const currentTime = data.info.currentTime;
                const duration = data.info.duration;
                
                // If we successfully received both metrics, evaluate if we are close to the end
                if (currentTime !== undefined && duration !== undefined && duration > 0) {
                    const slide = targetIframe.closest('.swiper-slide');
                    if (slide && slide.classList.contains('swiper-slide-active')) {
                        // If we are within 0.4 seconds of the end, force the cache-based loop
                        if (duration - currentTime < 0.2 && currentTime > 0) {
                            performLoop(targetIframe);
                        }
                    }
                }
            }
        } catch (e) { /* ignore malformed messages */ }
    });
}

// Helper: handle the ENDED state – seek to 0 and play from cache
function handleVideoEnded(sourceWindow) {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
        if (iframe.contentWindow === sourceWindow) {
            const slide = iframe.closest('.swiper-slide');
            if (slide && slide.classList.contains('swiper-slide-active')) {
                performLoop(iframe);
            }
            break;
        }
    }
}

// Perform the actual loop: seek to 0 and play cleanly once
function performLoop(iframe) {
    if (isLooping) return;
    isLooping = true;

    // Seek to start and play – uses cached buffer instantly
    seekToIframe(iframe, 0);
    controlIframePlayback(iframe, true);

    // Lock looping for 800ms to allow the video to start playing 
    // and prevent any late-arriving ended/polling events from double-triggering.
    setTimeout(() => { 
        isLooping = false; 
    }, 150);
}

// ============ Video placeholder and dynamic loading ============

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
                // Iframe already exists: seek to start and play (loop behavior)
                seekToIframe(iframe, 0);
                controlIframePlayback(iframe, true);
            }
            // Start polling for this iframe
            startLoopPolling(iframe);
        } else {
            // Inactive: pause the video but DO NOT remove the iframe
            // This preserves the cached video and prevents reloading when scrolling back
            const iframe = container.querySelector('iframe');
            if (iframe) {
                controlIframePlayback(iframe, false);
                // Stop polling if this was the active polling target
                if (activePollingIframe === iframe) {
                    stopLoopPolling();
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

// Render slides (unchanged except removed the feed click listener)
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

                // Ad frequency logic (changed from 15 to 6, and added resume)
                if (!state.isPremiumUser) {
                    state.imagesShownSinceLastAd++;
                    if (state.imagesShownSinceLastAd >= 6) {
                        state.imagesShownSinceLastAd = 0;
                        this.allowTouchMove = false;
                        pauseAllVideos();
                        showMonetagInterstitial().finally(() => {
                            this.allowTouchMove = true;
                            // Resume the active video after ad closes
                            const activeSlide = this.slides[this.activeIndex];
                            if (activeSlide) {
                                const iframe = activeSlide.querySelector('iframe');
                                if (iframe) {
                                    controlIframePlayback(iframe, true);
                                }
                            }
                        });
                    }
                }
            },
            init: function () {
                // Load and play the first active slide
                manageVideoPlayback(this);
            }
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
