(function () {
    'use strict';

    const STORAGE_KEYS = { CONVERSATIONS: 'dsc_convs', ACTIVE_CONV: 'dsc_active', SETTINGS: 'dsc_settings', THEME: 'dsc_theme' };
    const DEFAULT_SETTINGS = { apiKey: '', model: 'deepseek-v4-pro', temperature: 1.0, maxTokens: 4096, systemPrompt: '', userName: 'Locin', userAvatar: null };

    let state = { conversations: [], activeConversationId: null, settings: { ...DEFAULT_SETTINGS }, isGenerating: false, abortController: null };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const DOM = {
        html: document.documentElement,
        mainView: $('#mainView'),
        mainOverlay: $('#mainOverlay'),
        menuBtn: $('#menuBtn'),
        closeSidebarBtn: $('#closeSidebarBtn'),
        newChatBtnMain: $('#newChatBtnMain'),
        themeToggle: $('#themeToggle'),
        
        conversationList: $('#conversationList'),
        welcomeScreen: $('#welcomeScreen'),
        messagesContainer: $('#messagesContainer'),
        messagesList: $('#messagesList'),
        
        messageInput: $('#messageInput'),
        sendBtn: $('#sendBtn'),
        sendArrow: $('#sendArrow'),
        stopBtn: $('#stopBtn'),
        
        settingsBtn: $('#settingsBtn'),
        settingsOverlay: $('#settingsOverlay'),
        settingsPanel: $('#settingsPanel'),
        closeSettingsBtn: $('#closeSettingsBtn'),
        apiKeyInput: $('#apiKeyInput'),
        modelSelect: $('#modelSelect'),
        
        balanceText: $('#balanceText'),
        balanceRingFill: $('#balanceRingFill'),
        
        searchBtnSidebar: $('#searchBtnSidebar'),
        searchOverlay: $('#searchOverlay'),
        closeSearchBtn: $('#closeSearchBtn'),
        searchInput: $('#searchInput'),
        searchResults: $('#searchResults'),
        settingsProfile: $('#settingsProfile'),
        profileAvatarBg: $('#profileAvatarBg'),
        profileAvatarInitials: $('#profileAvatarInitials'),
        avatarUploadInput: $('#avatarUploadInput'),
        profileName: $('#profileName')
    };

    function updateProfileUI() {
        const name = state.settings.userName || 'Locin';
        if (DOM.profileName) DOM.profileName.textContent = name;
        
        if (state.settings.userAvatar && DOM.profileAvatarBg) {
            DOM.profileAvatarBg.style.backgroundImage = `url(${state.settings.userAvatar})`;
            DOM.profileAvatarBg.style.backgroundSize = 'cover';
            DOM.profileAvatarBg.style.backgroundPosition = 'center';
            if (DOM.profileAvatarInitials) DOM.profileAvatarInitials.style.display = 'none';
        } else {
            if (DOM.profileAvatarBg) DOM.profileAvatarBg.style.backgroundImage = 'none';
            if (DOM.profileAvatarInitials) {
                DOM.profileAvatarInitials.style.display = 'inline';
                DOM.profileAvatarInitials.textContent = name.substring(0, 2).toUpperCase();
            }
        }
    }

    function initTheme() {
        const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        DOM.html.setAttribute('data-theme', savedTheme);
        updateThemeMeta(savedTheme);
    }

    function toggleTheme() {
        const newTheme = DOM.html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        DOM.html.setAttribute('data-theme', newTheme);
        localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
        updateThemeMeta(newTheme);
    }

    function updateThemeMeta(theme) {
        const meta = document.getElementById('themeColorMeta');
        if (meta) {
            meta.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff');
        }
    }

    function toggleDrawer(open) {
        if (open) DOM.mainView.classList.add('drawer-open');
        else DOM.mainView.classList.remove('drawer-open');
    }

    function handleInputState() {
        const hasText = DOM.messageInput.value.trim().length > 0;
        if (hasText) {
            DOM.sendArrow.classList.add('typing');
        } else {
            DOM.sendArrow.classList.remove('typing');
        }
        
        // Auto-resize
        DOM.messageInput.style.height = 'auto';
        DOM.messageInput.style.height = Math.min(DOM.messageInput.scrollHeight, 120) + 'px';
    }

    function setGeneratingState(isGen) {
        state.isGenerating = isGen;
        if (isGen) {
            DOM.sendBtn.classList.add('hidden');
            DOM.stopBtn.classList.remove('hidden');
        } else {
            DOM.stopBtn.classList.add('hidden');
            DOM.sendBtn.classList.remove('hidden');
            handleInputState();
        }
    }

    function loadData() {
        try {
            const c = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
            if (c) state.conversations = JSON.parse(c);
            state.activeConversationId = localStorage.getItem(STORAGE_KEYS.ACTIVE_CONV);
            const s = localStorage.getItem(STORAGE_KEYS.SETTINGS);
            if (s) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(s) };
        } catch (e) {}
    }

    function saveData() {
        localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(state.conversations));
        localStorage.setItem(STORAGE_KEYS.ACTIVE_CONV, state.activeConversationId || '');
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(state.settings));
    }

    function createConversation() {
        const conv = { id: Date.now().toString(), title: '新对话', messages: [] };
        state.conversations.unshift(conv);
        state.activeConversationId = conv.id;
        saveData();
        renderSidebar();
        renderActiveConversation();
        toggleDrawer(false);
    }

    function renderSidebar() {
        DOM.conversationList.innerHTML = state.conversations.map(c => `
            <div class="conv-item ${c.id === state.activeConversationId ? 'active' : ''}" onclick="window.__switchConv('${c.id}')">
                <span class="conv-title">${escapeHtml(c.title)}</span>
                <button class="btn-rename" onclick="event.stopPropagation(); window.__renameConv('${c.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
            </div>
        `).join('');
    }

    window.__switchConv = (id) => {
        if (state.activeConversationId === id) { toggleDrawer(false); return; }
        state.activeConversationId = id;
        saveData();
        renderSidebar(); // Update active class
        renderActiveConversation();
        toggleDrawer(false);
    };

    window.__renameConv = (id) => {
        const conv = state.conversations.find(c => c.id === id);
        if (!conv) return;
        const newName = prompt('重命名对话:', conv.title);
        if (newName && newName.trim() !== '') {
            conv.title = newName.trim();
            saveData();
            renderSidebar();
        }
    };

    function renderActiveConversation() {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        
        DOM.messagesContainer.classList.add('page-transition');
        
        setTimeout(() => {
            if (!conv || conv.messages.length === 0) {
                DOM.welcomeScreen.classList.remove('hidden');
                DOM.messagesList.innerHTML = '';
            } else {
                DOM.welcomeScreen.classList.add('hidden');
                DOM.messagesList.innerHTML = conv.messages.map(m => `
                    <div class="message ${m.role}">
                        <div class="message-bubble">${renderMarkdown(m.content)}</div>
                        ${m.role === 'assistant' ? `
                        <div class="message-actions">
                            <button><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                            <button><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>
                        </div>` : ''}
                    </div>
                `).join('');
                DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
            }
            
            // Force browser reflow to restart transition
            void DOM.messagesContainer.offsetWidth;
            DOM.messagesContainer.classList.remove('page-transition');
        }, 50);
    }

    async function sendMessage() {
        const content = DOM.messageInput.value.trim();
        if (!content || state.isGenerating) return;

        if (!state.settings.apiKey) {
            alert('请先在设置中填写 API Key');
            return;
        }

        let conv = state.conversations.find(c => c.id === state.activeConversationId);
        if (!conv) {
            conv = { id: Date.now().toString(), title: content.substring(0, 20), messages: [] };
            state.conversations.unshift(conv);
            state.activeConversationId = conv.id;
        } else if (conv.title === '新对话') {
            conv.title = content.substring(0, 20);
        }

        conv.messages.push({ role: 'user', content });
        DOM.messageInput.value = '';
        handleInputState();
        renderActiveConversation();
        renderSidebar();
        saveData();

        await callAPI(conv);
    }

    async function callAPI(conv) {
        setGeneratingState(true);
        state.abortController = new AbortController();

        // Add placeholder AI message
        conv.messages.push({ role: 'assistant', content: '...' });
        renderActiveConversation();

        try {
            const payload = {
                model: state.settings.model,
                messages: conv.messages.slice(0, -1).map(m => ({role: m.role, content: m.content})),
                stream: true
            };
            if (state.settings.model === 'deepseek-v4-pro') {
                payload.thinking = { type: "enabled" };
                payload.reasoning_effort = "high";
            }

            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` },
                body: JSON.stringify(payload),
                signal: state.abortController.signal
            });

            if (!response.ok) throw new Error('API Error');

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let fullContent = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.trim() === 'data: [DONE]') continue;
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.choices[0].delta.content) {
                                fullContent += data.choices[0].delta.content;
                                conv.messages[conv.messages.length - 1].content = fullContent;
                                renderActiveConversation();
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                conv.messages[conv.messages.length - 1].content = '发送失败，请检查网络或 API Key。';
                renderActiveConversation();
            }
        } finally {
            setGeneratingState(false);
            saveData();
        }
    }

    function renderMarkdown(text) {
        let html = text;
        if (typeof marked !== 'undefined') {
            html = marked.parse(text);
        } else {
            html = escapeHtml(text).replace(/\n/g, '<br>');
        }
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html);
        }
        return html;
    }
    function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

    async function fetchBalance() {
        if (!state.settings.apiKey) return;
        try {
            const res = await fetch('https://api.deepseek.com/user/balance', {
                headers: { 'Authorization': `Bearer ${state.settings.apiKey}` }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.is_available && data.balance_infos.length > 0) {
                    const balance = parseFloat(data.balance_infos[0].total_balance);
                    DOM.balanceText.textContent = balance.toFixed(2);
                    
                    // Assuming a max balance of 100 for the percentage ring (adjust as needed)
                    const maxBalance = 50; 
                    let percentage = (balance / maxBalance) * 100;
                    if (percentage > 100) percentage = 100;
                    DOM.balanceRingFill.setAttribute('stroke-dasharray', `${percentage}, 100`);
                    
                    if (percentage < 20) DOM.balanceRingFill.style.stroke = '#ff3b30'; // Red if low
                    else DOM.balanceRingFill.style.stroke = 'var(--blue-action)';
                }
            }
        } catch (e) {}
    }

    function bindEvents() {
        // iOS PWA height & keyboard sync
        if (window.visualViewport) {
            const vv = window.visualViewport;
            const syncViewport = () => {
                // In iOS PWA, window.innerHeight is the full physical screen height.
                // visualViewport.height shrinks when the keyboard opens.
                const keyboardOpen = (window.innerHeight - vv.height) > 100;
                document.body.classList.toggle('keyboard-open', keyboardOpen);
                
                // Calculate how much the keyboard has pushed up
                let offset = window.innerHeight - vv.height;
                // Force 0 when closed to ensure no safe-area gap issues
                if (!keyboardOpen) offset = 0; 
                
                document.documentElement.style.setProperty('--keyboard-offset', offset + 'px');
                
                if (keyboardOpen && DOM.messagesContainer) {
                    requestAnimationFrame(() => {
                        DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
                    });
                }
                window.scrollTo(0, 0);
            };
            vv.addEventListener('resize', syncViewport);
            vv.addEventListener('scroll', syncViewport);
            syncViewport();
        }

        // Prevent iOS rubber-band scrolling on non-scrollable elements
        document.addEventListener('touchmove', (e) => {
            if (!e.target.closest('.messages-container, .conversation-list, .settings-body')) {
                e.preventDefault();
            }
        }, { passive: false });

        DOM.menuBtn.addEventListener('click', () => toggleDrawer(true));
        DOM.mainOverlay.addEventListener('click', () => toggleDrawer(false));
        DOM.closeSidebarBtn.addEventListener('click', () => toggleDrawer(false));
        
        DOM.newChatBtnMain.addEventListener('click', createConversation);
        
        DOM.themeToggle.addEventListener('click', toggleTheme);
        
        DOM.messageInput.addEventListener('input', handleInputState);
        DOM.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        DOM.sendBtn.addEventListener('click', sendMessage);
        DOM.stopBtn.addEventListener('click', () => state.abortController?.abort());
        
        DOM.settingsBtn.addEventListener('click', () => {
            DOM.apiKeyInput.value = state.settings.apiKey;
            DOM.modelSelect.value = state.settings.model;
            updateProfileUI();
            // Update theme label
            const themeText = document.getElementById('themeValueText');
            if (themeText) themeText.textContent = DOM.html.getAttribute('data-theme') === 'dark' ? '深色' : '浅色';
            DOM.settingsOverlay.classList.add('active');
            DOM.settingsPanel.classList.add('active');
        });
        const closeSettings = () => {
            state.settings.apiKey = DOM.apiKeyInput.value.trim();
            state.settings.model = DOM.modelSelect.value;
            saveData();
            fetchBalance();
            DOM.settingsOverlay.classList.remove('active');
            DOM.settingsPanel.classList.remove('active');
        };
        DOM.closeSettingsBtn.addEventListener('click', closeSettings);
        DOM.settingsOverlay.addEventListener('click', closeSettings);

        // Edit Profile
        if (DOM.profileName) {
            DOM.profileName.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentName = state.settings.userName || 'Locin';
                const newName = prompt('修改你的名字：', currentName);
                if (newName && newName.trim()) {
                    state.settings.userName = newName.trim();
                    saveData();
                    updateProfileUI();
                }
            });
        }
        
        // Upload Avatar
        if (DOM.profileAvatarBg && DOM.avatarUploadInput) {
            DOM.profileAvatarBg.addEventListener('click', (e) => {
                e.stopPropagation();
                DOM.avatarUploadInput.click();
            });
            
            DOM.avatarUploadInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(event) {
                        state.settings.userAvatar = event.target.result;
                        saveData();
                        updateProfileUI();
                    };
                    reader.readAsDataURL(file);
                }
            });
        }

        // Theme toggle inside settings
        const themeSettingsRow = document.getElementById('themeSettingsRow');
        if (themeSettingsRow) {
            themeSettingsRow.addEventListener('click', () => {
                toggleTheme();
                const themeText = document.getElementById('themeValueText');
                if (themeText) themeText.textContent = DOM.html.getAttribute('data-theme') === 'dark' ? '深色' : '浅色';
            });
        }

        // Clear all conversations
        const clearDataRow = document.getElementById('clearDataRow');
        if (clearDataRow) {
            clearDataRow.addEventListener('click', () => {
                if (confirm('确定要清除所有对话记录吗？此操作不可撤回。')) {
                    state.conversations = [];
                    state.activeConversationId = null;
                    saveData();
                    renderConversationList();
                    createConversation();
                    closeSettings();
                }
            });
        }

        // Auto-save API key on change
        DOM.apiKeyInput.addEventListener('change', () => {
            state.settings.apiKey = DOM.apiKeyInput.value.trim();
            saveData();
            fetchBalance();
        });
        DOM.modelSelect.addEventListener('change', () => {
            state.settings.model = DOM.modelSelect.value;
            saveData();
        });

        // --- Search Logic ---
        DOM.searchBtnSidebar.addEventListener('click', () => {
            DOM.searchOverlay.classList.add('active');
            DOM.searchInput.focus();
            renderSearchResults('');
        });
        
        DOM.closeSearchBtn.addEventListener('click', () => {
            DOM.searchOverlay.classList.remove('active');
            DOM.searchInput.value = '';
        });
        
        DOM.searchInput.addEventListener('input', (e) => {
            renderSearchResults(e.target.value);
        });
        
        function renderSearchResults(query) {
            query = query.toLowerCase().trim();
            DOM.searchResults.innerHTML = '';
            
            let results = state.conversations;
            if (query) {
                results = results.filter(c => {
                    const titleMatch = c.title && c.title.toLowerCase().includes(query);
                    const msgMatch = c.messages.some(m => m.content.toLowerCase().includes(query));
                    return titleMatch || msgMatch;
                });
            }
            
            if (results.length === 0) {
                DOM.searchResults.innerHTML = '<div style="text-align:center; padding:40px 20px; color:var(--text-secondary);">无结果</div>';
                return;
            }
            
            results.forEach(conv => {
                const item = document.createElement('div');
                item.className = 'search-result-item';
                
                // Get a snippet
                let snippet = '没有内容...';
                if (conv.messages.length > 0) {
                    const matchMsg = conv.messages.find(m => m.content.toLowerCase().includes(query));
                    snippet = matchMsg ? matchMsg.content : conv.messages[conv.messages.length - 1].content;
                }
                
                // Format date (simplified)
                const date = new Date(conv.updatedAt || conv.id);
                const dateStr = `${date.getMonth()+1}月${date.getDate()}日`;
                
                item.innerHTML = `
                    <div class="search-result-icon">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    </div>
                    <div class="search-result-content">
                        <div class="search-result-title-row">
                            <div class="search-result-title">${escapeHtml(conv.title || '新对话')}</div>
                            <div class="search-result-date">${dateStr}</div>
                        </div>
                        <div class="search-result-snippet">${escapeHtml(snippet)}</div>
                    </div>
                `;
                
                item.addEventListener('click', () => {
                    switchConversation(conv.id);
                    DOM.searchOverlay.classList.remove('active');
                    DOM.mainView.classList.remove('drawer-open');
                });
                
                DOM.searchResults.appendChild(item);
            });
        }
    }

    function init() {
        initTheme();
        loadData();
        renderSidebar();
        
        if (state.conversations.length === 0) createConversation();
        else renderActiveConversation();
        
        bindEvents();
        fetchBalance();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
