// Application State
const state = {
    rawEntries: [],
    parsedUpdates: [],
    selectedIds: new Set(),
    currentFilter: 'all',
    searchQuery: '',
    isLoading: false,
    activeView: 'all' // 'all' or 'favorites'
};

// DOM Elements
const elements = {
    refreshBtn: document.getElementById('refresh-btn'),
    refreshIcon: document.getElementById('refresh-icon'),
    cacheStatus: document.getElementById('cache-status'),
    searchInput: document.getElementById('search-input'),
    clearSearch: document.getElementById('clear-search'),
    filterPills: document.getElementById('filter-pills'),
    errorBanner: document.getElementById('error-banner'),
    closeErrorBtn: document.getElementById('close-error-btn'),
    loadingState: document.getElementById('loading-state'),
    emptyState: document.getElementById('empty-state'),
    releasesFeed: document.getElementById('releases-feed'),
    distributionList: document.getElementById('distribution-list'),
    statTotalNotes: document.getElementById('stat-total-notes').querySelector('.stat-number'),
    selectionDrawer: document.getElementById('selection-drawer'),
    selectedCount: document.getElementById('selected-count'),
    clearSelectionBtn: document.getElementById('clear-selection-btn'),
    tweetSelectedBtn: document.getElementById('tweet-selected-btn'),
    
    // Nav Items
    navAll: document.getElementById('nav-all'),
    navFavorites: document.getElementById('nav-favorites'),
    emptyRefreshBtn: document.getElementById('empty-refresh-btn'),
    
    // Modal Elements
    tweetModal: document.getElementById('tweet-modal'),
    closeModalBtn: document.getElementById('close-modal-btn'),
    tweetTextarea: document.getElementById('tweet-textarea'),
    charCount: document.getElementById('char-count'),
    tweetLinkPreview: document.getElementById('tweet-link-preview'),
    tweetLengthWarning: document.getElementById('tweet-length-warning'),
    copyTweetBtn: document.getElementById('copy-tweet-btn'),
    submitTweetBtn: document.getElementById('submit-tweet-btn'),
    
    // Toast
    toast: document.getElementById('toast-notification')
};

// Map of categories/types to human-readable names and icons
const CATEGORY_MAP = {
    'all': { label: 'All Updates', icon: 'fa-list-ul', color: 'var(--primary)' },
    'feature': { label: 'Feature', icon: 'fa-star', color: 'var(--type-feature)' },
    'issue': { label: 'Issue', icon: 'fa-circle-exclamation', color: 'var(--type-issue)' },
    'deprecated': { label: 'Deprecated', icon: 'fa-ban', color: 'var(--type-deprecated)' },
    'changed': { label: 'Changed', icon: 'fa-circle-notch', color: 'var(--type-changed)' },
    'resolved': { label: 'Resolved', icon: 'fa-circle-check', color: 'var(--type-resolved)' },
    'other': { label: 'Other', icon: 'fa-info-circle', color: 'var(--type-other)' }
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadReleases();
});

// Event Listeners Setup
function setupEventListeners() {
    elements.refreshBtn.addEventListener('click', () => loadReleases(true));
    elements.emptyRefreshBtn.addEventListener('click', () => loadReleases(true));
    
    // Search input
    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.toLowerCase().trim();
        elements.clearSearch.style.display = state.searchQuery ? 'block' : 'none';
        renderFeed();
    });
    
    elements.clearSearch.addEventListener('click', () => {
        elements.searchInput.value = '';
        state.searchQuery = '';
        elements.clearSearch.style.display = 'none';
        renderFeed();
    });
    
    // Error Banner Close
    elements.closeErrorBtn.addEventListener('click', () => {
        elements.errorBanner.style.display = 'none';
    });
    
    // Navigation items
    elements.navAll.addEventListener('click', (e) => {
        e.preventDefault();
        elements.navAll.classList.add('active');
        elements.navFavorites.classList.remove('active');
        state.activeView = 'all';
        renderFeed();
    });
    
    elements.navFavorites.addEventListener('click', (e) => {
        e.preventDefault();
        elements.navFavorites.classList.add('active');
        elements.navAll.classList.remove('active');
        state.activeView = 'favorites';
        renderFeed();
    });
    
    // Selection Drawer Actions
    elements.clearSelectionBtn.addEventListener('click', clearSelection);
    elements.tweetSelectedBtn.addEventListener('click', openTweetModalForSelected);
    
    // Modal Actions
    elements.closeModalBtn.addEventListener('click', closeTweetModal);
    elements.tweetModal.addEventListener('click', (e) => {
        if (e.target === elements.tweetModal) closeTweetModal();
    });
    
    elements.tweetTextarea.addEventListener('input', updateTweetCharacterCount);
    elements.copyTweetBtn.addEventListener('click', copyTweetToClipboard);
    elements.submitTweetBtn.addEventListener('click', sendTweetToTwitter);
}

