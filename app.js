(function () {
    'use strict';

    const STORAGE_KEYS = { CONVERSATIONS: 'dsc_convs', ACTIVE_CONV: 'dsc_active', SETTINGS: 'dsc_settings', THEME: 'dsc_theme' };
    const DEFAULT_LONG_TERM_INSTRUCTIONS = '当任务需要选择方案、计划或下一步时，请提供 2–4 个清晰、具体的编号选项，并标注推荐项；如果用户明确要求每次都给选项，就在后续每一轮继续遵守，但任务已完全确定且不需要选择时不要为了凑数制造无意义选项。用户要求你完成任务时，请在同一轮立即开始执行，并给出实际结果、已完成的第一步或可验证的进展；不要只说“我会”“准备”“将要”然后停下。如果确实受阻，请明确说明具体阻塞点，并给出能继续推进的替代方案。';
    const DEFAULT_SETTINGS = {
        apiKey: '',
        model: 'deepseek-v4-pro',
        temperature: 1.0,
        maxTokens: 8192,
        systemPrompt: '你是一个有帮助的AI助手。请记住整个对话的上下文，包括用户之前提出的问题、给出的选项和做出的选择。在回答时始终参考之前的对话内容。',
        longTermInstructions: DEFAULT_LONG_TERM_INSTRUCTIONS,
        userName: 'Locin',
        userAvatar: null,
        currentBalance: null,
        baseBalance: null
    };

    let state = { conversations: [], activeConversationId: null, settings: { ...DEFAULT_SETTINGS }, isGenerating: false, abortController: null, streamBuffer: '', renderedContent: '', streamRAFId: null, streamMessageId: null, streamScrollCleanup: null, isThinking: false, editingMessageId: null, userScrolledUp: false };
    let lastDrawerFocus = null;

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
        conversationMenuOverlay: $('#conversationMenuOverlay'),
        conversationMenu: $('#conversationMenu'),
        conversationMenuPinLabel: $('#conversationMenuPinLabel'),
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
        profileName: $('#profileName'),
        systemPromptInput: $('#systemPromptInput'),
        longTermInstructionsInput: $('#longTermInstructionsInput')
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
        const shouldOpen = Boolean(open);
        if (shouldOpen) {
            if (!DOM.mainView.classList.contains('drawer-open')) {
                lastDrawerFocus = document.activeElement;
            }
            DOM.mainView.classList.add('drawer-open');
            DOM.menuBtn.setAttribute('aria-expanded', 'true');
            const closeButton = DOM.closeSidebarBtn;
            if (closeButton) requestAnimationFrame(() => closeButton.focus({ preventScroll: true }));
        } else {
            DOM.mainView.classList.remove('drawer-open');
            DOM.menuBtn.setAttribute('aria-expanded', 'false');
            const focusTarget = lastDrawerFocus;
            if (focusTarget && typeof focusTarget.focus === 'function') {
                requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
            }
            lastDrawerFocus = null;
        }
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
        DOM.messageInput.style.height = Math.min(DOM.messageInput.scrollHeight, 200) + 'px';
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
            if (c) {
                const parsedConversations = JSON.parse(c);
                state.conversations = Array.isArray(parsedConversations)
                    ? parsedConversations
                        .filter(conv => conv && conv.id !== undefined && conv.id !== null)
                        .map(conv => ({
                            ...conv,
                            id: String(conv.id),
                            title: typeof conv.title === 'string' && conv.title.trim() ? conv.title : '新对话',
                            messages: Array.isArray(conv.messages) ? conv.messages : [],
                            pinned: conv.pinned === true
                        }))
                    : [];
            }
            state.activeConversationId = localStorage.getItem(STORAGE_KEYS.ACTIVE_CONV) || null;
            if (state.activeConversationId && !state.conversations.some(conv => conv.id === state.activeConversationId)) {
                state.activeConversationId = state.conversations[0]?.id || null;
            }
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
        const conv = { id: Date.now().toString(), title: '新对话', messages: [], pinned: false };
        state.conversations.unshift(conv);
        state.activeConversationId = conv.id;
        saveData();
        renderSidebar();
        renderActiveConversation();
        toggleDrawer(false);
    }

    function getOrderedConversations() {
        return state.conversations.slice().sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    }

    function renderSidebar() {
        const conversations = getOrderedConversations();
        DOM.conversationList.innerHTML = conversations.map(c => {
            const convId = escapeHtml(String(c.id));
            return `
            <div class="conv-item-wrapper">
                <div class="conv-item-delete" data-conv-id="${convId}" role="button" aria-label="删除对话">删除</div>
                <div class="conv-item ${c.id === state.activeConversationId ? 'active' : ''}" data-conv-id="${convId}">
                    <span class="conv-title-wrap">
                        <svg class="conv-pin-icon${c.pinned ? ' is-visible' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6l1 7 3 3v2H5v-2l3-3 1-7Z"/><path d="M12 15v6"/></svg>
                        <span class="conv-title">${escapeHtml(c.title || '新对话')}</span>
                    </span>
                    <div class="conv-actions">
                    <button type="button" class="btn-rename" data-conv-action="rename" data-conv-id="${convId}" aria-label="重命名对话">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                    <button type="button" class="btn-conv-more" data-conv-action="menu" data-conv-id="${convId}" aria-label="对话操作" aria-haspopup="dialog">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></svg>
                    </button>
                    </div>
                </div>
            </div>
        `;
        }).join('');

        DOM.conversationList.querySelectorAll('[data-conv-action]').forEach(button => {
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                const action = button.dataset.convAction;
                const convId = button.dataset.convId;
                if (action === 'rename') window.__renameConv(convId);
                if (action === 'menu') showConversationMenu(convId);
            });
        });
        
        // Bind click events for switching conversations
        DOM.conversationList.querySelectorAll('.conv-item').forEach(el => {
            el.addEventListener('click', () => {
                if (el.dataset.swiped === 'true') {
                    el.dataset.swiped = 'false';
                    return;
                }
                window.__switchConv(el.dataset.convId);
            });
        });
        
        // Bind swipe-to-delete
        bindSwipeDelete();
    }

    function deleteConversation(id, { confirmDelete = true } = {}) {
        const conversation = state.conversations.find(conv => conv.id === id);
        if (!conversation) return false;

        if (confirmDelete && !window.confirm(`确定删除“${conversation.title || '新对话'}”吗？`)) return false;

        const orderedBeforeDelete = getOrderedConversations();
        const removedIndex = orderedBeforeDelete.findIndex(conv => conv.id === id);
        const wasActive = state.activeConversationId === id;
        state.conversations = state.conversations.filter(conv => conv.id !== id);

        if (wasActive && state.conversations.length > 0) {
            const remaining = getOrderedConversations();
            const replacement = remaining[removedIndex] || remaining[removedIndex - 1] || remaining[0];
            state.activeConversationId = replacement?.id || null;
        } else if (state.conversations.length === 0) {
            state.activeConversationId = null;
        }

        saveData();
        renderSidebar();

        if (wasActive) {
            if (state.activeConversationId) {
                renderActiveConversation('switch');
            } else {
                createConversation();
            }
        }

        return true;
    }

    let activeConversationMenuId = null;

    function showConversationMenu(id) {
        const conversation = state.conversations.find(conv => conv.id === id);
        if (!conversation || !DOM.conversationMenuOverlay || !DOM.conversationMenu) return;

        activeConversationMenuId = id;
        if (DOM.conversationMenuPinLabel) {
            DOM.conversationMenuPinLabel.textContent = conversation.pinned ? '取消置顶' : '置顶对话';
        }
        DOM.conversationMenuOverlay.setAttribute('aria-hidden', 'false');
        DOM.conversationMenuOverlay.classList.add('active');
        if ('vibrate' in navigator) navigator.vibrate(15);
        requestAnimationFrame(() => DOM.conversationMenuPinLabel?.closest('button')?.focus({ preventScroll: true }));
    }

    function hideConversationMenu() {
        if (!DOM.conversationMenuOverlay) return;
        DOM.conversationMenuOverlay.classList.remove('active');
        DOM.conversationMenuOverlay.setAttribute('aria-hidden', 'true');
        activeConversationMenuId = null;
    }

    window.__openConversationMenu = showConversationMenu;

    function bindSwipeDelete() {
        DOM.conversationList.querySelectorAll('.conv-item-wrapper').forEach(wrapper => {
            const item = wrapper.querySelector('.conv-item');
            const deleteBtn = wrapper.querySelector('.conv-item-delete');
            let startX = 0, startY = 0, currentX = 0, swiping = false, horizontalGesture = false;
            
            item.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                currentX = startX;
                swiping = true;
                horizontalGesture = false;
                item.style.transition = 'none';
            }, {passive: true});
            
            item.addEventListener('touchmove', (e) => {
                if (!swiping) return;
                currentX = e.touches[0].clientX;
                const currentY = e.touches[0].clientY;
                const dxFromStart = currentX - startX;
                const dyFromStart = currentY - startY;
                if (!horizontalGesture && Math.abs(dyFromStart) > 8 && Math.abs(dyFromStart) > Math.abs(dxFromStart)) {
                    swiping = false;
                    item.style.transform = 'translateX(0)';
                    return;
                }
                if (Math.abs(dxFromStart) > 8 && Math.abs(dxFromStart) > Math.abs(dyFromStart)) horizontalGesture = true;
                if (!horizontalGesture) return;
                let dx = dxFromStart;
                if (dx > 0) dx = 0; // Only allow left swipe
                if (dx < -80) dx = -80;
                item.style.transform = `translateX(${dx}px)`;
            }, {passive: true});
            
            item.addEventListener('touchend', () => {
                swiping = false;
                item.style.transition = 'transform 0.2s ease';
                const dx = currentX - startX;
                if (horizontalGesture && dx < -40) {
                    item.style.transform = 'translateX(-80px)';
                    item.classList.add('swipe-open');
                    item.dataset.swiped = 'true';
                    window.setTimeout(() => { item.dataset.swiped = 'false'; }, 350);
                } else {
                    item.style.transform = 'translateX(0)';
                    item.classList.remove('swipe-open');
                }
                horizontalGesture = false;
            });
            
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const convId = deleteBtn.dataset.convId;
                deleteConversation(convId, { confirmDelete: false });
            });
        });
    }

    function selectConversation(id) {
        if (state.activeConversationId === id) { toggleDrawer(false); return; }
        if (!state.conversations.some(c => c.id === id)) return;
        state.activeConversationId = id;
        saveData();
        renderSidebar(); // Update active class
        renderActiveConversation('switch');
        toggleDrawer(false);
    }

    window.__switchConv = selectConversation;

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

    function updateStreamBubble(messageId, content) {
        const messageEl = Array.from(DOM.messagesList.querySelectorAll('.message.assistant'))
            .find(el => el.dataset.id === messageId) || DOM.messagesList.lastElementChild;
        if (!messageEl || !messageEl.classList.contains('assistant')) return;
        const bubble = messageEl.querySelector('.message-bubble');
        if (!bubble) return;

        bubble.innerHTML = renderMarkdown(content);
        if (typeof renderMathInElement !== 'undefined') {
            renderMathInElement(bubble, {
                delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                ],
                throwOnError: false
            });
        }
        if (!state.userScrolledUp) DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
    }

    function startStreamRenderer(messageId = state.streamMessageId) {
        if (state.streamRAFId) cancelAnimationFrame(state.streamRAFId);
        if (state.streamScrollCleanup) state.streamScrollCleanup();
        state.userScrolledUp = false;

        const onUserScroll = () => {
            const container = DOM.messagesContainer;
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
            state.userScrolledUp = !isNearBottom;
        };
        DOM.messagesContainer.addEventListener('scroll', onUserScroll, { passive: true });
        state.streamScrollCleanup = () => {
            DOM.messagesContainer.removeEventListener('scroll', onUserScroll);
            state.streamScrollCleanup = null;
        };

        const renderLoop = () => {
            const diff = state.streamBuffer.length - state.renderedContent.length;
            if (diff > 0) {
                const chunkSize = diff > 50 ? diff : Math.max(1, Math.ceil(diff / 3));
                state.renderedContent += state.streamBuffer.slice(state.renderedContent.length, state.renderedContent.length + chunkSize);
                updateStreamBubble(messageId, state.renderedContent);
            } else if (!state.isGenerating) {
                state.renderedContent = state.streamBuffer;
                updateStreamBubble(messageId, state.renderedContent);
                stopStreamRenderer();
                return;
            }
            state.streamRAFId = requestAnimationFrame(renderLoop);
        };
        state.streamRAFId = requestAnimationFrame(renderLoop);
    }

    function flushStreamRenderer(messageId = state.streamMessageId) {
        state.renderedContent = state.streamBuffer;
        updateStreamBubble(messageId, state.renderedContent);
        if (state.streamRAFId) cancelAnimationFrame(state.streamRAFId);
        state.streamRAFId = null;
    }

    function stopStreamRenderer() {
        if (state.streamRAFId) {
            cancelAnimationFrame(state.streamRAFId);
            state.streamRAFId = null;
        }
        if (state.streamScrollCleanup) state.streamScrollCleanup();
        state.userScrolledUp = false;
    }

    function renderActiveConversation(mode = 'switch') {
        const conv = state.conversations.find(c => c.id === state.activeConversationId);

        if (mode === 'append') {
            if (!conv || conv.messages.length === 0) return;
            DOM.welcomeScreen.classList.add('hidden');
            const now = new Date();
            const timeStr = `今天 ${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}`;
            const dateHTML = `<div class="message-date">${timeStr}</div>`;
            const oldScroll = DOM.messagesContainer.scrollTop;
            DOM.messagesList.innerHTML = dateHTML + conv.messages.map(m => createMessageHTML(m)).join('');
            if (state.editingMessageId) DOM.messagesContainer.scrollTop = oldScroll;
            else DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
            
            // Render LaTeX formulas
            if (typeof renderMathInElement !== 'undefined') {
                DOM.messagesList.querySelectorAll('.message.assistant .message-bubble').forEach(bubble => {
                    renderMathInElement(bubble, {
                        delimiters: [
                            {left: '$$', right: '$$', display: true},
                            {left: '$', right: '$', display: false},
                            {left: '\\(', right: '\\)', display: false},
                            {left: '\\[', right: '\\]', display: true}
                        ],
                        throwOnError: false
                    });
                });
            }
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
                const oldScroll = DOM.messagesContainer.scrollTop;
                DOM.messagesList.innerHTML = dateHTML + conv.messages.map(m => createMessageHTML(m)).join('');
                if (state.editingMessageId) {
                    const editEl = document.querySelector('.message.user .edit-mode-container');
                    if (editEl) editEl.scrollIntoView({ behavior: 'auto', block: 'center' });
                    else DOM.messagesContainer.scrollTop = oldScroll;
                } else {
                    DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
                }
            }
            
            // Force browser reflow to restart transition
            void DOM.messagesContainer.offsetWidth;
            DOM.messagesContainer.classList.remove('page-transition');
            
            // Render LaTeX formulas
            if (typeof renderMathInElement !== 'undefined') {
                DOM.messagesList.querySelectorAll('.message.assistant .message-bubble').forEach(bubble => {
                    renderMathInElement(bubble, {
                        delimiters: [
                            {left: '$$', right: '$$', display: true},
                            {left: '$', right: '$', display: false},
                            {left: '\\(', right: '\\)', display: false},
                            {left: '\\[', right: '\\]', display: true}
                        ],
                        throwOnError: false
                    });
                });
            }
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

    function buildMessagesPayload(conv) {
        const msgs = [];
        // Keep both the task-specific prompt and the user's persistent behavior rules in one
        // system message so the instruction survives every request and model switch.
        const basePrompt = String(state.settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt).trim();
        const longTermInstructions = String(state.settings.longTermInstructions || DEFAULT_LONG_TERM_INSTRUCTIONS).trim();
        const sysPrompt = [basePrompt, longTermInstructions ? `长期行为要求：\n${longTermInstructions}` : '']
            .filter(Boolean)
            .join('\n\n');
        if (sysPrompt) {
            msgs.push({ role: 'system', content: sysPrompt });
        }
        
        // Get conversation messages (exclude the placeholder assistant message)
        const history = conv.messages
            .filter(m => !m.isThinking)
            .map(m => ({ role: m.role, content: String(m.content ?? '') }));
        
        // Smart context window management:
        // DeepSeek models typically support 64k~128k context.
        // We estimate tokens roughly as chars/2 for Chinese, chars/4 for English.
        // Keep as many recent messages as possible within ~60k chars (~30k tokens).
        const MAX_CHARS = 60000;
        let totalChars = sysPrompt ? sysPrompt.length : 0;
        let startIndex = 0;
        
        // Calculate total
        let allChars = 0;
        for (const m of history) allChars += m.content.length;
        
        if (allChars + totalChars > MAX_CHARS) {
            // Need to trim — always keep the most recent messages
            let kept = 0;
            for (let i = history.length - 1; i >= 0; i--) {
                kept += history[i].content.length;
                if (kept + totalChars > MAX_CHARS) {
                    startIndex = i + 1;
                    break;
                }
            }
        }
        
        msgs.push(...history.slice(startIndex));
        return msgs;
    }

    function processSSEEvent(eventText, onData) {
        const dataLines = eventText.split(/\r?\n/)
            .filter(line => /^data\s*:/.test(line))
            .map(line => line.replace(/^data\s*:\s?/, ''));
        if (dataLines.length === 0) return false;

        const rawData = dataLines.join('\n').trim();
        if (!rawData || rawData === '[DONE]') return rawData === '[DONE]';
        try {
            onData(JSON.parse(rawData));
        } catch (error) {
            // A complete SSE event should be valid JSON. Keep the failure visible for
            // diagnostics, but never discard a later event or abort the stream.
            console.warn('忽略无法解析的流式事件', error);
        }
        return false;
    }

    async function callAPI(conv) {
        setGeneratingState(true);
        state.abortController = new AbortController();
        state.isThinking = true;
        state.streamBuffer = '';
        state.renderedContent = '';

        const streamMessage = { id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, role: 'assistant', content: '', isThinking: true };
        state.streamMessageId = streamMessage.id;
        conv.messages.push(streamMessage);
        renderActiveConversation('append');

        const appendDelta = (data) => {
            const delta = data?.choices?.[0]?.delta;
            if (!delta) return;
            const rawContent = delta.content;
            const content = typeof rawContent === 'string'
                ? rawContent
                : Array.isArray(rawContent)
                    ? rawContent.map(part => typeof part === 'string' ? part : String(part?.text || '')).join('')
                    : '';
            if (content === '') return;

            if (state.isThinking) {
                state.isThinking = false;
                streamMessage.isThinking = false;
                renderActiveConversation('append');
                startStreamRenderer(streamMessage.id);
            }
            state.streamBuffer += content;
            streamMessage.content = state.streamBuffer;
        };

        try {
            const messagesPayload = buildMessagesPayload(conv);
            const payload = {
                model: state.settings.model,
                messages: messagesPayload,
                stream: true,
                max_tokens: state.settings.maxTokens
            };
            if (state.settings.model === 'deepseek-v4-pro') {
                payload.thinking = { type: 'enabled' };
                payload.reasoning_effort = 'high';
            }

            const response = await fetch('https://api.deepseek.com/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.settings.apiKey}` },
                body: JSON.stringify(payload),
                signal: state.abortController.signal
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                throw new Error(errData?.error?.message || `API 错误 (${response.status})`);
            }
            if (!response.body || typeof response.body.getReader !== 'function') throw new Error('API 未返回可读取的流。');

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let sseBuffer = '';
            let doneReceived = false;

            const consumeBuffer = (flush = false) => {
                let separator;
                while (!doneReceived && (separator = sseBuffer.match(/\r?\n\r?\n/))) {
                    const eventText = sseBuffer.slice(0, separator.index);
                    sseBuffer = sseBuffer.slice(separator.index + separator[0].length);
                    doneReceived = processSSEEvent(eventText, appendDelta);
                }
                if (flush && !doneReceived && sseBuffer.trim()) {
                    doneReceived = processSSEEvent(sseBuffer, appendDelta);
                    sseBuffer = '';
                }
            };

            while (!doneReceived) {
                const { done, value } = await reader.read();
                if (done) break;
                sseBuffer += decoder.decode(value, { stream: true });
                consumeBuffer();
            }
            // Flush TextDecoder's pending UTF-8 bytes and process an event without
            // a trailing blank line. Both cases are common with mobile proxies.
            sseBuffer += decoder.decode();
            consumeBuffer(true);
        } catch (error) {
            if (error.name !== 'AbortError') {
                state.isThinking = false;
                streamMessage.isThinking = false;
                const errorMessage = error.message || '发送失败，请检查网络或 API Key。';
                streamMessage.content = state.streamBuffer
                    ? `${state.streamBuffer}\n\n${errorMessage}`
                    : errorMessage;
                state.streamBuffer = streamMessage.content;
                renderActiveConversation('append');
            }
        } finally {
            if (!state.isThinking) flushStreamRenderer(streamMessage.id);
            if (state.isThinking) {
                state.isThinking = false;
                streamMessage.isThinking = false;
                if (!streamMessage.content) streamMessage.content = '模型没有返回内容，请重试。';
                renderActiveConversation('append');
            }
            stopStreamRenderer();
            setGeneratingState(false);
            state.abortController = null;
            state.streamMessageId = null;
            saveData();
        }
    }

    function renderMarkdown(text) {
        text = String(text ?? '');
        // Protect LaTeX blocks from marked.js parsing
        const mathBlocks = [];
        text = text.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g, (match) => {
            mathBlocks.push(match);
            return `%%%MATH_BLOCK_${mathBlocks.length - 1}%%%`;
        });

        let html = text;
        if (typeof marked !== 'undefined') {
            marked.setOptions({
                breaks: true,
                gfm: true,
                headerIds: false,
                mangle: false
            });
            html = marked.parse(text);
        } else {
            html = escapeHtml(text).replace(/\n/g, '<br>');
        }

        // Restore LaTeX blocks
        html = html.replace(/%%%MATH_BLOCK_(\d+)%%%/g, (match, i) => mathBlocks[i]);

        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, {
                ADD_TAGS: ['math', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'span'],
                ADD_ATTR: ['class', 'style', 'aria-hidden', 'xmlns']
            });
        }
        return html;
    }
    function escapeHtml(str) { const div = document.createElement('div'); div.textContent = String(str ?? ''); return div.innerHTML; }

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

        // ========== Long Press & Context Menu ==========
        let activeMessageId = null;

        let pressTimer = null;
        let isLongPress = false;
        let startX = 0;
        let startY = 0;

        function handlePressStart(e) {
            if (e.button === 2) return; // ignore right click
            const bubble = e.target.closest('.message-bubble');
            if (!bubble) return;
            const msgEl = bubble.closest('.message');
            if (!msgEl) return;
            // only allow user messages to be edited for now
            if (msgEl.classList.contains('assistant')) return;
            
            if (e.touches && e.touches.length > 0) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
            } else {
                startX = e.clientX;
                startY = e.clientY;
            }
            
            isLongPress = false;
            pressTimer = setTimeout(() => {
                isLongPress = true;
                activeMessageId = msgEl.getAttribute('data-id');
                showContextMenu(e, msgEl);
            }, 500);
        }
        function handlePressEnd() { if (pressTimer) clearTimeout(pressTimer); }
        function handlePressMove(e) { 
            if (!pressTimer) return;
            let currentX, currentY;
            if (e.touches && e.touches.length > 0) {
                currentX = e.touches[0].clientX;
                currentY = e.touches[0].clientY;
            } else {
                currentX = e.clientX;
                currentY = e.clientY;
            }
            // Cancel long press only if finger moves more than 10 pixels
            if (Math.abs(currentX - startX) > 10 || Math.abs(currentY - startY) > 10) {
                clearTimeout(pressTimer);
            }
        }

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

        function hideContextMenu(restoreUserSelect = true) {
            ctxMenu.classList.remove('active');
            setTimeout(() => ctxOverlay.classList.remove('active'), 200);
            
            if (restoreUserSelect && activeMessageId) {
                const conv = state.conversations.find(c => c.id === state.activeConversationId);
                const msg = conv?.messages.find(m => m.id === activeMessageId);
                if (msg) {
                    const el = document.querySelector(`.message[data-id="${activeMessageId}"]`);
                    if (el) {
                        el.style.userSelect = '';
                        el.style.webkitUserSelect = '';
                    }
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

        if (DOM.conversationMenuOverlay && DOM.conversationMenu) {
            DOM.conversationMenuOverlay.addEventListener('click', (e) => {
                if (e.target === DOM.conversationMenuOverlay) hideConversationMenu();
            });

            DOM.conversationMenu.addEventListener('click', (e) => {
                const item = e.target.closest('.conversation-menu-item');
                if (!item) return;

                const action = item.dataset.action;
                const conversationId = activeConversationMenuId;
                const conversation = state.conversations.find(conv => conv.id === conversationId);

                if (action === 'pin' && conversation) {
                    conversation.pinned = !conversation.pinned;
                    hideConversationMenu();
                    saveData();
                    renderSidebar();
                    showToast(conversation.pinned ? '已置顶对话' : '已取消置顶');
                } else if (action === 'delete' && conversationId) {
                    hideConversationMenu();
                    if (deleteConversation(conversationId)) showToast('已删除对话');
                } else {
                    hideConversationMenu();
                }
            });
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
                el.style.userSelect = 'text';
                el.style.webkitUserSelect = 'text';
                hideContextMenu(false);
                
                // Programmatically select text
                setTimeout(() => {
                    const bubble = el.querySelector('.message-bubble');
                    if (bubble) {
                        const range = document.createRange();
                        range.selectNodeContents(bubble);
                        const sel = window.getSelection();
                        sel.removeAllRanges();
                        sel.addRange(range);
                    }
                }, 50);
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
        document.addEventListener('click', (e) => {
            if (DOM.mainView.classList.contains('drawer-open') && !e.target.closest('.sidebar, #menuBtn')) {
                toggleDrawer(false);
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (DOM.conversationMenuOverlay?.classList.contains('active')) {
                hideConversationMenu();
            } else if (DOM.searchOverlay.classList.contains('active')) {
                DOM.closeSearchBtn.click();
            } else if (DOM.settingsPanel.classList.contains('active')) {
                DOM.closeSettingsBtn.click();
            } else if (DOM.mainView.classList.contains('drawer-open')) {
                toggleDrawer(false);
            }
        });
        
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
            if (DOM.systemPromptInput) DOM.systemPromptInput.value = state.settings.systemPrompt || '';
            if (DOM.longTermInstructionsInput) DOM.longTermInstructionsInput.value = state.settings.longTermInstructions || DEFAULT_LONG_TERM_INSTRUCTIONS;
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
            if (DOM.systemPromptInput) state.settings.systemPrompt = DOM.systemPromptInput.value;
            if (DOM.longTermInstructionsInput) state.settings.longTermInstructions = DOM.longTermInstructionsInput.value.trim() || DEFAULT_LONG_TERM_INSTRUCTIONS;
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
        if (DOM.longTermInstructionsInput) {
            DOM.longTermInstructionsInput.addEventListener('change', () => {
                state.settings.longTermInstructions = DOM.longTermInstructionsInput.value.trim() || DEFAULT_LONG_TERM_INSTRUCTIONS;
                saveData();
            });
        }

        // ========== Left Edge Swipe to Open Sidebar ==========
        let edgeStartX = 0, edgeStartY = 0, edgeSwiping = false;
        document.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            if (touch.clientX < 25) { // Only trigger from left edge (25px)
                edgeStartX = touch.clientX;
                edgeStartY = touch.clientY;
                edgeSwiping = true;
            }
        }, {passive: true});

        document.addEventListener('touchmove', (e) => {
            if (!edgeSwiping) return;
            const touch = e.touches[0];
            const dx = touch.clientX - edgeStartX;
            const dy = Math.abs(touch.clientY - edgeStartY);
            // Must be more horizontal than vertical
            if (dx > 50 && dy < 80) {
                toggleDrawer(true);
                edgeSwiping = false;
            }
        }, {passive: true});

        document.addEventListener('touchend', () => {
            edgeSwiping = false;
        }, {passive: true});

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
                    const titleMatch = String(c.title || '').toLowerCase().includes(query);
                    const msgMatch = (c.messages || []).some(m => String(m.content || '').toLowerCase().includes(query));
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
                if ((conv.messages || []).length > 0) {
                    const matchMsg = conv.messages.find(m => String(m.content || '').toLowerCase().includes(query));
                    snippet = String(matchMsg ? matchMsg.content : conv.messages[conv.messages.length - 1].content || '');
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
                    selectConversation(conv.id);
                    DOM.searchOverlay.classList.remove('active');
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
