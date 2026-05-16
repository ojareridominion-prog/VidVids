// feedManager.js
import { state } from './state.js';
import { getSeenList, showLoadingSpinner, hideLoadingSpinner } from './utils.js';
import { buildSlides, showMonetagInterstitial } from './adsManager.js';

const API_URL = "https://imagifhub.onrender.com";
const PAGE_SIZE = 30;
const MAX_RETRIES = 3;
const AD_FREQUENCY = 3;

// Helper: convert YouTube URL to embedded player URL with autoplay, loop, controls disabled, and JS API enabled
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
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&playlist=${videoId}&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0&enablejsapi=1`;
}

// Global pause function (defined in script.js) – use it
function pauseAllVideos() {
    if (window.pauseAllVideos && typeof window.pauseAllVideos === 'function') {
        window.pauseAllVideos();
    }
}

function playIframeVideo(iframe) {
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
    }
}

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

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function generateVideoSlide(img) {
    const embedUrl = getYouTubeEmbedUrl(img.url);
    if (!embedUrl) {
        return `
            <div class="swiper-slide" data-type="video" data-url="${escapeHtml(img.url)}">
                <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:#000; color:#fff;">
                    Invalid YouTube URL
                </div>
            </div>
        `;
    }
    return `
        <div class="swiper-slide" data-type="video" data-url="${escapeHtml(img.url)}">
            <iframe 
                src="${embedUrl}" 
                frameborder="0" 
                allow="autoplay; encrypted-media; picture-in-picture; web-share" 
                allowfullscreen
                style="width:100%; height:100%; border:none;">
            </iframe>
        </div>
    `;
}

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

    return true;
}

function renderSlides(slides) {
    const feed = document.getElementById('feed');
    feed.innerHTML = slides.map(slide => {
        if (slide.type === 'image') {
            return generateVideoSlide(slide.item);
        } else {
            return generateAdSlide(slide.item, slide.item.index);
        }
    }).join('');

    if (state.activeSwiper) state.activeSwiper.destroy(true, true);
    state.activeSwiper = new Swiper('#swiper', {
        direction: 'vertical',
        mousewheel: true,
        effect: 'slide',
        speed: 300,
        on: {
            reachEnd: async () => {
                if (state.activeSearchQuery) return;
                if (!state.hasMoreImages || state.isLoadingMore) return;
                await loadMoreImages(true);
            },
            slideChange: function () {
                pauseAllVideos();
                
                const activeSlide = this.slides[this.activeIndex];
                if (activeSlide && activeSlide.dataset.type === 'video') {
                    const iframe = activeSlide.querySelector('iframe');
                    if (iframe) {
                        setTimeout(() => playIframeVideo(iframe), 50);
                    }
                }
                
                if (!state.isPremiumUser) {
                    state.imagesShownSinceLastAd++;
                    if (state.imagesShownSinceLastAd >= 15) {
                        state.imagesShownSinceLastAd = 0;
                        this.allowTouchMove = false;
                        // Pause videos before showing ad
                        pauseAllVideos();
                        showMonetagInterstitial().finally(() => { this.allowTouchMove = true; });
                    }
                }
            },
            init: function () {
                const activeSlide = this.slides[this.activeIndex];
                if (activeSlide && activeSlide.dataset.type === 'video') {
                    const iframe = activeSlide.querySelector('iframe');
                    if (iframe) {
                        setTimeout(() => playIframeVideo(iframe), 100);
                    }
                }
            }
        }
    });
}

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