// Fetch releases from API
async function loadReleases(forceRefresh = false) {
    if (state.isLoading) return;
    
    setLoadingState(true);
    elements.errorBanner.style.display = 'none';
    
    try {
        const url = `/api/releases${forceRefresh ? '?refresh=true' : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.status === 'success') {
            state.rawEntries = data.entries || [];
            parseEntries(state.rawEntries);
            updateCacheStatus(forceRefresh);
            
            if (data.warning) {
                showError(`Warning: ${data.warning}`);
            }
        } else {
            throw new Error(data.error || 'Failed to fetch release notes.');
        }
    } catch (error) {
        console.error(error);
        showError(error.message || 'An error occurred while connecting to the server.');
        
        // If we don't have any data rendering, show empty state
        if (state.parsedUpdates.length === 0) {
            elements.emptyState.style.display = 'flex';
            elements.releasesFeed.innerHTML = '';
        }
    } finally {
        setLoadingState(false);
    }
}

// Parse feed XML contents into fine-grained updates
function parseEntries(entries) {
    const parsed = [];
    const parser = new DOMParser();
    
    entries.forEach(entry => {
        const doc = parser.parseFromString(entry.content, 'text/html');
        let currentType = 'other';
        let currentElements = [];
        let subIndex = 0;
        
        const processCurrentBlock = () => {
            if (currentElements.length > 0) {
                const blockHtml = currentElements.map(el => el.outerHTML).join('');
                const blockText = extractPlainText(blockHtml);
                const blockId = `${entry.id}_sub_${subIndex}`;
                
                // Link is either the direct anchor inside entry, or entry link
                const link = entry.link || 'https://docs.cloud.google.com/bigquery/docs/release-notes';
                
                parsed.push({
                    id: blockId,
                    entryId: entry.id,
                    date: entry.title, // Entry title is usually the date like "June 15, 2026"
                    type: currentType.toLowerCase(),
                    html: blockHtml,
                    text: blockText,
                    link: link,
                    originalDateStr: entry.updated
                });
                
                currentElements = [];
                subIndex++;
            }
        };
        
        // Loop through children to slice by <h3> tags
        Array.from(doc.body.children).forEach(child => {
            if (child.tagName === 'H3') {
                processCurrentBlock();
                
                const typeText = child.textContent.trim().toLowerCase();
                // Map common GCP types, default to 'other'
                if (['feature', 'issue', 'deprecated', 'changed', 'resolved'].includes(typeText)) {
                    currentType = typeText;
                } else {
                    currentType = 'other';
                }
            } else {
                currentElements.push(child);
            }
        });
        
        // Process final accumulated block
        processCurrentBlock();
    });
    
    state.parsedUpdates = parsed;
    
    // Clear selection if selected IDs no longer exist
    const parsedIds = new Set(parsed.map(p => p.id));
    state.selectedIds.forEach(id => {
        if (!parsedIds.has(id)) {
            state.selectedIds.delete(id);
        }
    });
    
    updateSelectionDrawer();
    renderFilters();
    renderStats();
    renderFeed();
}

// Extract clean plain text for composing tweets
function extractPlainText(htmlString) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlString;
    
    // Add spaces/formatting for readable output
    tempDiv.querySelectorAll('code').forEach(el => {
        el.textContent = `"${el.textContent}"`;
    });
    
    // For lists, insert bullet points
    tempDiv.querySelectorAll('li').forEach(el => {
        el.innerHTML = `• ${el.innerHTML}\n`;
    });
    
    let text = tempDiv.innerText || tempDiv.textContent || '';
    
    // Clean whitespace and trim
    return text.replace(/\n\s*\n/g, '\n').replace(/ +/g, ' ').trim();
}

// Update status indicators in sidebar
function updateCacheStatus(wasRefreshed) {
    const pulseDot = elements.cacheStatus.previousElementSibling;
    pulseDot.className = 'pulse-dot';
    
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    elements.cacheStatus.textContent = `Synced at ${timeStr}`;
}

// Render dynamic filter tabs based on available categories
function renderFilters() {
    // Get unique types from parsed updates
    const types = new Set(state.parsedUpdates.map(u => u.type));
    
    let html = `<button class="filter-pill ${state.currentFilter === 'all' ? 'active' : ''}" data-type="all">All Updates</button>`;
    
    // Order of priority for filters
    const order = ['feature', 'changed', 'resolved', 'issue', 'deprecated', 'other'];
    order.forEach(type => {
        if (types.has(type)) {
            const config = CATEGORY_MAP[type] || CATEGORY_MAP.other;
            html += `<button class="filter-pill ${state.currentFilter === type ? 'active' : ''}" data-type="${type}">
                <i class="fa-solid ${config.icon}" style="margin-right: 6px; color: ${config.color}"></i>${config.label}
            </button>`;
        }
    });
    
    elements.filterPills.innerHTML = html;
    
    // Hook event listeners
    elements.filterPills.querySelectorAll('.filter-pill').forEach(btn => {
        btn.addEventListener('click', (e) => {
            elements.filterPills.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentFilter = btn.dataset.type;
            renderFeed();
        });
    });
}

// Update right sidebar stats
function renderStats() {
    elements.statTotalNotes.textContent = state.parsedUpdates.length;
    
    // Count by types
    const counts = {};
    state.parsedUpdates.forEach(u => {
        counts[u.type] = (counts[u.type] || 0) + 1;
    });
    
    let html = '';
    const order = ['feature', 'changed', 'resolved', 'issue', 'deprecated', 'other'];
    
    order.forEach(type => {
        const count = counts[type] || 0;
        if (count > 0 || type === 'feature') { // always show feature
            const config = CATEGORY_MAP[type] || CATEGORY_MAP.other;
            html += `
                <div class="dist-item">
                    <span class="dist-label">
                        <span class="dist-dot" style="background-color: ${config.color}"></span>
                        <span>${config.label}s</span>
                    </span>
                    <span class="dist-count">${count}</span>
                </div>
            `;
        }
    });
    
    elements.distributionList.innerHTML = html;
}

// Render main feed
function renderFeed() {
    // Filter updates
    let filtered = state.parsedUpdates.filter(update => {
        // Filter by category
        if (state.currentFilter !== 'all' && update.type !== state.currentFilter) {
            return false;
        }
        
        // Filter by View (favorites/selected only)
        if (state.activeView === 'favorites' && !state.selectedIds.has(update.id)) {
            return false;
        }
        
        // Filter by Search Query
        if (state.searchQuery) {
            const dateMatch = update.date.toLowerCase().includes(state.searchQuery);
            const contentMatch = update.text.toLowerCase().includes(state.searchQuery);
            const typeMatch = update.type.toLowerCase().includes(state.searchQuery);
            if (!dateMatch && !contentMatch && !typeMatch) return false;
        }
        
        return true;
    });
    
    // Toggle Empty State
    if (filtered.length === 0) {
        elements.releasesFeed.innerHTML = '';
        elements.emptyState.style.display = 'flex';
        return;
    }
    
    elements.emptyState.style.display = 'none';
    
    // Group filtered updates by date
    const grouped = {};
    filtered.forEach(update => {
        if (!grouped[update.date]) {
            grouped[update.date] = [];
        }
        grouped[update.date].push(update);
    });
    
    // Build feed HTML
    let feedHtml = '';
    
    // Dates are processed in reverse order (newest first, which is feed default)
    Object.keys(grouped).forEach(date => {
        feedHtml += `
            <div class="date-group">
                <div class="date-header">
                    <h2>${date}</h2>
                    <div class="date-line"></div>
                </div>
        `;
        
        grouped[date].forEach(update => {
            const isSelected = state.selectedIds.has(update.id);
            const config = CATEGORY_MAP[update.type] || CATEGORY_MAP.other;
            
            feedHtml += `
                <div class="release-card type-${update.type} ${isSelected ? 'selected' : ''}" 
                     data-id="${update.id}" id="card-${update.id}">
                    <div class="release-card-header">
                        <span class="type-badge">${config.label}</span>
                        <div class="card-selectors">
                            <span class="select-indicator" title="Select this update to tweet about it">
                                <i class="fa-solid fa-check"></i>
                            </span>
                        </div>
                    </div>
                    <div class="release-card-body">
                        ${update.html}
                    </div>
                    <div class="release-card-footer">
                        <a href="${update.link}" target="_blank" class="release-link" title="Open official release notes">
                            <span>Official Docs</span>
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </a>
                        <button class="tweet-card-btn" data-id="${update.id}" title="Compose a Tweet about this update">
                            <i class="fa-brands fa-x-twitter"></i>
                            <span>Tweet Update</span>
                        </button>
                    </div>
                </div>
            `;
        });
        
        feedHtml += `</div>`; // Close date-group
    });
    
    elements.releasesFeed.innerHTML = feedHtml;
    
    // Add event listeners to newly rendered cards
    const cards = elements.releasesFeed.querySelectorAll('.release-card');
    cards.forEach(card => {
        // Toggle card selection
        card.addEventListener('click', (e) => {
            // Prevent selection trigger on links and buttons
            if (e.target.closest('a') || e.target.closest('button') || e.target.closest('.release-card-footer')) {
                return;
            }
            toggleCardSelection(card.dataset.id);
        });
        
        // Tweet button event
        const tweetBtn = card.querySelector('.tweet-card-btn');
        if (tweetBtn) {
            tweetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTweetModalForSingle(tweetBtn.dataset.id);
            });
        }
    });
}

// UI State Toggles
function setLoadingState(loading) {
    state.isLoading = loading;
    if (loading) {
        elements.refreshIcon.classList.add('spinning');
        elements.loadingState.style.display = 'flex';
        elements.emptyState.style.display = 'none';
        
        const pulseDot = elements.cacheStatus.previousElementSibling;
        pulseDot.className = 'pulse-dot loading';
        elements.cacheStatus.textContent = 'Syncing...';
    } else {
        elements.refreshIcon.classList.remove('spinning');
        elements.loadingState.style.display = 'none';
    }
}

function showError(message) {
    const pulseDot = elements.cacheStatus.previousElementSibling;
    pulseDot.className = 'pulse-dot error';
    elements.cacheStatus.textContent = 'Sync Error';
    
    elements.errorBanner.querySelector('.alert-message').textContent = message;
    elements.errorBanner.style.display = 'flex';
}

// Selection Logic
function toggleCardSelection(updateId) {
    if (state.selectedIds.has(updateId)) {
        state.selectedIds.delete(updateId);
    } else {
        state.selectedIds.add(updateId);
    }
    
    // Update card styling directly for smooth response
    const card = document.getElementById(`card-${updateId}`);
    if (card) {
        card.classList.toggle('selected', state.selectedIds.has(updateId));
    }
    
    updateSelectionDrawer();
    
    // Re-render feed only if we are in favorites view, to remove unselected ones
    if (state.activeView === 'favorites') {
        renderFeed();
    }
}

function clearSelection() {
    state.selectedIds.clear();
    
    // Update active UI cards
    const cards = elements.releasesFeed.querySelectorAll('.release-card');
    cards.forEach(card => card.classList.remove('selected'));
    
    updateSelectionDrawer();
    
    if (state.activeView === 'favorites') {
        renderFeed();
    }
}

function updateSelectionDrawer() {
    const count = state.selectedIds.size;
    elements.selectedCount.textContent = count;
    
    if (count > 0) {
        elements.selectionDrawer.classList.add('active');
    } else {
        elements.selectionDrawer.classList.remove('active');
    }
}

// Tweet Modal Compositions
let currentTweetLink = '';

function openTweetModalForSingle(updateId) {
    const update = state.parsedUpdates.find(u => u.id === updateId);
    if (!update) return;
    
    // Craft tweet content
    const categoryLabel = CATEGORY_MAP[update.type]?.label || 'BigQuery Update';
    let text = `BigQuery Release Note (${update.date}) - ${categoryLabel}:\n\n`;
    
    // Clean content body
    let body = update.text;
    
    // Truncate body if it's too long (limit is 280, minus header and link)
    // Let's keep it safe. Total limit is 280, URL takes 23, title takes ~45
    // Max body length = 280 - 45 - 23 - 10 = ~200 chars.
    if (body.length > 200) {
        body = body.substring(0, 197) + '...';
    }
    
    text += body;
    currentTweetLink = update.link;
    
    elements.tweetTextarea.value = text;
    elements.tweetLinkPreview.textContent = currentTweetLink;
    
    updateTweetCharacterCount();
    elements.tweetModal.style.display = 'flex';
}

function openTweetModalForSelected() {
    if (state.selectedIds.size === 0) return;
    
    const selectedUpdates = state.parsedUpdates.filter(u => state.selectedIds.has(u.id));
    
    let text = '';
    let link = 'https://docs.cloud.google.com/bigquery/docs/release-notes';
    
    if (selectedUpdates.length === 1) {
        // Fall back to single selection formatting for cleaner look
        openTweetModalForSingle(selectedUpdates[0].id);
        return;
    }
    
    // Multi-selection summary formatting
    text = `📊 BigQuery Release Notes Summary:\n\n`;
    
    // Collect bullet points
    selectedUpdates.forEach(update => {
        const typeChar = update.type === 'feature' ? '⭐' : '🔹';
        let itemText = `${typeChar} [${update.date}] ${update.text}`;
        if (itemText.length > 80) {
            itemText = itemText.substring(0, 77) + '...';
        }
        text += `${itemText}\n`;
    });
    
    // If all updates are on the same date, use their specific date-link, otherwise default release notes page
    const uniqueDates = new Set(selectedUpdates.map(u => u.date));
    if (uniqueDates.size === 1) {
        link = selectedUpdates[0].link;
    }
    
    currentTweetLink = link;
    elements.tweetTextarea.value = text;
    elements.tweetLinkPreview.textContent = currentTweetLink;
    
    updateTweetCharacterCount();
    elements.tweetModal.style.display = 'flex';
}

function closeTweetModal() {
    elements.tweetModal.style.display = 'none';
}

// Tweet Length & URL Counter Logic
function updateTweetCharacterCount() {
    const text = elements.tweetTextarea.value;
    const textLength = text.length;
    
    // Twitter shortens all URLs to a t.co link which is exactly 23 characters.
    // If a link is attached, add 23 characters to the count (plus 1 character space)
    const linkLength = currentTweetLink ? 24 : 0;
    const totalCount = textLength + linkLength;
    
    elements.charCount.textContent = totalCount;
    
    // Color code counter and toggle warning banner
    if (totalCount > 280) {
        elements.charCount.className = 'danger';
        elements.tweetLengthWarning.style.display = 'flex';
    } else if (totalCount > 250) {
        elements.charCount.className = 'warning';
        elements.tweetLengthWarning.style.display = 'none';
    } else {
        elements.charCount.className = '';
        elements.tweetLengthWarning.style.display = 'none';
    }
}

// Open Twitter intent in a new tab
function sendTweetToTwitter() {
    const text = elements.tweetTextarea.value;
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(currentTweetLink)}`;
    window.open(tweetUrl, '_blank');
    closeTweetModal();
}

// Helper to copy text to clipboard
function copyTweetToClipboard() {
    let fullText = elements.tweetTextarea.value;
    if (currentTweetLink) {
        fullText += `\n${currentTweetLink}`;
    }
    
    navigator.clipboard.writeText(fullText).then(() => {
        showToast('Tweet copied to clipboard!');
    }).catch(err => {
        console.error('Could not copy text: ', err);
        showToast('Failed to copy to clipboard.');
    });
}

// Custom animated Toast
function showToast(message) {
    elements.toast.querySelector('.toast-message').textContent = message;
    elements.toast.classList.add('show');
    
    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}
