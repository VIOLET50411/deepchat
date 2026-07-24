(function () {
    'use strict';

    const STORAGE_KEYS = { CONVERSATIONS: 'dsc_convs', ACTIVE_CONV: 'dsc_active', SETTINGS: 'dsc_settings', THEME: 'dsc_theme' };
    const DEFAULT_SETTINGS = { apiKey: '', model: 'deepseek-v4-pro', temperature: 1.0, maxTokens: 4096, systemPrompt: '', userName: 'Locin', userAvatar: null, currentBalance: null, baseBalance: null };

    let state = { conversations: [], activeConversationId: null, settings: { ...DEFAULT_SETTINGS }, isGenerating: false, abortController: null, streamBuffer: '', renderedContent: '', streamRAFId: null, isThinking: false, editingMessageId: null };

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
        scrollToBottomBtn: $('#scrollToBottomBtn'),
        
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
        renderActiveConversation('switch');
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

    window.cancelEdit = function() {
        state.editingMessageId = null;
        renderActiveConversation('switch');
    };

    window.saveEdit = async function(msgId) {
        const textarea = document.getElementById('edit_textarea_' + msgId);
        if (!textarea) return;
        const newContent = textarea.value.trim();
        if (!newContent) return;
        
        const conv = state.conversations.find(c => c.id === state.activeConversationId);
        if (!conv) return;
        
        const msgIndex = conv.messages.findIndex(m => m.id === msgId);
        if (msgIndex === -1) return;
        
        // Truncate conversation to this point
        conv.messages = conv.messages.slice(0, msgIndex);
        conv.messages.push({ id: msgId, role: 'user', content: newContent });
        
        state.editingMessageId = null;
        renderActiveConversation('append');
        saveData();
        await callAPI(conv);
    };

    function createMessageHTML(m) {
        if (!m.id) m.id = 'msg_' + Math.random().toString(36).substr(2, 9);
        
        if (state.editingMessageId === m.id) {
            return `
                <div class="message user" data-id="${m.id}">
                    <div class="edit-mode-container">
                        <textarea class="edit-textarea" id="edit_textarea_${m.id}">${escapeHtml(m.content)}</textarea>
                        <div class="edit-actions">
                            <button class="btn-cancel" onclick="window.cancelEdit()">取消</button>
                            <button class="btn-save" onclick="window.saveEdit('${m.id}')">发送</button>
                        </div>
                    </div>
                </div>
            `;
        }

        if (m.isThinking) {
            return `
                <div class="message assistant" data-id="${m.id}">
                    <div class="thinking-graphic-container">
                        <div class="thinking-core"></div>
                        <div class="thinking-particle particle-1"></div>
                        <div class="thinking-particle particle-2"></div>
                        <div class="thinking-particle particle-3"></div>
                    </div>
                </div>
            `;
        }
        return `
            <div class="message ${m.role}" data-id="${m.id}">
                <div class="message-bubble">${renderMarkdown(m.content)}</div>
                ${m.role === 'assistant' ? `
                <div class="message-actions">
                    <button class="action-btn" data-action="copy" data-id="${m.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                    <button class="action-btn" data-action="good" data-id="${m.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button>
                    <button class="action-btn" data-action="bad" data-id="${m.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg></button>
                    <button class="action-btn" data-action="regenerate" data-id="${m.id}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>
                </div>` : ''}
            </div>
        `;
    }

    function startStreamRenderer() {
        if (state.streamRAFId) cancelAnimationFrame(state.streamRAFId);
        
        let lastTime = performance.now();
        const renderLoop = (time) => {
            const dt = time - lastTime;
            const diff = state.streamBuffer.length - state.renderedContent.length;
            
            if (diff > 0) {
                let chunkSize = 1;
                if (diff > 100) chunkSize = Math.ceil(diff / 5);
                else if (diff > 20) chunkSize = Math.ceil(diff / 10);
                else if (diff > 5) chunkSize = 2;
                
                state.renderedContent += state.streamBuffer.substring(state.renderedContent.length, state.renderedContent.length + chunkSize);
                
                const lastEl = DOM.messagesList.lastElementChild;
                if (lastEl && lastEl.classList.contains('assistant')) {
                    const bubble = lastEl.querySelector('.message-bubble');
                    if (bubble) {
                        bubble.innerHTML = renderMarkdown(state.renderedContent);
                        const container = DOM.messagesContainer;
                        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 200;
                        if (isNearBottom) container.scrollTop = container.scrollHeight;
                    }
                }
            } else if (!state.isGenerating && diff === 0) {
                stopStreamRenderer();
                return;
            }
            
            lastTime = time;
            state.streamRAFId = requestAnimationFrame(renderLoop);
        };
        state.streamRAFId = requestAnimationFrame(renderLoop);
    }

    function stopStreamRenderer() {
        if (state.streamRAFId) {
            cancelAnimationFrame(state.streamRAFId);
            state.streamRAFId = null;
        }
    }

    function renderActiveConversation(mode = 'switch') {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);

        if (mode === 'append') {
            if (!conv || conv.messages.length === 0) return;
            DOM.welcomeScreen.classList.add('hidden');
            const now = new Date();
            const timeStr = `今天 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
            const dateHTML = `<div class="message-date">${timeStr}</div>`;
            DOM.messagesList.innerHTML = dateHTML + conv.messages.map(m => createMessageHTML(m)).join('');
            DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
            return;
        }

        DOM.messagesContainer.classList.add('page-transition');
        
        setTimeout(() => {
            if (!conv || conv.messages.length === 0) {
                DOM.welcomeScreen.classList.remove('hidden');
                DOM.messagesList.innerHTML = '';
            } else {
                DOM.welcomeScreen.classList.add('hidden');
                const now = new Date();
                const timeStr = `今天 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
                const dateHTML = `<div class="message-date">${timeStr}</div>`;
                DOM.messagesList.innerHTML = dateHTML + conv.messages.map(m => createMessageHTML(m)).join('');
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
        renderActiveConversation('append');
        renderSidebar();
        saveData();

        await callAPI(conv);
    }

    async function callAPI(conv) {
        setGeneratingState(true);
        state.abortController = new AbortController();
        
        state.isThinking = true;
        state.streamBuffer = '';
        state.renderedContent = '';

        // Add placeholder AI message (Thinking State)
        conv.messages.push({ role: 'assistant', content: '', isThinking: true });
        renderActiveConversation('append');

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
                                if (state.isThinking) {
                                    state.isThinking = false;
                                    conv.messages[conv.messages.length - 1].isThinking = false;
                                    
                                    const lastEl = DOM.messagesList.lastElementChild;
                                    if (lastEl) lastEl.outerHTML = createMessageHTML(conv.messages[conv.messages.length - 1]);
                                    
                                    startStreamRenderer();
                                }
                                state.streamBuffer += data.choices[0].delta.content;
                                conv.messages[conv.messages.length - 1].content = state.streamBuffer;
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                conv.messages[conv.messages.length - 1].isThinking = false;
                conv.messages[conv.messages.length - 1].content = '发送失败，请检查网络或 API Key。';
                renderActiveConversation('append');
            }
        } finally {
            setGeneratingState(false);
            if (state.isThinking) {
                // If aborted or failed during thinking state
                conv.messages[conv.messages.length - 1].isThinking = false;
                renderActiveConversation('append');
            }
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
                    
                    let { currentBalance, baseBalance } = state.settings;
                    
                    if (currentBalance === null || baseBalance === null) {
                        currentBalance = balance;
                        baseBalance = balance > 0 ? balance : 50; 
                    } else if (balance > currentBalance) {
                        // Recharged!
                        baseBalance = balance;
                        currentBalance = balance;
                    } else {
                        currentBalance = balance;
                    }
                    
                    state.settings.currentBalance = currentBalance;
                    state.settings.baseBalance = baseBalance;
                    saveData();

                    let percentage = baseBalance > 0 ? (currentBalance / baseBalance) * 100 : 0;
                    if (percentage > 100) percentage = 100;
                    if (percentage < 0) percentage = 0;
                    
                    DOM.balanceRingFill.setAttribute('stroke-dasharray', `${percentage}, 100`);
                    
                    if (percentage < 20) DOM.balanceRingFill.style.stroke = '#ff3b30';
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

        // ========== Long Press & Context Menu ==========
        let activeMessageId = null;

        let pressTimer = null;
        let isLongPress = false;

        function handlePressStart(e) {
            if (e.button === 2) return; // ignore right click
            const bubble = e.target.closest('.message-bubble');
            if (!bubble) return;
            const msgEl = bubble.closest('.message');
            if (!msgEl) return;
            // only allow user messages to be edited for now
            if (msgEl.classList.contains('assistant')) return;
            
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                activeMessageId = msgEl.getAttribute('data-id');
                showContextMenu(e, msgEl);
            }, 500);
        }
        function handlePressEnd() { if (pressTimer) clearTimeout(pressTimer); }
        function handlePressMove() { if (pressTimer) clearTimeout(pressTimer); }

        DOM.messagesList.addEventListener('touchstart', handlePressStart, {passive: true});
        DOM.messagesList.addEventListener('touchend', handlePressEnd);
        DOM.messagesList.addEventListener('touchmove', handlePressMove, {passive: true});
        DOM.messagesList.addEventListener('mousedown', handlePressStart);
        DOM.messagesList.addEventListener('mouseup', handlePressEnd);
        DOM.messagesList.addEventListener('mousemove', handlePressMove);
        DOM.messagesList.addEventListener('contextmenu', (e) => {
            const msgEl = e.target.closest('.message.user');
            if (msgEl) e.preventDefault(); // Prevent native context menu on user bubbles
        });

        const ctxOverlay = document.getElementById('contextMenuOverlay');
        const ctxMenu = document.getElementById('contextMenu');
        
        function showContextMenu(e, msgEl) {
            if ('vibrate' in navigator) navigator.vibrate(50);
            ctxOverlay.classList.add('active');
            
            // Disable text selection on bubble while menu is open
            msgEl.style.userSelect = 'none';
            msgEl.style.webkitUserSelect = 'none';
            
            const rect = msgEl.getBoundingClientRect();
            let top = rect.top + 10;
            let left = rect.left + 20;
            
            // Adjust if near right edge
            if (msgEl.classList.contains('user')) {
                left = rect.right - 220;
            }
            
            if (left < 10) left = 10;
            if (top + 160 > window.innerHeight) top = window.innerHeight - 180;
            
            ctxMenu.style.top = top + 'px';
            ctxMenu.style.left = left + 'px';
            setTimeout(() => ctxMenu.classList.add('active'), 10);
        }

        function hideContextMenu() {
            ctxMenu.classList.remove('active');
            setTimeout(() => ctxOverlay.classList.remove('active'), 200);
            
            const conv = state.conversations.find(c => c.id === state.activeConversationId);
            const msg = conv?.messages.find(m => m.id === activeMessageId);
            if (msg) {
                const el = document.querySelector(`.message[data-id="${activeMessageId}"]`);
                if (el) {
                    el.style.userSelect = '';
                    el.style.webkitUserSelect = '';
                }
            }
            activeMessageId = null;
        }

        function showToast(msg) {
            const container = document.getElementById('toastContainer');
            if (!container) return;
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = msg;
            container.appendChild(toast);
            
            // Trigger reflow
            void toast.offsetWidth;
            toast.classList.add('active');
            
            setTimeout(() => {
                toast.classList.remove('active');
                setTimeout(() => toast.remove(), 300);
            }, 2000);
        }

        ctxMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (!item || !activeMessageId) return;
            const action = item.getAttribute('data-action');
            
            const conv = state.conversations.find(c => c.id === state.activeConversationId);
            const msg = conv?.messages.find(m => m.id === activeMessageId);
            const el = document.querySelector(`.message[data-id="${activeMessageId}"]`);
            
            if (action === 'copy' && msg) {
                navigator.clipboard.writeText(msg.content);
                showToast('已复制');
                hideContextMenu();
            } else if (action === 'edit' && msg) {
                state.editingMessageId = activeMessageId;
                renderActiveConversation('switch');
                hideContextMenu();
            } else if (action === 'select' && msg && el) {
                // allow native selection
                hideContextMenu();
                el.style.userSelect = 'text';
                el.style.webkitUserSelect = 'text';
                
                // Programmatically select text
                const bubble = el.querySelector('.message-bubble');
                if (bubble) {
                    const range = document.createRange();
                    range.selectNodeContents(bubble);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            } else {
                hideContextMenu();
            }
        });

        // ========== Action Buttons (Assistant) ==========
        DOM.messagesList.addEventListener('click', async (e) => {
            const btn = e.target.closest('.action-btn');
            if (!btn) return;
            const action = btn.getAttribute('data-action');
            const msgId = btn.getAttribute('data-id');
            
            const conv = state.conversations.find(c => c.id === state.activeConversationId);
            if (!conv) return;
            const msgIndex = conv.messages.findIndex(m => m.id === msgId);
            if (msgIndex === -1) return;
            const msg = conv.messages[msgIndex];

            if (action === 'copy') {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(msg.content).then(() => {
                        showToast('已复制');
                    }).catch(() => {
                        showToast('复制失败');
                    });
                } else {
                    // Fallback for older browsers
                    const textArea = document.createElement("textarea");
                    textArea.value = msg.content;
                    document.body.appendChild(textArea);
                    textArea.select();
                    try {
                        document.execCommand('copy');
                        showToast('已复制');
                    } catch (err) {
                        showToast('复制失败');
                    }
                    document.body.removeChild(textArea);
                }
            } else if (action === 'regenerate') {
                if (state.isGenerating) return;
                // Truncate from this assistant message
                conv.messages = conv.messages.slice(0, msgIndex);
                renderActiveConversation('switch');
                await callAPI(conv);
            } else if (action === 'good') {
                showToast('感谢反馈');
            } else if (action === 'bad') {
                showToast('我们会改进的');
            }
        });

        DOM.menuBtn.addEventListener('click', () => toggleDrawer(true));
        DOM.mainOverlay.addEventListener('click', () => toggleDrawer(false));
        DOM.closeSidebarBtn.addEventListener('click', () => toggleDrawer(false));
        
        DOM.newChatBtnMain.addEventListener('click', createConversation);
        
        DOM.themeToggle.addEventListener('click', toggleTheme);
        
        DOM.messagesContainer.addEventListener('scroll', () => {
            const container = DOM.messagesContainer;
            const hasScrollbar = container.scrollHeight > container.clientHeight;
            const isScrolledUp = (container.scrollHeight - container.scrollTop - container.clientHeight) > 100;
            if (hasScrollbar && isScrolledUp) {
                DOM.scrollToBottomBtn.classList.add('visible');
            } else {
                DOM.scrollToBottomBtn.classList.remove('visible');
            }
        });
        
        DOM.scrollToBottomBtn.addEventListener('click', () => {
            DOM.messagesContainer.scrollTo({
                top: DOM.messagesContainer.scrollHeight,
                behavior: 'smooth'
            });
        });
        
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
            renderSearchResults(''); // Clears and hides results
        });
        
        DOM.closeSearchBtn.addEventListener('click', () => {
            DOM.searchOverlay.classList.remove('active');
            DOM.searchInput.value = '';
            renderSearchResults('');
        });
        
        DOM.searchOverlay.addEventListener('click', (e) => {
            if (e.target === DOM.searchOverlay || e.target === DOM.searchResults) {
                DOM.searchOverlay.classList.remove('active');
                DOM.searchInput.value = '';
                renderSearchResults('');
            }
        });
        
        DOM.searchInput.addEventListener('input', (e) => {
            renderSearchResults(e.target.value);
        });
        
        function renderSearchResults(query) {
            query = query.toLowerCase().trim();
            DOM.searchResults.innerHTML = '';
            
            if (!query) return; // Hide results if no search term
            
            let results = state.conversations;
            if (query) {
                results = results.filter(c => {
                    const titleMatch = c.title && c.title.toLowerCase().includes(query);
                    const msgMatch = c.messages.some(m => m.content.toLowerCase().includes(query));
                    return titleMatch || msgMatch;
                });
            }
            
            if (results.length === 0) {
                DOM.searchResults.innerHTML = `
                    <div style="text-align:center; padding:60px 20px; color:var(--text-secondary); display:flex; flex-direction:column; align-items:center;">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px; opacity:0.6;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <div>暂无相关结果</div>
                    </div>
                `;
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
                
                // Format date correctly by ensuring it's a number
                const ts = Number(conv.updatedAt || conv.id);
                const date = new Date(ts);
                const dateStr = !isNaN(date) ? `${date.getMonth()+1}月${date.getDate()}日` : '';
                
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
