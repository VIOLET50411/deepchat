(function () {
    'use strict';

    const STORAGE_KEYS = { CONVERSATIONS: 'dsc_convs', ACTIVE_CONV: 'dsc_active', SETTINGS: 'dsc_settings', THEME: 'dsc_theme' };
    const DEFAULT_SETTINGS = { apiKey: '', model: 'deepseek-v4-pro', temperature: 1.0, maxTokens: 8192, systemPrompt: '你是一个有帮助的AI助手。请记住整个对话的上下文，包括用户之前提出的问题、给出的选项和做出的选择。在回答时始终参考之前的对话内容。', userName: 'Locin', userAvatar: null, currentBalance: null, baseBalance: null };

    let state = { conversations: [], activeConversationId: null, settings: { ...DEFAULT_SETTINGS }, isGenerating: false, abortController: null, streamBuffer: '', renderedContent: '', streamRAFId: null, isThinking: false, editingMessageId: null, userScrolledUp: false };

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
        profileName: $('#profileName'),
        systemPromptInput: $('#systemPromptInput')
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
            <div class="conv-item-wrapper">
                <div class="conv-item-delete" data-conv-id="${c.id}">删除</div>
                <div class="conv-item ${c.id === state.activeConversationId ? 'active' : ''}" data-conv-id="${c.id}">
                    <span class="conv-title">${escapeHtml(c.title)}</span>
                    <button class="btn-rename" onclick="event.stopPropagation(); window.__renameConv('${c.id}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Bind click events for switching conversations
        DOM.conversationList.querySelectorAll('.conv-item').forEach(el => {
            el.addEventListener('click', () => window.__switchConv(el.dataset.convId));
        });
        
        // Bind swipe-to-delete
        bindSwipeDelete();
    }

    function bindSwipeDelete() {
        DOM.conversationList.querySelectorAll('.conv-item-wrapper').forEach(wrapper => {
            const item = wrapper.querySelector('.conv-item');
            const deleteBtn = wrapper.querySelector('.conv-item-delete');
            let startX = 0, currentX = 0, swiping = false;
            
            item.addEventListener('touchstart', (e) => {
                startX = e.touches[0].clientX;
                currentX = startX;
                swiping = true;
                item.style.transition = 'none';
            }, {passive: true});
            
            item.addEventListener('touchmove', (e) => {
                if (!swiping) return;
                currentX = e.touches[0].clientX;
                let dx = currentX - startX;
                if (dx > 0) dx = 0; // Only allow left swipe
                if (dx < -80) dx = -80;
                item.style.transform = `translateX(${dx}px)`;
            }, {passive: true});
            
            item.addEventListener('touchend', () => {
                swiping = false;
                item.style.transition = 'transform 0.2s ease';
                const dx = currentX - startX;
                if (dx < -40) {
                    item.style.transform = 'translateX(-80px)';
                } else {
                    item.style.transform = 'translateX(0)';
                }
            });
            
            deleteBtn.addEventListener('click', () => {
                const convId = deleteBtn.dataset.convId;
                state.conversations = state.conversations.filter(c => c.id !== convId);
                if (state.activeConversationId === convId) {
                    state.activeConversationId = state.conversations.length > 0 ? state.conversations[0].id : null;
                    if (!state.activeConversationId) createConversation();
                    else renderActiveConversation('switch');
                }
                saveData();
                renderSidebar();
            });
        });
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
        state.userScrolledUp = false;
        
        // Listen for user scroll to detect manual scroll-up
        const onUserScroll = () => {
            const container = DOM.messagesContainer;
            const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
            state.userScrolledUp = !isNearBottom;
        };
        DOM.messagesContainer.addEventListener('scroll', onUserScroll, { passive: true });
        // Also detect touch-initiated scrolls
        DOM.messagesContainer.addEventListener('touchmove', () => { state.userScrolledUp = true; }, { passive: true, once: false });
        
        let lastRenderTime = 0;
        const renderLoop = (timestamp) => {
            const diff = state.streamBuffer.length - state.renderedContent.length;
            
            if (diff > 0) {
                // Throttle heavy markdown/KaTeX rendering to ~30fps to prevent CPU jank on long messages
                if (!lastRenderTime || timestamp - lastRenderTime > 30) {
                    // Calculate dynamic chunk size to ensure smooth typing feel without falling behind
                    let chunkSize = diff > 50 ? diff : Math.ceil(diff / 3);
                    
                    state.renderedContent += state.streamBuffer.substring(state.renderedContent.length, state.renderedContent.length + chunkSize);
                    
                    const lastEl = DOM.messagesList.lastElementChild;
                    if (lastEl && lastEl.classList.contains('assistant')) {
                        const bubble = lastEl.querySelector('.message-bubble');
                        if (bubble) {
                            bubble.innerHTML = renderMarkdown(state.renderedContent);
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
                            if (!state.userScrolledUp) {
                                DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
                            }
                        }
                    }
                    lastRenderTime = timestamp;
                }
            } else if (!state.isGenerating && diff === 0) {
                DOM.messagesContainer.removeEventListener('scroll', onUserScroll);
                stopStreamRenderer();
                return;
            }
            
            state.streamRAFId = requestAnimationFrame(renderLoop);
        };
        state.streamRAFId = requestAnimationFrame(renderLoop);
    }

    function stopStreamRenderer() {
        if (state.streamRAFId) {
            cancelAnimationFrame(state.streamRAFId);
            state.streamRAFId = null;
        }
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
        // Always include system prompt for better memory
        const sysPrompt = state.settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt;
        if (sysPrompt) {
            msgs.push({ role: 'system', content: sysPrompt });
        }
        
        // Get conversation messages (exclude the placeholder assistant message)
        const history = conv.messages.filter(m => !m.isThinking).map(m => ({ role: m.role, content: m.content }));
        
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
            const messagesPayload = buildMessagesPayload(conv);
            
            const payload = {
                model: state.settings.model,
                messages: messagesPayload,
                stream: true,
                max_tokens: state.settings.maxTokens
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

            if (!response.ok) {
                const errData = await response.json().catch(() => null);
                const errMsg = errData?.error?.message || `API 错误 (${response.status})`;
                throw new Error(errMsg);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let sseBuffer = ''; // Buffer for incomplete SSE lines

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                sseBuffer += decoder.decode(value, { stream: true });
                const lines = sseBuffer.split('\n');
                
                // Keep the last element (may be incomplete)
                sseBuffer = lines.pop() || '';
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (trimmed === '' || trimmed === 'data: [DONE]') continue;
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(trimmed.slice(6));
                            const delta = data.choices && data.choices[0] && data.choices[0].delta;
                            if (delta && delta.content) {
                                if (state.isThinking) {
                                    state.isThinking = false;
                                    conv.messages[conv.messages.length - 1].isThinking = false;
                                    
                                    const lastEl = DOM.messagesList.lastElementChild;
                                    if (lastEl) lastEl.outerHTML = createMessageHTML(conv.messages[conv.messages.length - 1]);
                                    
                                    startStreamRenderer();
                                }
                                state.streamBuffer += delta.content;
                                conv.messages[conv.messages.length - 1].content = state.streamBuffer;
                            }
                        } catch (e) {
                            // JSON parse error — likely an incomplete chunk, skip
                        }
                    }
                }
            }
            
            // Process any remaining buffer
            if (sseBuffer.trim() && sseBuffer.trim() !== 'data: [DONE]' && sseBuffer.trim().startsWith('data: ')) {
                try {
                    const data = JSON.parse(sseBuffer.trim().slice(6));
                    const delta = data.choices && data.choices[0] && data.choices[0].delta;
                    if (delta && delta.content) {
                        state.streamBuffer += delta.content;
                        conv.messages[conv.messages.length - 1].content = state.streamBuffer;
                    }
                } catch(e) {}
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                conv.messages[conv.messages.length - 1].isThinking = false;
                conv.messages[conv.messages.length - 1].content = e.message || '发送失败，请检查网络或 API Key。';
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
            // Configure marked for better rendering
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
        if (typeof DOMPurify !== 'undefined') {
            html = DOMPurify.sanitize(html, {
                ADD_TAGS: ['math', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub', 'mfrac', 'mover', 'munder', 'munderover', 'msqrt', 'mtable', 'mtr', 'mtd', 'mtext', 'mspace', 'span'],
                ADD_ATTR: ['class', 'style', 'aria-hidden', 'xmlns']
            });
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
