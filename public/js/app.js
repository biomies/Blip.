        // State
        let currentUser = null;
        let currentTab = 'friends'; // 'friends' (Chat) | 'contacts' (Teman) | 'nearby' (Sekitar) | 'profile'
        let previousTab = 'friends';
        let nearbyGenderFilter = 'all'; // 'all' | 'female' | 'male'
        let activeChatFriendId = null;
        let chatPollInterval = null;
        let radarPollInterval = null;
        let unreadAcceptedFriendsCount = 0;
        let lastKnownFriendsCount = null;
        const colors = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];
        let selectedColor = '#4f46e5';
        let selectedGender = null; // 'male' | 'female' | null

        // Pagination State (Lazy Load)
        let nearbyPage = 1;
        let nearbyHasMore = true;
        let nearbyLoading = false;
        let nearbyUsersList = [];

        // P2P Image Transfer State (0 Byte Server Storage via WebRTC DataChannel + Local IndexedDB)
        window.localP2PFiles = {};      // { [fileId]: { blob, dataUrl, name, size, mimeType } }
        window.receivedP2PFiles = {};   // { [fileId]: { objectUrl, blob, name, size } }
        window.activePeerConnections = {}; // { [peerUserId]: RTCPeerConnection }
        window.activeDataChannels = {};    // { [peerUserId]: RTCDataChannel }
        window.pendingIncomingTransfers = {}; // { [fileId]: { chunks: [], totalChunks, receivedChunks, name, size, mimeType } }

        // Local IndexedDB Helper (Menyimpan file di HP/Browser user secara offline, 0 Byte di Server!)
        const P2P_DB_NAME = 'blip_p2p_storage';
        const P2P_STORE_NAME = 'photos';

        function openP2PDatabase() {
            return new Promise((resolve, reject) => {
                if (!window.indexedDB) {
                    resolve(null);
                    return;
                }
                const req = window.indexedDB.open(P2P_DB_NAME, 1);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(P2P_STORE_NAME)) {
                        db.createObjectStore(P2P_STORE_NAME, { keyPath: 'fileId' });
                    }
                };
                req.onsuccess = (e) => resolve(e.target.result);
                req.onerror = () => resolve(null);
            });
        }

        async function saveP2PFileToLocalDB(fileId, dataObj) {
            try {
                const db = await openP2PDatabase();
                if (!db) return;
                const tx = db.transaction(P2P_STORE_NAME, 'readwrite');
                const store = tx.objectStore(P2P_STORE_NAME);
                store.put({
                    fileId: fileId,
                    name: dataObj.name,
                    size: dataObj.size,
                    mimeType: dataObj.mimeType,
                    dataUrl: dataObj.dataUrl || null,
                    blob: dataObj.blob || null,
                    timestamp: Date.now()
                });
            } catch (err) {
                console.warn('[P2P DB] Gagal simpan ke IndexedDB:', err);
            }
        }

        async function getP2PFileFromLocalDB(fileId) {
            try {
                const db = await openP2PDatabase();
                if (!db) return null;
                return new Promise((resolve) => {
                    const tx = db.transaction(P2P_STORE_NAME, 'readonly');
                    const store = tx.objectStore(P2P_STORE_NAME);
                    const req = store.get(fileId);
                    req.onsuccess = (e) => resolve(e.target.result || null);
                    req.onerror = () => resolve(null);
                });
            } catch (err) {
                return null;
            }
        }

        const RTC_CONFIG = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        // Filter Gender Tab Di Sekitar
        function setNearbyGenderFilter(filter) {
            nearbyGenderFilter = filter;
            document.getElementById('filterAll').classList.toggle('active', filter === 'all');
            document.getElementById('filterFemale').classList.toggle('active', filter === 'female');
            document.getElementById('filterMale').classList.toggle('active', filter === 'male');
            nearbyPage = 1;
            nearbyHasMore = true;
            nearbyUsersList = [];
            loadNearbyUsers(false);
        }

        // Render Ikon Gender saja di samping nama
        function renderGenderIcon(gender) {
            if (gender === 'male') {
                return `<span class="user-tag gender-male" title="Pria" style="font-size: 0.82rem; margin-left: 0.35rem;"><i class="fa-solid fa-mars"></i></span>`;
            } else if (gender === 'female') {
                return `<span class="user-tag gender-female" title="Wanita" style="font-size: 0.82rem; margin-left: 0.35rem;"><i class="fa-solid fa-venus"></i></span>`;
            }
            return '';
        }

        // Helper terpadu untuk render kartu postingan Knot (dipakai di Feed Utama, Profil Saya, dan Profil Pengguna Lain)
        function renderKnotCardHtml(t, options = {}) {
            const u = t.user || {};
            const isMy = t.is_mine;
            const isLiked = t.is_liked;
            const genderIcon = renderGenderIcon(u.gender);
            const ageBadge = (u.age && !isNaN(u.age)) ? `<span class="user-tag age-badge">${u.age} th</span>` : '';
            const usernameHandle = u.username ? `@${escapeHtml(u.username)}` : '';
            const activeClass = (typeof activeThreadId !== 'undefined' && activeThreadId === t.id) ? 'active-thread' : '';
            const isContactProfile = options.isContactProfile || false;
            const avatarClickAction = isContactProfile ? '' : `event.stopPropagation(); openNearbyUserInfo(${u.id || t.user_id})`;
            const avatarCursor = isContactProfile ? 'cursor: default;' : 'cursor: pointer;';

            return `
                <div class="thread-card ${activeClass}" id="threadCard_${t.id}" onclick="openThreadView(${t.id})">
                    <div class="thread-card-header">
                        <div class="thread-card-avatar" ${avatarClickAction ? `onclick="${avatarClickAction}"` : ''} style="${avatarCursor}" title="Lihat profil ${escapeHtml(u.name || 'User')}">
                            ${renderAvatarHtml(u.name || 'User', u.avatar_color, u.avatar_url, '', 'width: 44px; height: 44px; font-size: 1.05rem; flex-shrink: 0;')}
                        </div>
                        <div class="thread-card-meta">
                            <div class="thread-card-top-row">
                                <div class="thread-card-author-name" ${avatarClickAction ? `onclick="${avatarClickAction}"` : ''} style="${avatarCursor}" title="Lihat profil ${escapeHtml(u.name || 'User')}">
                                    <span>${escapeHtml(u.name || 'User')}</span>
                                    ${usernameHandle ? `<span class="thread-author-handle">${usernameHandle}</span>` : ''}
                                    ${genderIcon}
                                    ${ageBadge}
                                </div>
                                <span class="thread-distance-badge" title="Jarak saat memposting">
                                    <i class="fa-solid fa-location-arrow"></i> ${escapeHtml(t.distance_formatted || '0 m')}
                                </span>
                            </div>
                            <div class="thread-card-sub-row">
                                <span class="thread-time-text">${t.created_at_human}</span>
                            </div>
                        </div>
                    </div>

                    <div class="thread-content-text">${renderThreadContentWithMentions(t.content)}</div>

                    <div class="thread-footer">
                        <div class="thread-actions-group">
                            <button type="button" class="thread-action-pill ${isLiked ? 'liked' : ''}" id="threadCardLikeBtn_${t.id}" data-thread-like-btn="${t.id}" onclick="event.stopPropagation(); toggleLikeThread(${t.id})" title="${isLiked ? 'Batal Suka' : 'Suka'}">
                                <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
                                <span id="threadCardLikeCount_${t.id}" data-thread-like-count="${t.id}" class="thread-like-count-click" onclick="${t.likes_count > 0 ? `event.stopPropagation(); openThreadLikesModal(${t.id})` : ''}" title="${t.likes_count > 0 ? 'Lihat siapa yang menyukai' : 'Suka'}">${t.likes_count}</span>
                            </button>
                            <button type="button" class="thread-action-pill" onclick="event.stopPropagation(); openThreadView(${t.id})" title="Lihat dan Balas">
                                <i class="fa-regular fa-comment"></i>
                                <span id="threadCardReplyCount_${t.id}" data-thread-reply-count="${t.id}">${t.replies_count}</span>
                            </button>
                        </div>
                        ${isMy ? `
                            <button type="button" class="thread-action-pill danger" onclick="event.stopPropagation(); confirmDeleteThread(${t.id})" title="Hapus Postingan">
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }
        function renderAvatarHtml(name, color, avatarUrl = null, extraClass = '', extraStyle = '', badgeHtml = '') {
            const initial = (name || 'U').charAt(0).toUpperCase();
            const safeColor = color || '#2b77f8';
            if (avatarUrl) {
                return `
                    <div class="avatar-circle ${extraClass}" style="background-image: url('${escapeHtml(avatarUrl)}'); background-size: cover; background-position: center; ${extraStyle}">
                        ${badgeHtml}
                    </div>
                `;
            }
            return `
                <div class="avatar-circle ${extraClass}" style="background-color: ${safeColor}; ${extraStyle}">
                    ${initial}
                    ${badgeHtml}
                </div>
            `;
        }

        // Render Baris Info (Jarak • Umur)
        function renderUserSubline(distanceFormatted, gender, age) {
            let parts = [];
            
            // Jarak
            if (distanceFormatted) {
                parts.push(`<span class="dist-badge"><i class="fa-solid fa-location-arrow"></i> ${distanceFormatted}</span>`);
            }

            // Umur (hanya jika diisi dan valid angka)
            if (age !== null && age !== undefined && age !== '' && !isNaN(age)) {
                parts.push(`<span class="user-tag age-badge">${age} th</span>`);
            }

            return `<div class="user-subline">${parts.join('<span class="subline-dot">•</span>')}</div>`;
        }

        // Render Tag khusus untuk Chat Header
        function renderHeaderTags(gender, age) {
            let tags = [];
            if (gender === 'male') {
                tags.push(`<span class="user-tag gender-male" title="Pria"><i class="fa-solid fa-mars"></i></span>`);
            } else if (gender === 'female') {
                tags.push(`<span class="user-tag gender-female" title="Wanita"><i class="fa-solid fa-venus"></i></span>`);
            }
            if (age !== null && age !== undefined && age !== '' && !isNaN(age)) {
                tags.push(`<span class="user-tag age-badge">${age} th</span>`);
            }
            return tags.join('<span class="subline-dot" style="margin: 0 0.2rem;">•</span>');
        }

        // ==========================================
        // UI COMPONENT BUILDERS (Untuk Standarisasi Desain)
        // ==========================================
        function uiButton({ text = '', icon = '', variant = 'primary', size = 'sm', onclick = '', extraClass = '', title = '', type = 'button' }) {
            const iconHtml = icon ? `<i class="${icon}"></i>` : '';
            return `<button type="${type}" class="btn btn-${variant} btn-${size} ${extraClass}" onclick="${onclick}" title="${title}">${iconHtml} ${text ? `<span>${text}</span>` : ''}</button>`;
        }

        function uiIconButton({ icon = '', variant = 'ghost', size = 'md', onclick = '', extraClass = '', title = '', type = 'button' }) {
            return `<button type="${type}" class="btn-icon ${variant !== 'ghost' ? `btn-icon-${variant}` : ''} ${extraClass}" onclick="${onclick}" title="${title}"><i class="${icon}"></i></button>`;
        }

        function selectGender(val) {
            selectedGender = (selectedGender === val) ? null : val; // toggle jika klik yang sama
            updateGenderUI();
        }

        // ==========================================
        // Onboarding: Setup Akun Awal (Nama, Username Unik, Jenis Kelamin)
        // ==========================================
        let onboardingSelectedGender = null;
        let onboardingUsernameAvailable = true;
        let onboardingUsernameDebounce = null;

        function checkOnboarding() {
            const modal = document.getElementById('onboardingModal');
            if (!modal) return;
            // Jika user belum selesai onboarding (belum set gender/nama/username), wajibkan onboarding
            if (currentUser && (!currentUser.is_onboarded || !currentUser.gender)) {
                modal.style.display = 'flex';
                onboardingSelectedGender = currentUser.gender || null;

                const nameInput = document.getElementById('onboardInputName');
                if (nameInput) {
                    nameInput.value = (currentUser.name && !currentUser.name.includes('#')) ? currentUser.name : '';
                }

                const usernameInput = document.getElementById('onboardInputUsername');
                if (usernameInput) {
                    usernameInput.value = currentUser.username || '';
                }

                onboardingUsernameAvailable = true;
                const statusEl = document.getElementById('onboardUsernameStatus');
                if (statusEl) {
                    statusEl.innerHTML = '';
                }

                updateOnboardingUI();
            } else {
                modal.style.display = 'none';
            }
        }

        function selectOnboardingGender(val) {
            onboardingSelectedGender = val;
            updateOnboardingUI();
        }

        function onOnboardingInputChange() {
            updateOnboardingUI();
        }

        function onOnboardingUsernameChange(val) {
            clearTimeout(onboardingUsernameDebounce);
            const statusEl = document.getElementById('onboardUsernameStatus');
            const spinnerEl = document.getElementById('onboardUsernameSpinner');
            const clean = (val || '').trim().replace(/^@/, '').toLowerCase();

            if (!clean) {
                onboardingUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Username tidak boleh kosong.</span>';
                }
                updateOnboardingUI();
                return;
            }

            if (clean.length < 3) {
                onboardingUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Minimal 3 karakter.</span>';
                }
                updateOnboardingUI();
                return;
            }

            if (!/^[a-zA-Z0-9_]+$/.test(clean)) {
                onboardingUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Hanya huruf, angka, dan underscore (_).</span>';
                }
                updateOnboardingUI();
                return;
            }

            if (spinnerEl) spinnerEl.style.display = 'inline-block';
            if (statusEl) statusEl.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memeriksa ketersediaan...</span>';

            onboardingUsernameDebounce = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/blip/check-username?username=${encodeURIComponent(clean)}`, {
                        headers: getHeaders()
                    });
                    const data = await res.json();
                    if (spinnerEl) spinnerEl.style.display = 'none';
                    if (data.available) {
                        onboardingUsernameAvailable = true;
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: #10b981; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> @${clean} tersedia!</span>`;
                        }
                    } else {
                        onboardingUsernameAvailable = false;
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(data.message || 'Username sudah dipakai.')}</span>`;
                        }
                    }
                } catch (e) {
                    if (spinnerEl) spinnerEl.style.display = 'none';
                }
                updateOnboardingUI();
            }, 300);
        }

        function updateOnboardingUI() {
            const maleCard = document.getElementById('onboardGenderMale');
            const femaleCard = document.getElementById('onboardGenderFemale');
            const submitBtn = document.getElementById('btnSubmitOnboarding');
            const nameVal = (document.getElementById('onboardInputName')?.value || '').trim();
            const usernameVal = (document.getElementById('onboardInputUsername')?.value || '').trim();

            if (maleCard) maleCard.classList.toggle('active', onboardingSelectedGender === 'male');
            if (femaleCard) femaleCard.classList.toggle('active', onboardingSelectedGender === 'female');

            const isValid = nameVal.length > 0 && usernameVal.length >= 3 && onboardingUsernameAvailable && !!onboardingSelectedGender;

            if (submitBtn) {
                submitBtn.disabled = !isValid;
            }
        }

        async function submitOnboardingData() {
            const nameInput = document.getElementById('onboardInputName');
            const usernameInput = document.getElementById('onboardInputUsername');
            const submitBtn = document.getElementById('btnSubmitOnboarding');

            const name = (nameInput?.value || '').trim();
            const username = (usernameInput?.value || '').trim().replace(/^@/, '').toLowerCase();

            if (!name) {
                showToast('Silakan isi nama pengguna terlebih dahulu.', 'error');
                return;
            }
            if (!username || username.length < 3) {
                showToast('Silakan isi username minimal 3 karakter.', 'error');
                return;
            }
            if (!onboardingSelectedGender) {
                showToast('Silakan pilih jenis kelamin Anda.', 'error');
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan profil...';
            }

            try {
                const res = await fetch('/api/blip/profile', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({
                        name: name,
                        username: username,
                        gender: onboardingSelectedGender
                    })
                });

                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data.user;
                    updateUserUI();
                    const modal = document.getElementById('onboardingModal');
                    if (modal) modal.style.display = 'none';

                    showToast('Selamat datang di Blip! Profil Anda berhasil disiapkan.', 'success');

                    // Refresh daftar sekitar agar radar segera menyesuaikan
                    if (currentTab === 'nearby') loadNearbyUsers(false);
                    else loadFriends();
                } else {
                    const errMsg = data.message || (data.errors ? Object.values(data.errors).flat().join(' ') : 'Gagal menyimpan profil.');
                    const statusEl = document.getElementById('onboardUsernameStatus');
                    if (statusEl && errMsg.toLowerCase().includes('username')) {
                        statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(errMsg)}</span>`;
                    } else {
                        showToast(errMsg, 'error');
                    }
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = '<span>Mulai Menggunakan Blip</span> <i class="fa-solid fa-arrow-right"></i>';
                    }
                }
            } catch (err) {
                console.error(err);
                showToast('Koneksi bermasalah saat menyimpan profil.', 'error');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<span>Mulai Menggunakan Blip</span> <i class="fa-solid fa-arrow-right"></i>';
                }
            }
        }

        function updateGenderUI() {
            const maleBtn = document.getElementById('genderBtnMale');
            const femaleBtn = document.getElementById('genderBtnFemale');

            if (maleBtn) maleBtn.classList.toggle('active', selectedGender === 'male');
            if (femaleBtn) femaleBtn.classList.toggle('active', selectedGender === 'female');
        }

        function onBirthdateChange() {
            const val = document.getElementById('inputProfileBirthdate').value;
            const display = document.getElementById('calculatedAgeDisplay');
            if (!val) {
                if (display) display.innerText = '';
                return;
            }
            const birthDate = new Date(val);
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
                age--;
            }
            if (age >= 0 && age <= 120) {
                if (display) display.innerText = `(${age} tahun)`;
            } else {
                if (display) display.innerText = '';
            }
        }

        // Toast dinonaktifkan secara total
        function showToast(message, type = 'info') {
            // No-op: popup notifikasi toast dinonaktifkan
            return;
        }

        // Cache / Storage
        function getStoredToken() {
            return localStorage.getItem('blip_session_token');
        }
        function setStoredToken(token) {
            localStorage.setItem('blip_session_token', token);
        }

        function getHeaders() {
            const h = { 'Content-Type': 'application/json' };
            const token = getStoredToken();
            if (token) {
                h['X-Blip-Token'] = token;
            }
            return h;
        }

        // WebSocket / Reverb Client
        let echoPusher = null;

        function connectWebSocket() {
            if (!currentUser || !window.Pusher) return;

            try {
                // Enable pusher logging untuk debugging websocket
                window.Pusher.logToConsole = true;

                // Konfigurasi Reverb (Pusher-compatible)
                const wsHost = window.location.hostname || (window.BLIP_CONFIG && window.BLIP_CONFIG.reverbHost) || '127.0.0.1';
                const wsPort = (window.BLIP_CONFIG && window.BLIP_CONFIG.reverbPort) || 8088;
                const reverbKey = (window.BLIP_CONFIG && window.BLIP_CONFIG.reverbKey) ? window.BLIP_CONFIG.reverbKey : 'blip-key';
                const isSecure = window.location.protocol === 'https:';

                echoPusher = new Pusher(reverbKey, {
                    wsHost: wsHost,
                    wsPort: wsPort,
                    wssPort: wsPort,
                    forceTLS: isSecure,
                    enabledTransports: ['ws', 'wss'],
                    disableStats: true,
                    cluster: 'mt1'
                });

                echoPusher.connection.bind('state_change', (states) => {
                    console.log('[WebSocket] Connection state:', states.current);
                });

                echoPusher.connection.bind('connected', () => {
                    console.log('[WebSocket] Reverb connected successfully!');
                });

                echoPusher.connection.bind('error', (err) => {
                    console.warn('[WebSocket] Reverb connection error:', err);
                });

                const userChannel = echoPusher.subscribe('user.' + currentUser.id);

                function handleMessageSent(data) {
                    if (!data || !data.message) return;
                    const msg = data.message;

                    // Jika chat dengan teman ini sedang terbuka
                    const isChatOpenWithFriend = activeChatFriendId && (
                        String(activeChatFriendId) === String(msg.sender_id) || 
                        String(activeChatFriendId) === String(msg.receiver_id)
                    );

                    if (isChatOpenWithFriend) {
                        const existingIdx = currentChatMessages.findIndex(m => m.id === msg.id);
                        if (existingIdx !== -1) {
                            currentChatMessages[existingIdx] = {
                                ...msg,
                                is_me: String(msg.sender_id) === String(currentUser.id),
                                status: 'sent'
                            };
                        } else {
                            currentChatMessages = currentChatMessages.filter(m => !(m.id && String(m.id).startsWith('temp_') && m.message === msg.message));
                            currentChatMessages.push({
                                ...msg,
                                is_me: String(msg.sender_id) === String(currentUser.id),
                                status: 'sent'
                            });
                        }
                        renderMessages(currentChatMessages, true);

                        // Jika pesan datang dari teman saat kita sedang membuka chatnya, otomatis tandai terbaca (read receipt)
                        if (String(msg.sender_id) === String(activeChatFriendId)) {
                            fetch(`/api/blip/messages/${activeChatFriendId}/read`, {
                                method: 'POST',
                                headers: getHeaders()
                            }).catch(() => {});
                        }
                    } else if (String(msg.sender_id) !== String(currentUser.id)) {
                        showToast(`Pesan baru diterima!`, 'info');
                    }

                    updateNotificationBadge();
                    if (currentTab === 'friends') loadFriends();
                }

                // Listen pesan masuk (support dot dan non-dot)
                userChannel.bind('message.sent', handleMessageSent);
                userChannel.bind('.message.sent', handleMessageSent);

                function handleFriendNotification(data) {
                    console.log('[WebSocket] friend.notification event received:', data);
                    if (data.type === 'request_received') {
                        showToast(`Permintaan pertemanan baru dari ${data.sender?.name || 'seseorang'}!`, 'info');
                    } else if (data.type === 'request_accepted') {
                        showToast(`${data.sender?.name || 'Seseorang'} menerima pertemanan Anda!`, 'success');
                        if (currentTab !== 'contacts') {
                            unreadAcceptedFriendsCount++;
                        }
                    } else if (data.type === 'friend_removed') {
                        showToast(`${data.sender?.name || 'Teman Anda'} telah menghapus pertemanan.`, 'info');
                        // Jika chat dengan teman yang unfriend sedang terbuka, tutup otomatis
                        if (activeChatFriendId && data.sender && activeChatFriendId == data.sender.id) {
                            closeChat();
                        }
                    } else if (data.type === 'request_rejected') {
                        showToast(`Permintaan pertemanan Anda ditolak.`, 'info');
                    }

                    updateNotificationBadge();
                    if (currentTab === 'friends' || currentTab === 'contacts') {
                        loadFriends();
                    } else {
                        loadNearbyUsers(false);
                    }
                }

                // Listen permintaan / persetujuan pertemanan (support dot dan non-dot)
                userChannel.bind('friend.notification', handleFriendNotification);
                userChannel.bind('.friend.notification', handleFriendNotification);

                function handleThreadNotification(data) {
                    console.log('[WebSocket] thread.notification event received:', data);
                    if (data.type === 'thread_reply') {
                        showToast(`${data.sender?.name || 'Seseorang'} membalas utas Anda: "${data.previewText || ''}"`, 'info');
                    } else if (data.type === 'thread_mention') {
                        showToast(`${data.sender?.name || 'Seseorang'} menyebut Anda dalam postingan: "${data.previewText || ''}"`, 'info');
                    } else if (data.type === 'thread_like') {
                        const count = data.groupedCount || 1;
                        if (count > 1) {
                            showToast(`${data.sender?.name || 'Seseorang'} dan ${count - 1} orang lainnya menyukai postingan Anda.`, 'info');
                        } else {
                            showToast(`${data.sender?.name || 'Seseorang'} menyukai postingan Anda.`, 'info');
                        }
                    }

                    // Tambah badge unread thread notif
                    unreadThreadNotifsCount++;
                    updateThreadNotificationBadge();

                    // Perbarui notifikasi list di dropdown jika sedang dibuka atau untuk pembaruan berikutnya
                    fetchThreadNotifications();

                    // Jika user sedang membuka thread yang sama, perbarui detail thread
                    if (activeThreadId && data.threadId && activeThreadId == data.threadId) {
                        openThreadView(activeThreadId);
                    } else if (currentTab === 'threads') {
                        loadThreads();
                    }
                }

                // Listen notifikasi thread & mention
                userChannel.bind('thread.notification', handleThreadNotification);
                userChannel.bind('.thread.notification', handleThreadNotification);

                function handleMessagesRead(data) {
                    console.log('[WebSocket] messages.read event received:', data);
                    // Jika teman yang membaca adalah teman yang sedang aktif di chat room kita
                    if (activeChatFriendId && data && (data.readerId == activeChatFriendId || String(data.readerId) === String(activeChatFriendId))) {
                        currentChatMessages = currentChatMessages.map(m => {
                            if (m.is_me) {
                                return {
                                    ...m,
                                    is_read: true,
                                    status: 'sent'
                                };
                            }
                            return m;
                        });
                        renderMessages(currentChatMessages, true);
                    }
                }

                // Listen event centang dua dibaca (messages.read)
                userChannel.bind('messages.read', handleMessagesRead);
                userChannel.bind('.messages.read', handleMessagesRead);

                console.log('[WebSocket] Terhubung ke Reverb pada user.' + currentUser.id);
            } catch (e) {
                console.warn('[WebSocket] Gagal menghubungkan WebSocket, fallback ke polling:', e);
            }
        }

        // Inisialisasi Aplikasi & Akun
        async function initApp() {
            initTheme();
            try {
                const res = await fetch('/api/blip/init', { credentials: 'same-origin', headers: getHeaders() });
                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data.user;
                    setStoredToken(currentUser.session_token);
                    updateUserUI();

                    // Cek onboarding jika user belum memilih jenis kelamin
                    checkOnboarding();

                    // Muat data tab awal (Tab Chat / Friends)
                    loadFriends();

                    // Hubungkan ke WebSocket Reverb
                    connectWebSocket();

                    // Cek status badge notifikasi awal (permintaan & chat belum dibaca) saat web dibuka
                    updateNotificationBadge();

                    // Minta koordinat GPS terbaru browser di background
                    autoDetectLocation();

                    startPolling();
                }
            } catch (err) {
                console.error(err);
                showToast('Gagal memuat sesi akun.', 'error');
            }
        }

        function updateUserUI() {
            if (!currentUser) return;
            const navAv = document.getElementById('navAvatar');
            if (navAv) {
                if (currentUser.avatar_url) {
                    navAv.innerText = '';
                    navAv.style.backgroundImage = `url('${escapeHtml(currentUser.avatar_url)}')`;
                    navAv.style.backgroundSize = 'cover';
                    navAv.style.backgroundPosition = 'center';
                    navAv.style.backgroundColor = 'transparent';
                } else {
                    navAv.innerText = currentUser.name.charAt(0).toUpperCase();
                    navAv.style.backgroundImage = 'none';
                    navAv.style.backgroundColor = currentUser.avatar_color;
                }
            }
            selectedColor = currentUser.avatar_color;
            selectedGender = currentUser.gender || null;
            updateProfileAvatarPreview();
        }

        // Otomatis deteksi lokasi browser tanpa tombol manual
        function autoDetectLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    await syncCoordinates(pos.coords.latitude, pos.coords.longitude);
                }, async (err) => {
                    console.warn('[Geolocation] Browser GPS error/timeout:', err.message);
                    // Fallback jika ditolak/timeout/lokal: gunakan koordinat default Jakarta Selatan (-6.2538, 106.8206)
                    if (!currentUser.latitude || !currentUser.longitude) {
                        await syncCoordinates(-6.2538, 106.8206);
                    } else {
                        loadNearbyUsers();
                    }
                }, { 
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 10000 
                });
            } else {
                if (!currentUser.latitude || !currentUser.longitude) {
                    syncCoordinates(-6.2538, 106.8206);
                } else {
                    loadNearbyUsers();
                }
            }
        }

        async function syncCoordinates(lat, lon) {
            try {
                const res = await fetch('/api/blip/location', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ latitude: lat, longitude: lon })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data.user;
                    if (currentTab === 'friends' || currentTab === 'contacts') {
                        loadFriends();
                    } else if (currentTab === 'nearby') {
                        loadNearbyUsers();
                    } else if (currentTab === 'threads') {
                        loadThreads();
                    }
                }
            } catch (err) {
                console.error(err);
            }
        }

        // Dark/Light Theme Toggle (Disabled - Light Theme Only)
        function toggleTheme() {
            // Theme toggle dinonaktifkan, selalu light mode
        }

        function initTheme() {
            try {
                localStorage.removeItem('blip_theme');
                document.body.classList.remove('dark-theme');
                document.documentElement.removeAttribute('data-theme');
                document.body.removeAttribute('data-theme');
            } catch (e) {}
        }

        // Toggle Right 4th Column Contact Info Panel
        function toggleContactInfoPanel(forceState = null) {
            const panel = document.getElementById('contactInfoPanel');
            if (!panel) return;
            if (forceState !== null) {
                panel.classList.toggle('open', forceState);
            } else {
                panel.classList.toggle('open');
            }
        }

        function updateContactInfoPanel(name, color, distFormatted, gender, age, bio = null, isFriend = true, userId = null, friendshipStatus = null, friendshipInitiator = null, friendshipId = null, avatarUrl = null, username = null) {
            const av = document.getElementById('infoPanelAvatar');
            const nm = document.getElementById('infoPanelName');
            const headerTitle = document.getElementById('infoPanelHeaderTitle');
            const un = document.getElementById('infoPanelUsername');
            const bi = document.getElementById('infoPanelBio');
            const gndr = document.getElementById('infoPanelGender');
            const gndrWrap = document.getElementById('infoPanelMetaGenderWrap');
            const ag = document.getElementById('infoPanelAge');
            const agWrap = document.getElementById('infoPanelMetaAgeWrap');
            const loc = document.getElementById('infoPanelLocation');
            const addFriendWrap = document.getElementById('infoPanelAddFriendWrap');
            const footerActions = document.getElementById('infoPanelFooterActions');

            if (av) {
                if (avatarUrl) {
                    av.innerText = '';
                    av.style.backgroundImage = `url('${escapeHtml(avatarUrl)}')`;
                    av.style.backgroundSize = 'cover';
                    av.style.backgroundPosition = 'center';
                    av.style.backgroundColor = 'transparent';
                    av.style.cursor = 'pointer';
                    av.title = 'Klik untuk melihat foto lebih besar';
                    av.onclick = () => openImageLightbox(avatarUrl);
                } else {
                    av.innerText = name.charAt(0).toUpperCase();
                    av.style.backgroundImage = 'none';
                    av.style.backgroundColor = color || '#4f46e5';
                    av.style.cursor = 'default';
                    av.title = '';
                    av.onclick = null;
                }
            }
            if (nm) nm.innerText = name;
            if (headerTitle) headerTitle.innerText = name;
            if (un) {
                un.innerText = username ? `@${username}` : '';
                un.style.display = username ? 'block' : 'none';
            }
            if (bi) {
                bi.innerText = bio || 'Belum ada bio';
                bi.style.color = bio ? 'var(--text-main)' : 'var(--text-muted)';
            }
            if (loc) loc.innerText = distFormatted || '0 m';

            if (gndr && gndrWrap) {
                if (gender) {
                    gndr.innerText = gender === 'male' ? 'Pria' : 'Wanita';
                    gndrWrap.style.display = 'inline-flex';
                } else {
                    gndrWrap.style.display = 'none';
                }
            }

            if (ag && agWrap) {
                if (age) {
                    ag.innerText = `${age} tahun`;
                    agWrap.style.display = 'inline-flex';
                } else {
                    agWrap.style.display = 'none';
                }
            }

            // Tombol Add Teman / Unfriend di Profil (Threads Style Full Width Button)
            if (addFriendWrap) {
                if (userId && (!currentUser || currentUser.id != userId)) {
                    addFriendWrap.style.display = 'block';
                    const safeName = escapeHtml(name).replace(/'/g, "\\'");
                    if (isFriend) {
                        addFriendWrap.innerHTML = `
                            <button type="button" class="threads-btn-action unfriend" onclick="onUserCardRemoveFriend(event, ${userId}, '${safeName}')" title="Hapus dari daftar teman">
                                <i class="fa-solid fa-user-xmark"></i> <span>Unfriend</span>
                            </button>
                        `;
                    } else if (friendshipStatus === 'pending') {
                        if (friendshipInitiator == (currentUser ? currentUser.id : null)) {
                            addFriendWrap.innerHTML = `
                                <div class="threads-btn-action pending">
                                    <i class="fa-solid fa-clock"></i> <span>Permintaan Terkirim</span>
                                </div>
                            `;
                        } else {
                            addFriendWrap.innerHTML = `
                                <button type="button" class="threads-btn-action add-friend" onclick="respondFriend(${friendshipId}, 'accept')">
                                    <i class="fa-solid fa-check"></i> <span>Terima Permintaan Teman</span>
                                </button>
                            `;
                        }
                    } else {
                        addFriendWrap.innerHTML = `
                            <button type="button" class="threads-btn-action add-friend" onclick="sendFriendRequest(${userId})">
                                <i class="fa-solid fa-user-plus"></i> <span>Add Teman</span>
                            </button>
                        `;
                    }
                } else {
                    addFriendWrap.style.display = 'none';
                    addFriendWrap.innerHTML = '';
                }
            }

            // Tampilkan tombol Hapus Chat di footer panel jika sudah berteman
            if (footerActions) {
                footerActions.style.display = isFriend ? 'block' : 'none';
            }

            // Muat Knot milik pengguna ini jika userId tersedia
            if (userId) {
                loadContactUserKnots(userId);
            }
        }

        async function loadContactUserKnots(userId) {
            const listEl = document.getElementById('infoPanelKnotsList');
            const countEl = document.getElementById('infoPanelHeaderKnotCount');
            if (!listEl) return;

            listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted); padding: 2rem 1rem; text-align: center;"><i class="fa-solid fa-spinner fa-spin"></i> Memuat knot...</div>`;

            try {
                let url = `/api/blip/users/${userId}/threads`;
                if (currentUser && currentUser.latitude && currentUser.longitude) {
                    url += `?latitude=${currentUser.latitude}&longitude=${currentUser.longitude}`;
                }
                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();

                if (data.status === 'success' && data.threads) {
                    const threads = data.threads;
                    if (countEl) countEl.innerText = `${threads.length} Knot`;

                    if (threads.length === 0) {
                        listEl.innerHTML = `
                            <div class="profile-empty-knots">
                                <i class="fa-regular fa-paper-plane"></i>
                                <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">Belum ada Knot</span>
                                <p style="font-size: 0.82rem; margin: 0; line-height: 1.4;">Pengguna ini belum pernah memposting Knot.</p>
                            </div>
                        `;
                        return;
                    }

                    listEl.innerHTML = threads.map(t => renderKnotCardHtml(t, { isContactProfile: true })).join('');
                } else {
                    listEl.innerHTML = `<div class="profile-empty-knots"><i class="fa-regular fa-comment-dots"></i><p>Tidak ada knot.</p></div>`;
                }
            } catch (err) {
                console.error('loadContactUserKnots error:', err);
                listEl.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-muted); padding: 1.5rem; text-align: center;">Gagal memuat knot.</div>`;
            }
        }

        // Buka Info Pengguna untuk orang sekitar yang belum berteman
        async function openNearbyUserInfo(userId) {
            if (!userId) return;

            // Cek apakah diri sendiri
            if (currentUser && currentUser.id == userId) {
                toggleProfileModal();
                return;
            }

            // 1. Cek apakah pengguna ada di daftar Teman (cachedFriendsList)
            if (window.cachedFriendsList && window.cachedFriendsList.length > 0) {
                const friend = window.cachedFriendsList.find(f => f.id == userId);
                if (friend) {
                    updateContactInfoPanel(
                        friend.name,
                        friend.avatar_color,
                        friend.distance_formatted,
                        friend.gender,
                        friend.age,
                        friend.bio,
                        true,
                        friend.id,
                        'accepted',
                        null,
                        null,
                        friend.avatar_url,
                        friend.username
                    );
                    toggleContactInfoPanel(true);
                    return;
                }
            }

            // 2. Cek apakah ada di nearbyUsersList (Radar sekitar)
            let user = nearbyUsersList.find(u => u.id == userId);
            // 3. Cek di threadSearchedUsers (Hasil pencarian pengguna knot)
            if (!user && threadSearchedUsers && threadSearchedUsers.length > 0) {
                user = threadSearchedUsers.find(u => u.id == userId);
            }

            if (user && user.friendship_status !== undefined && user.friendship_status !== null) {
                const fInitiator = user.friendship_initiator !== undefined && user.friendship_initiator !== null ? user.friendship_initiator : null;
                const fId = user.friendship_id ? user.friendship_id : null;
                const fStatus = user.friendship_status;
                const isFriend = (fStatus === 'accepted');
                updateContactInfoPanel(user.name, user.avatar_color, user.distance_formatted, user.gender, user.age, user.bio, isFriend, user.id, fStatus, fInitiator, fId, user.avatar_url, user.username);
                toggleContactInfoPanel(true);
                return;
            }

            // 4. Ambil profil akurat langsung dari backend (/api/blip/users/{id})
            try {
                let url = `/api/blip/users/${userId}`;
                if (currentUser && currentUser.latitude && currentUser.longitude) {
                    url += `?latitude=${currentUser.latitude}&longitude=${currentUser.longitude}`;
                }
                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();
                if (data.status === 'success' && data.user) {
                    const found = data.user;
                    updateContactInfoPanel(
                        found.name,
                        found.avatar_color,
                        found.distance_formatted,
                        found.gender,
                        found.age,
                        found.bio,
                        (found.is_friend || found.friendship_status === 'accepted'),
                        found.id,
                        found.friendship_status,
                        found.friendship_initiator,
                        found.friendship_id,
                        found.avatar_url,
                        found.username
                    );
                    toggleContactInfoPanel(true);
                } else {
                    showToast('Profil pengguna tidak ditemukan.', 'warning');
                }
            } catch (err) {
                console.error('openNearbyUserInfo fetch error:', err);
                showToast('Gagal memuat profil pengguna.', 'error');
            }
        }

        // Search Input State & Controls
        let searchQuery = '';
        let threadSearchedUsers = [];
        let threadSearchUserPage = 1;
        let threadSearchUserHasMore = false;
        let isSearchingThreadUsers = false;
        let isSearchingMoreUsers = false;

        // Dipanggil saat teks di search input berubah (hanya untuk clear button dan live local filter tab non-knot jika diinginkan)
        function handleSearchInputChange(val) {
            const clearBtn = document.getElementById('btnSearchClear');
            if (clearBtn) {
                clearBtn.style.display = (val && val.trim().length > 0) ? 'flex' : 'none';
            }

            // Jika user menghapus seluruh teks pencarian, reset filter
            if (!val || val.trim().length === 0) {
                clearSearchInput();
            }
        }

        // Dipanggil saat tombol submit / Enter ditekan
        function handleSearchSubmit(e) {
            if (e && e.preventDefault) e.preventDefault();
            const input = document.getElementById('searchInput');
            const val = (input ? input.value : '').trim();
            performSearch(val);
        }

        function clearSearchInput() {
            const input = document.getElementById('searchInput');
            if (input) input.value = '';
            const clearBtn = document.getElementById('btnSearchClear');
            if (clearBtn) clearBtn.style.display = 'none';

            searchQuery = '';
            threadSearchedUsers = [];
            threadSearchUserPage = 1;
            threadSearchUserHasMore = false;
            isSearchingThreadUsers = false;

            if (currentTab === 'nearby') {
                filterAndRenderNearby();
            } else if (currentTab === 'threads') {
                threadsNextCursor = null;
                loadThreads(false);
            } else {
                filterAndRenderFriends();
            }
        }

        function performSearch(query) {
            searchQuery = (query || '').toLowerCase().trim();

            if (currentTab === 'nearby') {
                filterAndRenderNearby();
            } else if (currentTab === 'threads') {
                threadsNextCursor = null;
                threadSearchedUsers = [];
                threadSearchUserPage = 1;
                threadSearchUserHasMore = false;

                // Load thread postingan via lazy load API dengan filter search
                loadThreads(false);

                // Jika ada query pencarian, cari juga pengguna untuk di-add friend
                if (searchQuery.length >= 1) {
                    searchUsersInThreadTab(searchQuery, false);
                } else {
                    filterAndRenderThreads();
                }
            } else {
                filterAndRenderFriends();
            }
        }

        async function searchUsersInThreadTab(query, isAppend = false) {
            if (isAppend) {
                if (isSearchingMoreUsers || !threadSearchUserHasMore) return;
                isSearchingMoreUsers = true;
            } else {
                if (isSearchingThreadUsers) return;
                isSearchingThreadUsers = true;
                threadSearchUserPage = 1;
            }

            const fetchPage = isAppend ? (threadSearchUserPage + 1) : 1;

            try {
                let url = `/api/blip/users/search?q=${encodeURIComponent(query)}&page=${fetchPage}&limit=10`;
                if (currentUser && currentUser.latitude) url += `&latitude=${currentUser.latitude}`;
                if (currentUser && currentUser.longitude) url += `&longitude=${currentUser.longitude}`;

                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();
                if (data.status === 'success' && data.users) {
                    threadSearchUserPage = data.page || fetchPage;
                    threadSearchUserHasMore = !!data.has_more;

                    if (isAppend) {
                        const existingIds = new Set(threadSearchedUsers.map(u => u.id));
                        data.users.forEach(u => {
                            if (!existingIds.has(u.id)) threadSearchedUsers.push(u);
                        });
                    } else {
                        threadSearchedUsers = data.users;
                    }
                } else {
                    if (!isAppend) threadSearchedUsers = [];
                }
            } catch (e) {
                console.error('searchUsersInThreadTab error:', e);
                if (!isAppend) threadSearchedUsers = [];
            } finally {
                isSearchingThreadUsers = false;
                isSearchingMoreUsers = false;
                if (currentTab === 'threads') {
                    filterAndRenderThreads();
                }
            }
        }

        // Render Highlight Stories (Avatar Orang Terdekat)
        function renderStoriesHighlights(users) {
            const container = document.getElementById('storiesScrollContainer');
            const badge = document.getElementById('nearbyCountBadge');
            if (!container) return;

            if (!users || users.length === 0) {
                container.innerHTML = `<div style="font-size: 0.75rem; color: var(--text-muted); padding: 0.25rem 0;">Belum ada orang di radar</div>`;
                if (badge) badge.innerText = '';
                return;
            }

            if (badge) badge.innerText = users.length + ' orang';

            const topUsers = users.slice(0, 10);
            container.innerHTML = topUsers.map(u => {
                const safeName = escapeHtml(u.name);
                
                let storyClickAction = '';
                if (u.friendship_status === 'accepted') {
                    storyClickAction = `startChatWithFriend(${u.id})`;
                } else {
                    storyClickAction = `openNearbyUserInfo(${u.id})`;
                }

                const avatarStyle = u.avatar_url
                    ? `background-image: url('${escapeHtml(u.avatar_url)}'); background-size: cover; background-position: center;`
                    : `background-color: ${u.avatar_color};`;
                const avatarContent = u.avatar_url ? '' : u.name.charAt(0).toUpperCase();

                return `
                    <div class="tg-story-item" onclick="${storyClickAction}" title="${safeName} (${u.distance_formatted})">
                        <div class="tg-story-ring" style="border-color: ${u.avatar_color};">
                            <div class="tg-story-avatar" style="${avatarStyle}">
                                ${avatarContent}
                            </div>
                        </div>
                        <span class="tg-story-name">${safeName}</span>
                    </div>
                `;
            }).join('');
        }

        // Tab Navigation & Toggle Sidebar Kedua (Window ke-2)
        function switchTab(tab) {
            const sidebar = document.getElementById('chatsSidebar');
            const isMobile = window.innerWidth <= 768;

            // Jika di PC/Desktop dan tab yang sama ditekan kembali, toggle tutup/buka window ke-2
            // Di HP/Android, tab TIDAK BOLEH di-collapse/disembunyikan saat ditekan ulang
            if (currentTab === tab && sidebar) {
                if (!isMobile) {
                    const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
                    sidebar.classList.toggle('collapsed', !isCurrentlyCollapsed);
                } else {
                    // Di mobile, jika sedang membuka chat/thread lalu tekan tab yang sama, kembali ke daftar list
                    sidebar.classList.remove('collapsed');
                    if (document.body.classList.contains('in-chat-mobile')) {
                        closeChat();
                    } else if (document.body.classList.contains('in-thread-mobile')) {
                        closeThreadView();
                    }
                }
                return;
            }

            // Jika berpindah tab baru, pastikan window ke-2 terbuka
            if (sidebar) {
                sidebar.classList.remove('collapsed');
            }

            // Tutup info pengguna/kontak saat berpindah tab
            toggleContactInfoPanel(false);

            if (currentTab !== 'profile') {
                previousTab = currentTab;
            }

            currentTab = tab;
            const nearbyBtn = document.getElementById('tabNearbyNavBtn');
            const contactsBtn = document.getElementById('tabContactsNavBtn');
            const friendsBtn = document.getElementById('tabFriendsNavBtn');
            const threadsBtn = document.getElementById('tabThreadsNavBtn');
            const navAvatar = document.getElementById('navAvatar');

            if (nearbyBtn) nearbyBtn.classList.toggle('active', tab === 'nearby');
            if (contactsBtn) contactsBtn.classList.toggle('active', tab === 'contacts');
            if (friendsBtn) friendsBtn.classList.toggle('active', tab === 'friends');
            if (threadsBtn) threadsBtn.classList.toggle('active', tab === 'threads');
            if (navAvatar) navAvatar.style.outline = (tab === 'profile') ? '2px solid var(--primary)' : 'none';

            // Tampilkan tombol Buat Thread hanya di tab Thread
            const btnOpenNewThread = document.getElementById('btnOpenNewThread');
            if (btnOpenNewThread) {
                btnOpenNewThread.style.display = (tab === 'threads') ? 'inline-flex' : 'none';
            }
            const btnThreadNotifsToggle = document.getElementById('btnThreadNotifsToggle');
            if (btnThreadNotifsToggle) {
                btnThreadNotifsToggle.style.display = (tab === 'threads') ? 'inline-flex' : 'none';
            }
            const btnRefreshNearby = document.getElementById('btnRefreshNearby');
            if (btnRefreshNearby) {
                btnRefreshNearby.style.display = 'flex';
            }

            // Jika user membuka tab Teman (contacts), reset notifikasi teman yang baru di-acc
            if (tab === 'contacts') {
                unreadAcceptedFriendsCount = 0;
                updateNotificationBadge();
            }

            // Jika user membuka tab Knot (threads), pastikan daftar notifikasi tersinkron
            if (tab === 'threads') {
                fetchThreadNotifications();
            }

            // Tutup inline profile jika kembali ke nearby / contacts / friends / threads
            const chatsContent = document.getElementById('chatsSidebarContent');
            const profileView = document.getElementById('inlineProfileView');
            const listEl = document.getElementById('listContent');

            // Trigger efek fade transisi tab yang halus
            if (listEl) {
                listEl.classList.remove('tab-fade-in');
                void listEl.offsetWidth; // Force reflow
                listEl.classList.add('tab-fade-in');
            }

            if (tab === 'profile') {
                if (chatsContent) chatsContent.style.display = 'none';
                if (profileView) {
                    profileView.style.display = 'flex';
                    profileView.classList.remove('tab-fade-in');
                    void profileView.offsetWidth;
                    profileView.classList.add('tab-fade-in');
                }
                return;
            } else {
                if (chatsContent) chatsContent.style.display = 'flex';
                if (profileView) profileView.style.display = 'none';
            }

            const storiesSection = document.getElementById('nearbyStoriesSection');
            if (storiesSection) {
                storiesSection.style.display = (tab === 'nearby') ? 'block' : 'none';
            }

            const filterTabs = document.getElementById('nearbyFilterTabs');
            if (filterTabs) {
                filterTabs.style.display = (tab === 'nearby') ? 'flex' : 'none';
            }

            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.value = '';
                searchQuery = '';
                if (tab === 'contacts') {
                    searchInput.placeholder = 'Cari teman di Friend List...';
                } else if (tab === 'friends') {
                    searchInput.placeholder = 'Cari riwayat percakapan...';
                } else if (tab === 'threads') {
                    searchInput.placeholder = 'Cari postingan atau user untuk di-add...';
                } else {
                    searchInput.placeholder = 'Cari orang sekitar...';
                }
            }

            if (tab !== 'threads') {
                closeThreadView();
            }

            if (tab === 'nearby') {
                nearbyPage = 1;
                loadNearbyUsers(false);
            } else if (tab === 'contacts' || tab === 'friends') {
                loadFriends();
            } else if (tab === 'threads') {
                loadThreads();
            }
        }

        // Manual Refresh Orang Sekitar & Feed
        async function refreshNearbyManual() {
            const icon = document.getElementById('refreshIcon');
            if (icon) icon.classList.add('fa-spin');
            
            showToast('Memperbarui data sekitar...', 'info');

            // Coba perbarui koordinat GPS jika ada
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    await syncCoordinates(pos.coords.latitude, pos.coords.longitude);
                    await finishRefresh();
                }, async () => {
                    await finishRefresh();
                }, { 
                    enableHighAccuracy: true,
                    maximumAge: 0,
                    timeout: 10000 
                });
            } else {
                await finishRefresh();
            }

            async function finishRefresh() {
                if (currentTab === 'nearby') {
                    await loadNearbyUsers();
                } else if (currentTab === 'threads') {
                    await loadThreads();
                } else {
                    await loadFriends();
                }
                setTimeout(() => {
                    if (icon) icon.classList.remove('fa-spin');
                    showToast('Data berhasil diperbarui!', 'success');
                }, 300);
            }
        }

        // Daftar Orang Sekitar dengan Lazy Load (Infinite Scroll)
        async function loadNearbyUsers(isAppend = false) {
            if (currentTab !== 'nearby') return;
            if (nearbyLoading) return;
            if (isAppend && !nearbyHasMore) return;

            const container = document.getElementById('listContent');
            nearbyLoading = true;

            const fetchPage = isAppend ? nearbyPage + 1 : 1;

            if (isAppend) {
                const loader = document.getElementById('nearbyInfiniteLoader');
                if (loader) loader.style.display = 'block';
            }

            try {
                const res = await fetch(`/api/blip/nearby?radius=15&gender=${nearbyGenderFilter}&page=${fetchPage}&limit=15`, { headers: getHeaders() });
                const data = await res.json();

                nearbyPage = data.page || fetchPage;
                nearbyHasMore = !!data.has_more;

                const newUsers = data.nearby || [];

                if (!isAppend) {
                    nearbyUsersList = newUsers;
                    // Render stories highlight orang-orang terdekat
                    renderStoriesHighlights(nearbyUsersList);
                } else {
                    // Hindari duplikasi jika ada user baru
                    const existingIds = new Set(nearbyUsersList.map(u => u.id));
                    newUsers.forEach(u => {
                        if (!existingIds.has(u.id)) nearbyUsersList.push(u);
                    });
                }

                filterAndRenderNearby();

            } catch (err) {
                console.error(err);
            } finally {
                nearbyLoading = false;
            }
        }

        // Filter and Render Nearby List (Mendukung live search)
        function filterAndRenderNearby() {
            const container = document.getElementById('listContent');
            if (!container) return;

            let filtered = nearbyUsersList;
            if (searchQuery) {
                const q = searchQuery.replace(/^@/, '');
                filtered = filtered.filter(u => 
                    (u.name && u.name.toLowerCase().includes(q)) || 
                    (u.username && u.username.toLowerCase().includes(q))
                );
            }

            if (filtered.length === 0) {
                const filterMsg = searchQuery 
                    ? `Tidak ditemukan orang dengan nama "${escapeHtml(searchQuery)}".` 
                    : (nearbyGenderFilter === 'female' 
                        ? 'Tidak ada pengguna wanita yang aktif di sekitar Anda.' 
                        : (nearbyGenderFilter === 'male' ? 'Tidak ada pengguna pria yang aktif di sekitar Anda.' : 'Belum ada pengguna lain yang aktif di radius Anda.'));
                container.innerHTML = `
                    <div style="text-align:center; padding: 3rem 1rem; color: var(--text-muted);">
                        <i class="fa-solid fa-tower-broadcast" style="font-size: 2.2rem; color: #93c5fd; margin-bottom: 0.75rem;"></i>
                        <h4 style="color:var(--text-main); margin-bottom: 0.25rem; font-weight: 700;">Tidak Ada Orang di Sekitar</h4>
                        <p style="font-size: 0.85rem;">${filterMsg}</p>
                    </div>
                `;
                return;
            }

            const cardsHtml = filtered.map(u => {
                let rightSideHtml = '';
                const safeName = escapeHtml(u.name);
                const safeGender = u.gender ? `'${u.gender}'` : 'null';
                const safeAge = u.age ? u.age : 'null';
                const safeBio = u.bio ? escapeHtml(u.bio) : '';
                const safeUsername = u.username ? escapeHtml(u.username) : '';
                const handleHtml = safeUsername ? `<span class="user-handle">@${safeUsername}</span>` : '';

                // Label [Teman] di samping kanan nama/gender
                const friendBadgeHtml = u.friendship_status === 'accepted' ? `<span class="user-friend-badge">[Teman]</span>` : '';

                if (u.friendship_status === 'pending') {
                    if (u.friendship_initiator == currentUser.id) {
                        rightSideHtml = `<span style="font-size: 0.75rem; color: var(--warning); display: inline-flex; align-items: center; gap: 0.25rem;"><i class="fa-solid fa-clock"></i> Terkirim</span>`;
                    } else {
                        rightSideHtml = `<span style="font-size: 0.75rem; color: var(--primary); display: inline-flex; align-items: center; gap: 0.25rem;"><i class="fa-solid fa-clock"></i> Masuk</span>`;
                    }
                }

                const sublineHtml = renderUserSubline(u.distance_formatted, u.gender, u.age);
                const bioHtml = safeBio ? `<div class="user-card-bio" title="${safeBio}">${safeBio}</div>` : '';

                let cardClickAction = '';
                if (u.friendship_status === 'accepted') {
                    cardClickAction = `startChatWithFriend(${u.id})`;
                } else {
                    cardClickAction = `openNearbyUserInfo(${u.id})`;
                }

                return `
                    <div class="user-card" onclick="${cardClickAction}">
                        <div class="user-meta">
                            ${renderAvatarHtml(u.name, u.avatar_color, u.avatar_url)}
                            <div class="user-details">
                                <div class="user-top-row">
                                    <div class="name">${safeName} ${handleHtml} ${renderGenderIcon(u.gender)} ${friendBadgeHtml}</div>
                                    ${rightSideHtml ? `<div style="flex-shrink: 0;">${rightSideHtml}</div>` : ''}
                                </div>
                                ${sublineHtml}
                                ${bioHtml}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            const loaderHtml = `
                <div id="nearbyInfiniteLoader" style="display: none; text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.8rem;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Memuat orang lainnya...
                </div>
            `;

            container.innerHTML = cardsHtml + loaderHtml;
        }

        // Cek update pertemanan & pesan baru untuk badge real-time
        async function updateNotificationBadge(friendsData = null) {
            try {
                let data = friendsData;
                if (!data) {
                    const res = await fetch('/api/blip/friends', { headers: getHeaders() });
                    data = await res.json();
                }

                const reqBadge = document.getElementById('friendRequestBadge');
                const unreadBadge = document.getElementById('unreadMessagesBadge');

                // Permintaan pertemanan masuk & teman baru yang di-acc -> badge di tab Teman (Friend List)
                const incomingCount = (data.incoming_requests && data.incoming_requests.length) || 0;
                const currentFriendsCount = (data.friends && data.friends.length) || 0;

                // Jika polling mendeteksi jumlah teman bertambah dan user sedang tidak di tab contacts
                if (lastKnownFriendsCount !== null && currentFriendsCount > lastKnownFriendsCount && currentTab !== 'contacts') {
                    unreadAcceptedFriendsCount += (currentFriendsCount - lastKnownFriendsCount);
                }
                lastKnownFriendsCount = currentFriendsCount;

                const totalContactsBadge = incomingCount + unreadAcceptedFriendsCount;
                if (reqBadge) {
                    if (totalContactsBadge > 0) {
                        reqBadge.innerText = totalContactsBadge > 99 ? '99+' : totalContactsBadge;
                        reqBadge.style.display = 'inline-flex';
                    } else {
                        reqBadge.style.display = 'none';
                    }
                }

                // Pesan yang belum dibaca -> badge di tab Chat
                let unreadMessagesCount = 0;
                if (data.friends && data.friends.length > 0) {
                    unreadMessagesCount = data.friends.reduce((total, f) => total + (f.unread_count || 0), 0);
                }
                if (unreadBadge) {
                    if (unreadMessagesCount > 0) {
                        unreadBadge.innerText = unreadMessagesCount > 99 ? '99+' : unreadMessagesCount;
                        unreadBadge.style.display = 'inline-flex';
                    } else {
                        unreadBadge.style.display = 'none';
                    }
                }

                return data;
            } catch (err) {
                console.error(err);
            }
        }

        // Daftar Teman (Friend List) & Chat
        async function loadFriends() {
            const container = document.getElementById('listContent');
            try {
                const res = await fetch('/api/blip/friends', { headers: getHeaders() });
                const data = await res.json();

                // Update badge selalu
                updateNotificationBadge(data);

                if (currentTab !== 'friends' && currentTab !== 'contacts') return;

                // Simpan cache teman untuk search
                window.cachedFriendsData = data;
                filterAndRenderFriends();

            } catch (err) {
                console.error(err);
            }
        }

        function filterAndRenderFriends() {
            if (currentTab !== 'friends' && currentTab !== 'contacts') return;
            const container = document.getElementById('listContent');
            const data = window.cachedFriendsData || {};
            let html = '';

            const isContactsTab = currentTab === 'contacts';

            // Permintaan pertemanan masuk
            if (data.incoming_requests && data.incoming_requests.length > 0) {
                html += `
                    <div class="tg-section-label" style="padding: 0.2rem 0.5rem 0.4rem; color: var(--primary);">
                        <span>Permintaan Masuk (${data.incoming_requests.length})</span>
                    </div>
                `;
                data.incoming_requests.forEach(req => {
                    const sublineHtml = renderUserSubline(req.distance_formatted, req.gender, req.age);
                    const safeReqUsername = req.username ? escapeHtml(req.username) : '';
                    const reqHandleHtml = safeReqUsername ? `<span class="user-handle">@${safeReqUsername}</span>` : '';
                    html += `
                        <div class="user-card" style="margin-bottom: 0.35rem;">
                            <div class="user-meta">
                                ${renderAvatarHtml(req.name, req.avatar_color, req.avatar_url, '', 'width: 38px; height: 38px; font-size: 0.95rem;')}
                                <div class="user-details">
                                    <div class="name">${escapeHtml(req.name)} ${reqHandleHtml} ${renderGenderIcon(req.gender)}</div>
                                    ${sublineHtml}
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.35rem;">
                                <button type="button" class="btn-icon btn-icon-sm btn-icon-accept" onclick="event.stopPropagation(); respondFriend(${req.friendship_id}, 'accept')" title="Terima Permintaan">
                                    <i class="fa-solid fa-check"></i>
                                </button>
                                <button type="button" class="btn-icon btn-icon-sm btn-icon-reject" onclick="event.stopPropagation(); respondFriend(${req.friendship_id}, 'reject')" title="Tolak Permintaan">
                                    <i class="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                        </div>
                    `;
                });
                html += `
                    <div class="tg-section-label" style="margin-top: 1.1rem; padding: 0.4rem 0.5rem 0.3rem; border-top: 1px solid var(--border-color);">
                        <span>${isContactsTab ? 'Daftar Teman (' + data.friends.length + ')' : 'Obrolan Teman'}</span>
                    </div>
                `;
            }

            window.cachedFriendsList = data.friends || [];
            let friendsList = window.cachedFriendsList;
            if (searchQuery) {
                const q = searchQuery.replace(/^@/, '');
                friendsList = friendsList.filter(f => 
                    (f.name && f.name.toLowerCase().includes(q)) || 
                    (f.username && f.username.toLowerCase().includes(q))
                );
            }

            if (friendsList.length === 0) {
                if (!data.incoming_requests || data.incoming_requests.length === 0) {
                    const emptyMsg = searchQuery 
                        ? `Tidak ditemukan teman dengan nama "${escapeHtml(searchQuery)}".` 
                        : (isContactsTab 
                            ? 'Belum ada teman terhubung. Temukan orang di tab <b>Sekitar</b> dan klik "Add Teman"!' 
                            : 'Belum ada percakapan aktif. Pilih teman dari <b>Friend List</b> untuk mulai obrolan.');
                    html += `
                        <div style="text-align:center; padding: 3rem 1rem; color: var(--text-muted);">
                            <i class="${isContactsTab ? 'fa-solid fa-address-book' : 'fa-solid fa-comments'}" style="font-size: 2.2rem; color: #cbd5e1; margin-bottom: 0.75rem;"></i>
                            <h4 style="color:var(--text-main); margin-bottom: 0.25rem; font-weight: 700;">${searchQuery ? 'Tidak Ditemukan' : (isContactsTab ? 'Friend List Masih Kosong' : 'Belum Ada Obrolan')}</h4>
                            <p style="font-size: 0.85rem;">${emptyMsg}</p>
                        </div>
                    `;
                }
            } else {
                friendsList.forEach(f => {
                    const isCurrentActive = activeChatFriendId === f.id;
                    const safeName = escapeHtml(f.name);
                    const safeUsername = f.username ? escapeHtml(f.username) : '';
                    const handleHtml = safeUsername ? `<span class="user-handle">@${safeUsername}</span>` : '';
                    const safeGender = f.gender ? `'${f.gender}'` : 'null';
                    const safeAge = f.age ? f.age : 'null';
                    const safeBio = f.bio ? `'${escapeHtml(f.bio).replace(/'/g, "\\'")}'` : 'null';

                    let subtitleHtml = '';
                    let topRowTimeHtml = '';

                    if (!isContactsTab) {
                        // Di tab Chat: Tampilkan last message bubble
                        if (f.last_message) {
                            const senderPrefix = f.last_message_is_me ? '<span style="color: var(--primary); font-weight: 600;">Anda: </span>' : '';
                            const unreadClass = f.unread_count > 0 ? 'unread' : '';
                            subtitleHtml = `<div class="user-last-message ${unreadClass}">${senderPrefix}${escapeHtml(f.last_message)}</div>`;
                            topRowTimeHtml = f.last_message_time ? `<span class="time">${f.last_message_time}</span>` : '';
                        } else {
                            subtitleHtml = `<div class="user-last-message empty">Belum ada pesan</div>`;
                        }
                    } else {
                        // Di tab Teman (Friend List): Tampilkan Jarak • Gender • Umur
                        subtitleHtml = renderUserSubline(f.distance_formatted, f.gender, f.age);
                    }

                    const unreadBadgeHtml = f.unread_count > 0 ? `<span class="badge-count avatar-badge">${f.unread_count}</span>` : '';

                    html += `
                        <div class="user-card ${isCurrentActive ? 'active-chat' : ''}" id="userCard_${f.id}" onclick="startChatWithFriend(${f.id})">
                            <div class="user-meta">
                                ${renderAvatarHtml(f.name, f.avatar_color, f.avatar_url, '', '', unreadBadgeHtml)}
                                <div class="user-details">
                                    <div class="user-top-row">
                                        <div class="name">${safeName} ${handleHtml} ${renderGenderIcon(f.gender)}</div>
                                        ${topRowTimeHtml}
                                    </div>
                                    ${subtitleHtml}
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.35rem;">
                                <button type="button" class="user-card-menu-btn" onclick="toggleUserCardMenu(event, ${f.id})" title="Opsi teman">
                                    <i class="fa-solid fa-ellipsis-vertical"></i>
                                </button>
                            </div>

                            <!-- Dropdown Menu Opsi Teman -->
                            <div class="user-card-dropdown" id="userCardDropdown_${f.id}" onclick="event.stopPropagation()">
                                <button type="button" class="message-menu-item" onclick="onUserCardClearChat(event, ${f.id}, '${safeName}')">
                                    <i class="fa-solid fa-eraser" style="color: var(--primary);"></i>
                                    <span>Hapus riwayat chat</span>
                                </button>
                                <button type="button" class="message-menu-item danger" onclick="onUserCardRemoveFriend(event, ${f.id}, '${safeName}')">
                                    <i class="fa-solid fa-user-xmark" style="color: var(--danger);"></i>
                                    <span>Hapus teman</span>
                                </button>
                            </div>
                        </div>
                    `;
                });
            }

            container.innerHTML = html;
        }

        let activeUserCardMenuId = null;

        function toggleUserCardMenu(e, friendId) {
            e.stopPropagation(); // Mencegah trigger buka chat saat klik titik tiga
            const dropdown = document.getElementById(`userCardDropdown_${friendId}`);
            const card = document.getElementById(`userCard_${friendId}`);
            if (!dropdown) return;

            const isOpen = dropdown.style.display === 'flex';
            closeAllUserCardMenus();

            if (!isOpen) {
                dropdown.style.display = 'flex';
                if (card) card.classList.add('menu-open');
                activeUserCardMenuId = friendId;
            }
        }

        function closeAllUserCardMenus() {
            document.querySelectorAll('.user-card-dropdown').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.user-card.menu-open').forEach(el => el.classList.remove('menu-open'));
            activeUserCardMenuId = null;
        }

        // 1. Hapus Riwayat Chat dari Titik Tiga User Card
        async function onUserCardClearChat(e, friendId, friendName) {
            e.stopPropagation();
            closeAllUserCardMenus();

            const confirmAction = async () => {
                try {
                    const res = await fetch(`/api/blip/messages/clear/${friendId}`, {
                        method: 'DELETE',
                        headers: getHeaders()
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        showToast(`Riwayat obrolan dengan ${friendName} telah dibersihkan.`, 'success');
                        if (activeChatFriendId === friendId) {
                            currentChatMessages = [];
                            renderMessages(currentChatMessages);
                        }
                        loadFriends();
                    } else {
                        showToast(data.message || 'Gagal membersihkan obrolan.', 'error');
                    }
                } catch (err) {
                    showToast('Koneksi bermasalah.', 'error');
                }
            };

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Hapus Riwayat Chat?',
                    text: `Seluruh riwayat pesan dengan "${friendName}" akan dibersihkan dari tampilan Anda.`,
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-eraser" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: 'Hapus Riwayat',
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then(result => {
                    if (result.isConfirmed) confirmAction();
                });
            } else {
                if (confirm(`Hapus seluruh riwayat pesan dengan "${friendName}"?`)) {
                    confirmAction();
                }
            }
        }

        // 2. Hapus Teman (Unfriend) dari Titik Tiga User Card
        async function onUserCardRemoveFriend(e, friendId, friendName) {
            e.stopPropagation();
            closeAllUserCardMenus();

            const confirmAction = async () => {
                try {
                    const res = await fetch(`/api/blip/friend/${friendId}`, {
                        method: 'DELETE',
                        headers: getHeaders()
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        showToast(`"${friendName}" telah dihapus dari daftar teman.`, 'success');
                        // Tutup obrolan jika teman yang dihapus sedang dibuka
                        if (activeChatFriendId === friendId) {
                            closeChat();
                        }
                        loadFriends();
                        updateNotificationBadge();
                    } else {
                        showToast(data.message || 'Gagal menghapus teman.', 'error');
                    }
                } catch (err) {
                    showToast('Koneksi bermasalah.', 'error');
                }
            };

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Hapus Teman?',
                    text: `Anda dan "${friendName}" tidak akan lagi berteman, dan seluruh riwayat percakapan akan dihapus permanen dari database.`,
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-user-xmark" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: 'Hapus Teman',
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then(result => {
                    if (result.isConfirmed) confirmAction();
                });
            } else {
                if (confirm(`Yakin ingin menghapus "${friendName}" dari daftar teman?`)) {
                    confirmAction();
                }
            }
        }

        // Add Teman
        async function sendFriendRequest(targetUserId) {
            try {
                // Optimistic UI update: langsung ubah status target di nearby & searched users list menjadi 'pending'
                const targetInList = nearbyUsersList.find(u => u.id == targetUserId);
                if (targetInList) {
                    targetInList.friendship_status = 'pending';
                    targetInList.friendship_initiator = currentUser ? currentUser.id : null;
                    filterAndRenderNearby();
                }

                const targetInSearch = threadSearchedUsers.find(u => u.id == targetUserId);
                if (targetInSearch) {
                    targetInSearch.friendship_status = 'pending';
                    targetInSearch.friendship_initiator = currentUser ? currentUser.id : null;
                    if (currentTab === 'threads') {
                        filterAndRenderThreads();
                    }
                }

                // Perbarui juga tombol di panel Info Pengguna jika sedang terbuka untuk user ini
                const addFriendWrap = document.getElementById('infoPanelAddFriendWrap');
                if (addFriendWrap && addFriendWrap.style.display !== 'none') {
                    addFriendWrap.innerHTML = `<span style="font-size: 0.85rem; color: var(--warning); display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.5rem 1rem; border-radius: 999px; background: rgba(245, 158, 11, 0.1); font-weight: 600;"><i class="fa-solid fa-clock"></i> Permintaan Terkirim</span>`;
                }

                // Perbarui juga tombol di modal daftar penyuka (Likes Modal) jika tombol ada
                const likeActionBtn = document.getElementById(`likeUserActionBtn_${targetUserId}`);
                if (likeActionBtn) {
                    likeActionBtn.outerHTML = `<span class="knot-search-user-btn pending"><i class="fa-solid fa-clock"></i> Terkirim</span>`;
                }

                const res = await fetch('/api/blip/friend-request', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ target_user_id: targetUserId })
                });
                const data = await res.json();
                if (data.status === 'success' || data.status === 'accepted') {
                    showToast(data.message, 'success');
                    if (targetInSearch) {
                        targetInSearch.friendship_status = (data.status === 'accepted') ? 'accepted' : 'pending';
                        if (currentTab === 'threads') filterAndRenderThreads();
                    }
                    nearbyPage = 1;
                    loadNearbyUsers(false);
                } else {
                    showToast(data.message || 'Gagal mengirim permintaan.', 'error');
                    nearbyPage = 1;
                    loadNearbyUsers(false);
                }
            } catch (err) {
                showToast('Koneksi bermasalah', 'error');
                nearbyPage = 1;
                loadNearbyUsers(false);
            }
        }

        // Respond Pertemanan
        async function respondFriend(friendshipId, action) {
            try {
                const res = await fetch('/api/blip/friend-respond', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ friendship_id: friendshipId, action })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast(data.message, 'success');
                    // Jika tab Sekitar sedang aktif, langsung reload radar sekitar
                    if (currentTab === 'nearby') {
                        loadNearbyUsers();
                    } else {
                        loadFriends();
                        // Reset list nearby di memori agar statusnya ter-refresh saat kembali ke tab Sekitar
                        loadNearbyUsers();
                    }
                    updateNotificationBadge();
                } else {
                    showToast(data.message || 'Gagal merespons pertemanan.', 'error');
                }
            } catch (err) {
                showToast('Gagal merespons pertemanan.', 'error');
            }
        }

        // Mulai Chat
        async function startChatWithFriend(friendId, name = null, color = null, distFormatted = null, gender = null, age = null, bio = null) {
            try {
                // Jika parameter profil tidak lengkap, cari dari cachedFriendsList atau nearbyUsersList
                let friendObj = null;
                if (window.cachedFriendsList && window.cachedFriendsList.length > 0) {
                    friendObj = window.cachedFriendsList.find(f => f.id == friendId);
                }
                if (!friendObj && nearbyUsersList && nearbyUsersList.length > 0) {
                    friendObj = nearbyUsersList.find(u => u.id == friendId);
                }

                let friendAvatarUrl = null;
                if (friendObj) {
                    name = friendObj.name || name;
                    color = friendObj.avatar_color || color;
                    distFormatted = friendObj.distance_formatted || distFormatted;
                    gender = friendObj.gender !== undefined ? friendObj.gender : gender;
                    age = friendObj.age !== undefined ? friendObj.age : age;
                    bio = friendObj.bio !== undefined ? friendObj.bio : bio;
                    friendAvatarUrl = friendObj.avatar_url || null;
                }

                name = name || 'Teman';
                color = color || '#2b77f8';
                distFormatted = distFormatted || '0 m';

                const res = await fetch(`/api/blip/messages/${friendId}`, { headers: getHeaders() });
                const data = await res.json();

                if (data.status !== 'success') {
                    showToast(data.message || 'Harus saling add dulu untuk chattingan!', 'error');
                    return;
                }

                // Tutup interface thread knot jika sedang aktif
                if (activeThreadId) {
                    closeThreadView();
                }

                activeChatFriendId = friendId;
                document.body.classList.add('in-chat-mobile');
                try {
                    if (!history.state || !history.state.inChat) {
                        history.pushState({ inChat: true, friendId }, '');
                    }
                } catch (e) {}

                document.getElementById('chatEmptyState').style.display = 'none';
                const iface = document.getElementById('activeChatInterface');
                iface.style.display = 'flex';
                const threadIface = document.getElementById('activeThreadInterface');
                if (threadIface) threadIface.style.display = 'none';
                iface.style.display = 'flex';

                document.getElementById('chatHeaderName').innerText = name;
                
                let friendUsername = (data.friend && data.friend.username) || (friendObj && friendObj.username) || '';
                const usernameEl = document.getElementById('chatHeaderUsername');
                if (usernameEl) {
                    usernameEl.innerText = friendUsername ? `@${friendUsername}` : '';
                    usernameEl.style.display = friendUsername ? 'inline' : 'none';
                }

                // Ganti baris bawah nama dengan Bio
                const bioEl = document.getElementById('chatHeaderBio');
                if (bioEl) {
                    bioEl.innerText = bio ? bio : 'Belum ada bio';
                    bioEl.title = bio || '';
                }

                const tagsEl = document.getElementById('chatHeaderTags');
                if (tagsEl) {
                    tagsEl.innerHTML = renderHeaderTags(gender, age);
                }

                const av = document.getElementById('chatHeaderAvatar');
                if (av) {
                    if (friendAvatarUrl) {
                        av.innerText = '';
                        av.style.backgroundImage = `url('${escapeHtml(friendAvatarUrl)}')`;
                        av.style.backgroundSize = 'cover';
                        av.style.backgroundPosition = 'center';
                        av.style.backgroundColor = 'transparent';
                    } else {
                        av.innerText = name.charAt(0).toUpperCase();
                        av.style.backgroundImage = 'none';
                        av.style.backgroundColor = color;
                    }
                }

                renderMessages(data.messages, true);

                // Update info di 4th Column Contact Info Panel
                updateContactInfoPanel(name, color, distFormatted, gender, age, bio, true, friendId, null, null, null, friendAvatarUrl, friendUsername);

                // Hilangkan angka notifikasi unread untuk teman ini karena chat sudah dibuka
                if (window.cachedFriendsList && window.cachedFriendsList.length > 0) {
                    const f = window.cachedFriendsList.find(item => item.id == friendId);
                    if (f && f.unread_count > 0) {
                        f.unread_count = 0;
                        if (currentTab === 'friends') loadFriends();
                    }
                }
                updateNotificationBadge();

                // Start polling cadangan (setiap 3 detik) agar pesan selalu masuk
                startChatPolling();

            } catch (err) {
                console.error('[startChatWithFriend] Error:', err);
                showToast(err.message || 'Gagal memuat percakapan.', 'error');
            }
        }

        let chatPollingInterval = null;
        function startChatPolling() {
            stopChatPolling();
            // Jika WebSocket Reverb sudah terhubung normal, matikan polling HTTP untuk hemat RAM & traffic
            if (echoPusher && echoPusher.connection && echoPusher.connection.state === 'connected') {
                return;
            }
            // Fallback polling lambat (hanya aktif jika WebSocket gagal/terputus)
            chatPollingInterval = setInterval(() => {
                if (activeChatFriendId) {
                    if (echoPusher && echoPusher.connection && echoPusher.connection.state === 'connected') {
                        stopChatPolling();
                        return;
                    }
                    pollActiveChat();
                }
            }, 8000);
        }

        function stopChatPolling() {
            if (chatPollingInterval) {
                clearInterval(chatPollingInterval);
                chatPollingInterval = null;
            }
        }

        function closeChat() {
            stopChatPolling();
            activeChatFriendId = null;
            cancelSelectMode();
            document.body.classList.remove('in-chat-mobile');
            document.getElementById('activeChatInterface').style.display = 'none';
            document.getElementById('chatEmptyState').style.display = 'flex';
            toggleContactInfoPanel(false);
        }

        // In-memory list untuk pesan chat saat ini (termasuk optimistik pending)
        let currentChatMessages = [];

        // State untuk Selection Mode
        let isSelectionMode = false;
        let selectedMessageIds = new Set();
        let activeMenuMessageId = null;

        function formatMessageLocalTime(m) {
            if (m.created_at) {
                try {
                    const d = new Date(m.created_at);
                    if (!isNaN(d.getTime())) {
                        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                    }
                } catch (e) {}
            }
            return m.time || '';
        }

        // Deteksi apakah pesan hanya berisi 1 emoji (gaya Telegram Desktop)
        function isSingleEmojiOnly(str) {
            if (!str) return false;
            const trimmed = str.trim();
            if (!trimmed) return false;
            try {
                if (typeof Intl !== 'undefined' && Intl.Segmenter) {
                    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
                    const segments = Array.from(segmenter.segment(trimmed));
                    if (segments.length === 1) {
                        const regex = /\p{Extended_Pictographic}/u;
                        return regex.test(segments[0].segment);
                    }
                    return false;
                }
            } catch (e) {}
            // Fallback regex jika Intl.Segmenter tidak tersedia
            const emojiRegex = /^(\p{Extended_Pictographic}(?:\u200D\p{Extended_Pictographic})*[\uFE0E\uFE0F]?)$/u;
            return emojiRegex.test(trimmed);
        }

        function renderMessages(msgs, forceScroll = false) {
            const container = document.getElementById('chatMessages');
            if (!container) return;

            const newMsgs = msgs || [];

            // Cek apakah posisi scroll user sedang di bagian bawah (toleransi 80px)
            const isNearBottom = (container.scrollHeight - container.scrollTop - container.clientHeight) < 80;

            // Jika tidak ada perubahan data pesan dan bukan force scroll, lewati re-render DOM agar tidak berkedip / scroll reset
            const isIdentical = currentChatMessages.length === newMsgs.length &&
                currentChatMessages.every((m, idx) => {
                    const nm = newMsgs[idx];
                    return m.id === nm.id && m.status === nm.status && m.is_read === nm.is_read && m.message === nm.message;
                });

            if (isIdentical && !forceScroll) {
                return;
            }

            currentChatMessages = newMsgs;

            if (currentChatMessages.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; margin: auto;">
                        <i class="fa-regular fa-comments"></i> Belum ada pesan. Mulai obrolan dengan teman Anda!
                    </div>
                `;
                return;
            }

            container.innerHTML = currentChatMessages.map(m => {
                let statusIconHtml = '';
                const displayTime = formatMessageLocalTime(m);

                // Hanya pesan yang dikirim oleh saya yang menampilkan status centang/pending
                if (m.is_me) {
                    if (m.status === 'pending') {
                        // Pending: icon jam pasir / clock
                        statusIconHtml = `<span class="message-status-icon pending" title="Pending / Mengirim..."><i class="fa-regular fa-clock"></i></span>`;
                    } else if (m.is_read) {
                        // Receive / Read: icon centang dua
                        statusIconHtml = `<span class="message-status-icon received" title="Diterima & Dibaca"><i class="fa-solid fa-check-double"></i></span>`;
                    } else {
                        // Send: icon centang satu
                        statusIconHtml = `<span class="message-status-icon sent" title="Terkirim"><i class="fa-solid fa-check"></i></span>`;
                    }
                }

                const isRealMessage = m.id && !String(m.id).startsWith('temp_');
                const isSelected = selectedMessageIds.has(m.id);

                // Tombol Titik Tiga (muncul saat hover)
                const moreBtnHtml = isRealMessage ? `
                    <button class="message-more-btn" onclick="openMessageMenu(event, ${m.id})" title="Opsi pesan">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </button>
                ` : '';

                // Checkbox saat Selection Mode
                const checkboxHtml = isRealMessage ? `
                    <input type="checkbox" class="message-select-checkbox" ${isSelected ? 'checked' : ''} onclick="toggleSelectMessage(event, ${m.id})">
                ` : '';

                // Render Pesan Foto (Kompresi Server ~100KB, Hilang 1 Jam jika tidak disimpan)
                let bubbleContentHtml = '';
                if (m.type === 'image') {
                    const isExpired = m.is_expired || (!m.photo_url && !m.is_saved);
                    const sizeStr = m.photo_size ? (m.photo_size < 1024 * 1024 ? Math.round(m.photo_size / 1024) + ' KB' : (m.photo_size / (1024 * 1024)).toFixed(1) + ' MB') : '~100 KB';
                    const captionHtml = m.message ? `<div class="message-text" style="margin-top: 0.35rem;">${escapeHtml(m.message)}</div>` : '';

                    if (isExpired) {
                        bubbleContentHtml = `
                            <div class="photo-expired-box">
                                <div class="photo-expired-icon-wrapper">
                                    <i class="fa-regular fa-clock"></i>
                                </div>
                                <div class="photo-expired-info">
                                    <div class="photo-expired-title">Foto telah kedaluwarsa</div>
                                    <div class="photo-expired-sub">Dihapus otomatis karena tidak disimpan</div>
                                </div>
                            </div>
                            ${captionHtml}
                        `;
                    } else {
                        // Badge kedaluwarsa 1 jam mutlak
                        let expiryBadge = '';
                        if (m.expires_at) {
                            expiryBadge = `<span class="photo-status-badge ephemeral" title="Foto otomatis hangus dan hilang dalam 1 jam"><i class="fa-regular fa-clock"></i> 1 Jam</span>`;
                        }

                        bubbleContentHtml = `
                            <div class="server-photo-card">
                                <div class="photo-img-wrapper">
                                    <img src="${m.photo_url}" class="server-photo-img" onclick="openImageLightbox('${m.photo_url}')" alt="Foto Obrolan" loading="lazy">
                                    <div class="photo-overlay-badges">
                                        ${expiryBadge}
                                    </div>
                                </div>
                                <div class="photo-meta-bar">
                                    <span style="font-size: 0.72rem; opacity: 0.85;"><i class="fa-solid fa-compress"></i> Terkompresi (${sizeStr})</span>
                                    <a href="${m.photo_url}" download="foto_blip_${m.id}.jpg" class="photo-dl-link" title="Download ke HP/Komputer" onclick="event.stopPropagation()">
                                        <i class="fa-solid fa-download"></i>
                                    </a>
                                </div>
                            </div>
                            ${captionHtml}
                        `;
                    }
                }

                let isSingleEmoji = false;
                if (m.type !== 'image' && m.message && isSingleEmojiOnly(m.message)) {
                    isSingleEmoji = true;
                    bubbleContentHtml = `<div class="single-emoji-text">${escapeHtml(m.message.trim())}</div>`;
                } else if (m.type !== 'image') {
                    bubbleContentHtml = `<div class="message-text">${escapeHtml(m.message)}</div>`;
                }

                return `
                    <div class="message-row ${m.is_me ? 'me' : 'other'} ${isSelected ? 'selected' : ''}" id="msgRow_${m.id}">
                        ${!m.is_me ? checkboxHtml : ''}
                        <div class="message-bubble ${m.is_me ? 'me' : 'other'} ${isSingleEmoji ? 'single-emoji-bubble' : ''}" onclick="onBubbleClicked(${m.id})">
                            ${moreBtnHtml}
                            ${bubbleContentHtml}
                            <div class="message-footer">
                                <span class="message-time">${displayTime}</span>
                                ${statusIconHtml}
                            </div>
                        </div>
                        ${m.is_me ? checkboxHtml : ''}
                    </div>
                `;
            }).join('');

            // Hanya auto-scroll ke dasar jika user memang sedang berada di paling bawah atau saat mengirim pesan baru
            if (forceScroll || isNearBottom) {
                container.scrollTop = container.scrollHeight;
            }
        }

        // Buka Menu Titik Tiga
        function openMessageMenu(e, messageId) {
            e.stopPropagation();
            activeMenuMessageId = messageId;
            const menu = document.getElementById('messageContextMenu');
            if (!menu) return;

            menu.style.display = 'flex';
            
            // Posisikan menu di dekat tombol
            const rect = e.currentTarget.getBoundingClientRect();
            const panelRect = document.getElementById('chatPanel').getBoundingClientRect();

            let left = rect.left - panelRect.left - 110;
            let top = rect.bottom - panelRect.top + 4;

            if (left < 10) left = rect.left - panelRect.left;
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        }

        // Toggle Menu Titik Tiga di Header Chat
        function toggleChatHeaderMenu(e) {
            e.stopPropagation();
            const dropdown = document.getElementById('chatHeaderDropdown');
            if (!dropdown) return;
            const isShown = dropdown.style.display === 'flex';
            dropdown.style.display = isShown ? 'none' : 'flex';
        }

        function onHeaderSelectClicked() {
            const dropdown = document.getElementById('chatHeaderDropdown');
            if (dropdown) dropdown.style.display = 'none';
            startSelectMode();
        }

        function onHeaderClearChatClicked() {
            const dropdown = document.getElementById('chatHeaderDropdown');
            if (dropdown) dropdown.style.display = 'none';
            confirmClearChat();
        }

        // Tutup Context Menu saat klik di luar
        window.addEventListener('click', () => {
            const menu = document.getElementById('messageContextMenu');
            if (menu) menu.style.display = 'none';
            const headerDropdown = document.getElementById('chatHeaderDropdown');
            if (headerDropdown) headerDropdown.style.display = 'none';
            closeAllUserCardMenus();
            closeAvatarDropdown();
        });

        // Handler Menu: Select Pesan
        function onMenuSelectClicked() {
            const menu = document.getElementById('messageContextMenu');
            if (menu) menu.style.display = 'none';

            if (!activeMenuMessageId) return;
            startSelectMode(activeMenuMessageId);
        }

        // Handler Menu: Hapus Pesan (SweetAlert)
        function onMenuDeleteClicked() {
            const menu = document.getElementById('messageContextMenu');
            if (menu) menu.style.display = 'none';

            if (!activeMenuMessageId) return;
            promptDeleteSingleMessage(activeMenuMessageId);
        }

        // Konfirmasi Hapus Satu Pesan dengan SweetAlert2
        function promptDeleteSingleMessage(messageId) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Hapus Pesan?',
                    text: 'Pesan ini hanya akan terhapus dari tampilan obrolan Anda.',
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-trash-can" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: 'Hapus Pesan',
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        executeDeleteSingle(messageId);
                    }
                });
            } else {
                if (confirm('Hapus pesan ini dari tampilan Anda?')) {
                    executeDeleteSingle(messageId);
                }
            }
        }

        async function executeDeleteSingle(messageId) {
            // Optimistic update
            currentChatMessages = currentChatMessages.filter(m => m.id !== messageId);
            renderMessages(currentChatMessages);

            try {
                const res = await fetch(`/api/blip/messages/${messageId}`, {
                    method: 'DELETE',
                    headers: getHeaders()
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast('Pesan berhasil dihapus.', 'info');
                } else {
                    showToast(data.message || 'Gagal menghapus pesan.', 'error');
                    pollActiveChat();
                }
            } catch (e) {
                showToast('Koneksi bermasalah saat menghapus pesan.', 'error');
                pollActiveChat();
            }
        }

        // Aktifkan Mode Select Pesan
        function startSelectMode(initialMessageId = null) {
            isSelectionMode = true;
            selectedMessageIds.clear();
            if (initialMessageId) {
                selectedMessageIds.add(initialMessageId);
            }

            document.getElementById('chatMessages').classList.add('selecting-mode');
            
            // Sembunyikan bagian untuk menulis pesan
            const inputBar = document.getElementById('chatInputBar');
            if (inputBar) inputBar.style.display = 'none';

            // Ganti Header Biasa dengan WhatsApp Style Selection Header
            const regularHeader = document.getElementById('chatRegularHeader');
            const selectionHeader = document.getElementById('chatSelectionHeader');
            if (regularHeader) regularHeader.style.display = 'none';
            if (selectionHeader) selectionHeader.style.display = 'flex';

            updateSelectionUI();
            renderMessages(currentChatMessages, true);
        }

        // Batalkan Mode Select Pesan
        function cancelSelectMode() {
            isSelectionMode = false;
            selectedMessageIds.clear();

            document.getElementById('chatMessages').classList.remove('selecting-mode');

            // Tampilkan kembali bagian untuk menulis pesan
            const inputBar = document.getElementById('chatInputBar');
            if (inputBar) inputBar.style.display = 'flex';

            // Kembalikan Header Biasa
            const regularHeader = document.getElementById('chatRegularHeader');
            const selectionHeader = document.getElementById('chatSelectionHeader');
            if (selectionHeader) selectionHeader.style.display = 'none';
            if (regularHeader) regularHeader.style.display = 'flex';

            renderMessages(currentChatMessages, true);
        }

        // Toggle centang pesan
        function toggleSelectMessage(e, messageId) {
            if (e) e.stopPropagation();
            const isCurrentlySelected = selectedMessageIds.has(messageId);
            if (isCurrentlySelected) {
                selectedMessageIds.delete(messageId);
            } else {
                selectedMessageIds.add(messageId);
            }

            const isNowSelected = selectedMessageIds.has(messageId);

            // Update DOM baris pesan secara langsung dan instan
            const row = document.getElementById(`msgRow_${messageId}`);
            if (row) {
                row.classList.toggle('selected', isNowSelected);
                const checkbox = row.querySelector('.message-select-checkbox');
                if (checkbox) {
                    checkbox.checked = isNowSelected;
                }
            }

            updateSelectionUI();
        }

        function onBubbleClicked(messageId) {
            if (!isSelectionMode) return;
            toggleSelectMessage(null, messageId);
        }

        function updateSelectionUI() {
            const count = selectedMessageIds.size;
            const textEl = document.getElementById('selectedCountText');
            if (textEl) {
                textEl.innerText = `${count} terpilih`;
            }
            const btnDelete = document.getElementById('btnDeleteSelected');
            if (btnDelete) {
                btnDelete.disabled = count === 0;
                btnDelete.style.opacity = count === 0 ? '0.35' : '1';
                btnDelete.style.pointerEvents = count === 0 ? 'none' : 'auto';
            }
        }

        // Konfirmasi Hapus Banyak Pesan Terpilih dengan SweetAlert2
        function confirmDeleteSelected() {
            const count = selectedMessageIds.size;
            if (count === 0) return;

            const ids = Array.from(selectedMessageIds);

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: `Hapus ${count} Pesan?`,
                    text: 'Pesan yang dipilih hanya akan terhapus dari tampilan Anda.',
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-trash-can" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: `Hapus (${count})`,
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        executeBulkDelete(ids);
                    }
                });
            } else {
                if (confirm(`Hapus ${count} pesan terpilih dari tampilan Anda?`)) {
                    executeBulkDelete(ids);
                }
            }
        }

        async function executeBulkDelete(ids) {
            // Optimistic update
            currentChatMessages = currentChatMessages.filter(m => !ids.includes(m.id));
            cancelSelectMode();

            try {
                const res = await fetch('/api/blip/messages/bulk-delete', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ message_ids: ids })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast(`${ids.length} pesan berhasil dihapus.`, 'info');
                } else {
                    showToast(data.message || 'Gagal menghapus pesan.', 'error');
                    pollActiveChat();
                }
            } catch (e) {
                showToast('Koneksi bermasalah saat menghapus pesan.', 'error');
                pollActiveChat();
            }
        }

        // Bersihkan Seluruh Obrolan / Clear Chat dengan SweetAlert2
        function confirmClearChat() {
            if (!activeChatFriendId) return;

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Bersihkan Riwayat Chat?',
                    text: 'Seluruh riwayat obrolan dengan teman ini akan terhapus dari tampilan Anda.',
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-trash-can" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: 'Bersihkan Obrolan',
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        executeClearChat();
                    }
                });
            } else {
                if (confirm('Yakin ingin membersihkan seluruh riwayat chat dengan teman ini? Pesan hanya akan terhapus dari tampilan Anda.')) {
                    executeClearChat();
                }
            }
        }

        async function executeClearChat() {
            // Optimistic clear
            currentChatMessages = [];
            renderMessages(currentChatMessages);

            try {
                const res = await fetch(`/api/blip/messages/clear/${activeChatFriendId}`, {
                    method: 'DELETE',
                    headers: getHeaders()
                });
                const data = await res.json();
                if (data.status === 'success') {
                    showToast('Riwayat obrolan telah dibersihkan.', 'success');
                } else {
                    showToast(data.message || 'Gagal membersihkan obrolan.', 'error');
                    pollActiveChat();
                }
            } catch (e) {
                showToast('Koneksi bermasalah.', 'error');
                pollActiveChat();
            }
        }

        async function pollActiveChat() {
            if (!activeChatFriendId) return;
            try {
                const res = await fetch(`/api/blip/messages/${activeChatFriendId}`, { headers: getHeaders() });
                const data = await res.json();
                if (data.status === 'success') {
                    renderMessages(data.messages);
                }
            } catch (e) {}
        }

        // Telegram Desktop Style Emoji Picker Popover Handler (emoji-picker-element)
        let isEmojiPickerBound = false;

        function toggleEmojiPicker(e) {
            if (e) e.stopPropagation();
            const picker = document.getElementById('tgEmojiPicker');
            const toggleBtn = document.getElementById('tgEmojiToggleBtn');
            const pickerEl = document.getElementById('blipEmojiPickerElement');
            if (!picker) return;

            const isShown = picker.style.display !== 'none';
            if (isShown) {
                closeEmojiPicker();
            } else {
                picker.style.display = 'flex';
                if (toggleBtn) toggleBtn.classList.add('active');

                if (pickerEl) {
                    pickerEl.classList.remove('dark');
                    pickerEl.classList.add('light');

                    if (!isEmojiPickerBound) {
                        pickerEl.addEventListener('emoji-click', event => {
                            if (event.detail && event.detail.unicode) {
                                insertEmoji(event.detail.unicode);
                            }
                        });
                        isEmojiPickerBound = true;
                    }
                }
            }
        }

        function closeEmojiPicker() {
            const picker = document.getElementById('tgEmojiPicker');
            const toggleBtn = document.getElementById('tgEmojiToggleBtn');
            if (picker) picker.style.display = 'none';
            if (toggleBtn) toggleBtn.classList.remove('active');
        }

        function insertEmoji(emoji) {
            const input = document.getElementById('chatInputMessage');
            if (!input) return;
            const start = input.selectionStart || input.value.length;
            const end = input.selectionEnd || input.value.length;
            const text = input.value;
            input.value = text.substring(0, start) + emoji + text.substring(end);
            input.selectionStart = input.selectionEnd = start + emoji.length;
            input.focus();
        }

        // Close emoji picker saat klik di luar popover
        document.addEventListener('click', (e) => {
            const picker = document.getElementById('tgEmojiPicker');
            const toggleBtn = document.getElementById('tgEmojiToggleBtn');
            if (picker && picker.style.display !== 'none') {
                if (!picker.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
                    closeEmojiPicker();
                }
            }
        });

        async function handleSendMessage(e) {
            e.preventDefault();
            const input = document.getElementById('chatInputMessage');
            const msg = input.value.trim();
            if (!msg || !activeChatFriendId) return;

            input.value = '';

            // Tampilkan pesan langsung secara optimistik dengan status 'pending' (icon jam)
            const tempId = 'temp_' + Date.now();
            const now = new Date();
            const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            
            const pendingMsg = {
                id: tempId,
                is_me: true,
                message: msg,
                time: timeStr,
                status: 'pending',
                is_read: false
            };

            currentChatMessages.push(pendingMsg);
            renderMessages(currentChatMessages, true);

            try {
                const res = await fetch(`/api/blip/messages/${activeChatFriendId}`, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ message: msg })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    // Berhasil dikirim ke server -> update ke status 'sent' (icon centang)
                    pollActiveChat();
                } else {
                    showToast(data.message || 'Gagal mengirim pesan.', 'error');
                    // Hapus pesan pending jika gagal
                    currentChatMessages = currentChatMessages.filter(m => m.id !== tempId);
                    renderMessages(currentChatMessages);
                }
            } catch (err) {
                showToast('Gagal kirim pesan.', 'error');
                currentChatMessages = currentChatMessages.filter(m => m.id !== tempId);
                renderMessages(currentChatMessages);
            }
        }

        // ==========================================
        // FITUR P2P PHOTO TRANSFER (0 BYTE STORAGE SERVER)
        // ==========================================

        // 1. Lightbox Preview Modal
        function openImageLightbox(src) {
            const modal = document.getElementById('imageLightboxModal');
            const img = document.getElementById('imageLightboxImg');
            if (!modal || !img) return;
            img.src = src;
            modal.style.display = 'flex';
        }

        function closeImageLightbox() {
            const modal = document.getElementById('imageLightboxModal');
            if (modal) modal.style.display = 'none';
        }

        // Trigger dialog pemilih foto saat klik paperclip
        function triggerPhotoUpload() {
            if (!activeChatFriendId) {
                showToast('Pilih teman obrolan terlebih dahulu!', 'warning');
                return;
            }
            const fileInput = document.getElementById('chatPhotoFileInput');
            if (fileInput) fileInput.click();
        }

        // Upload foto ke server -> Controller kompresi ke ~100KB -> Expire 1 jam
        async function handlePhotoSelected(event) {
            const file = event.target.files && event.target.files[0];
            if (!file || !activeChatFriendId) return;

            // Reset input agar dapat memilih foto yang sama
            event.target.value = '';

            // Validasi tipe file
            if (!file.type.match(/^image\//i)) {
                showToast('Hanya file foto/gambar yang diperbolehkan!', 'error');
                return;
            }

            // Tampilkan bubble foto secara optimistik
            const tempId = 'temp_photo_' + Date.now();
            const now = new Date();
            const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            const localPreviewUrl = URL.createObjectURL(file);

            const pendingPhotoMsg = {
                id: tempId,
                is_me: true,
                type: 'image',
                message: '',
                photo_url: localPreviewUrl,
                photo_size: file.size,
                is_saved: false,
                is_expired: false,
                expires_at: new Date(Date.now() + 3600000).toISOString(),
                time: timeStr,
                status: 'pending',
                is_read: false
            };

            currentChatMessages.push(pendingPhotoMsg);
            renderMessages(currentChatMessages, true);

            const formData = new FormData();
            formData.append('photo', file);

            try {
                const res = await fetch(`/api/blip/messages/${activeChatFriendId}/photo`, {
                    method: 'POST',
                    headers: {
                        'X-Blip-Token': getStoredToken(),
                        'X-Session-Token': getStoredToken(),
                        'Accept': 'application/json'
                    },
                    body: formData
                });

                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    // Update pesan pending dengan data riil terkompresi dari server
                    const idx = currentChatMessages.findIndex(m => m.id === tempId);
                    if (idx !== -1) {
                        currentChatMessages[idx] = {
                            ...data.message,
                            is_me: true,
                            status: 'sent'
                        };
                    }
                    renderMessages(currentChatMessages);
                    showToast('Foto berhasil dikirim & terkompresi (~100KB)!', 'success');
                } else {
                    const errorMsg = data.message || (data.errors ? Object.values(data.errors).flat().join(', ') : 'Gagal mengunggah foto.');
                    showToast(errorMsg, 'error');
                    currentChatMessages = currentChatMessages.filter(m => m.id !== tempId);
                    renderMessages(currentChatMessages);
                }
            } catch (err) {
                console.error('[Upload Photo] Error:', err);
                showToast('Gagal mengirim foto ke server.', 'error');
                currentChatMessages = currentChatMessages.filter(m => m.id !== tempId);
                renderMessages(currentChatMessages);
            }
        }

        // Simpan foto oleh penerima (mencegah foto hilang setelah 1 jam)
        async function saveReceivedPhoto(e, messageId) {
            e.stopPropagation();
            try {
                const res = await fetch(`/api/blip/messages/${messageId}/save-photo`, {
                    method: 'POST',
                    headers: getHeaders()
                });
                const data = await res.json();
                if (data.status === 'success') {
                    // Tandai pesan sebagai tersimpan di memory
                    const msg = currentChatMessages.find(m => m.id === messageId);
                    if (msg) {
                        msg.is_saved = true;
                        msg.expires_at = null;
                    }
                    renderMessages(currentChatMessages);
                    showToast('Foto disimpan permanen!', 'success');
                } else {
                    showToast(data.message || 'Gagal menyimpan foto.', 'error');
                }
            } catch (err) {
                showToast('Gagal menyimpan foto.', 'error');
            }
        }

        // Profile View (Twitter / X Style Inline di Sidebar)
        let activeProfileSubTab = 'knots';
        let userProfileKnots = [];

        function switchProfileSubTab(tab) {
            activeProfileSubTab = tab;
            const knotsTabBtn = document.getElementById('profileTabKnotsBtn');
            const editTabBtn = document.getElementById('profileTabEditBtn');
            const knotsContent = document.getElementById('profileKnotsTabContent');
            const editContent = document.getElementById('profileEditTabContent');
            const editActionBtn = document.getElementById('btnToggleEditProfile');

            if (tab === 'knots') {
                if (knotsTabBtn) knotsTabBtn.classList.add('active');
                if (editTabBtn) editTabBtn.classList.remove('active');
                if (knotsContent) knotsContent.style.display = 'flex';
                if (editContent) editContent.style.display = 'none';
                if (editActionBtn) editActionBtn.innerHTML = '<i class="fa-solid fa-pen"></i> <span>Edit Profil</span>';
            } else {
                if (knotsTabBtn) knotsTabBtn.classList.remove('active');
                if (editTabBtn) editTabBtn.classList.add('active');
                if (knotsContent) knotsContent.style.display = 'none';
                if (editContent) editContent.style.display = 'flex';
                if (editActionBtn) editActionBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> <span>Lihat Profil</span>';
            }
        }

        function toggleEditProfileSection() {
            if (activeProfileSubTab === 'knots') {
                switchProfileSubTab('edit');
            } else {
                switchProfileSubTab('knots');
            }
        }

        async function openProfileModal() {
            if (!currentUser) return;
            const inputName = document.getElementById('inputProfileName');
            if (inputName) inputName.value = currentUser.name || '';

            const inputUsername = document.getElementById('inputProfileUsername');
            if (inputUsername) inputUsername.value = currentUser.username || '';
            updateProfilePreviewUsername(currentUser.username || '');

            const inputBio = document.getElementById('inputProfileBio');
            if (inputBio) {
                inputBio.value = currentUser.bio || '';
                updateProfileBioCounter(inputBio.value);
            }
            
            // Format tanggal lahir yyyy-MM-dd jika ada
            let birthdateVal = '';
            if (currentUser.birthdate) {
                birthdateVal = currentUser.birthdate.split('T')[0];
            }
            const inputBirthdate = document.getElementById('inputProfileBirthdate');
            if (inputBirthdate) inputBirthdate.value = birthdateVal;
            onBirthdateChange();

            selectedColor = currentUser.avatar_color;
            selectedGender = currentUser.gender || null;
            updateGenderUI();
            updateProfileAvatarPreview();

            // Default ke tab knots
            switchProfileSubTab('knots');
            switchTab('profile');

            // Ambil knots milik user sendiri
            loadMyProfileKnots();
        }

        async function loadMyProfileKnots() {
            if (!currentUser) return;
            const container = document.getElementById('profileKnotsList');
            const knotCountBadge = document.getElementById('profileHeaderKnotCount');
            if (!container) return;

            container.innerHTML = `
                <div style="padding: 2rem 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
                    <i class="fa-solid fa-spinner fa-spin" style="margin-right: 6px;"></i> Memuat knot Anda...
                </div>
            `;

            try {
                let url = `/api/blip/users/${currentUser.id}/threads`;
                if (currentUser.latitude && currentUser.longitude) {
                    url += `?latitude=${currentUser.latitude}&longitude=${currentUser.longitude}`;
                }
                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();

                if (data.status === 'success' && data.threads) {
                    userProfileKnots = data.threads;
                    if (knotCountBadge) {
                        knotCountBadge.innerText = `${userProfileKnots.length} Knot`;
                    }
                    renderUserProfileKnots(userProfileKnots, container);
                } else {
                    container.innerHTML = `<div class="profile-empty-knots"><i class="fa-regular fa-comment-dots"></i><p>Belum ada Knot yang diposting.</p></div>`;
                }
            } catch (err) {
                console.error('loadMyProfileKnots error:', err);
                container.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">Gagal memuat Knot.</div>`;
            }
        }

        function renderUserProfileKnots(threads, container) {
            if (!threads || threads.length === 0) {
                container.innerHTML = `
                    <div class="profile-empty-knots">
                        <i class="fa-regular fa-paper-plane"></i>
                        <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">Belum ada Knot</span>
                        <p style="font-size: 0.82rem; margin: 0; line-height: 1.4;">Ketika Anda memposting Knot, postingan tersebut akan muncul di sini.</p>
                        <button type="button" class="btn btn-primary btn-pill btn-sm" style="margin-top: 0.65rem;" onclick="openCreateThreadModal()">
                            <i class="fa-solid fa-plus"></i> Buat Knot Baru
                        </button>
                    </div>
                `;
                return;
            }

            container.innerHTML = threads.map(t => renderKnotCardHtml(t)).join('');
        }

        function updateProfileBioCounter(val) {
            const counter = document.getElementById('profileBioCounter');
            if (counter) {
                counter.innerText = `${(val || '').length}/160`;
            }
        }

        function closeProfileModal() {
            // Kembali ke tab sebelumnya (nearby / contacts / friends)
            const targetTab = (previousTab && previousTab !== 'profile') ? previousTab : 'nearby';
            switchTab(targetTab);
        }

        let profileUsernameAvailable = true;
        let profileUsernameDebounce = null;

        function onProfileNameChange(val) {
            updateProfilePreviewName(val);
            const errEl = document.getElementById('profileNameErrorStatus');
            const clean = (val || '').trim();
            if (!clean) {
                if (errEl) {
                    errEl.style.display = 'block';
                    errEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Nama tidak boleh kosong.</span>';
                }
            } else if (clean.length > 50) {
                if (errEl) {
                    errEl.style.display = 'block';
                    errEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Nama maksimal 50 karakter.</span>';
                }
            } else {
                if (errEl) {
                    errEl.style.display = 'none';
                    errEl.innerHTML = '';
                }
            }
        }

        function onProfileUsernameChange(val) {
            updateProfilePreviewUsername(val);
            clearTimeout(profileUsernameDebounce);
            const statusEl = document.getElementById('profileUsernameStatus');
            const clean = (val || '').trim().replace(/^@/, '').toLowerCase();

            // Jika username sama persis dengan username akun sendiri saat ini
            if (currentUser && currentUser.username && currentUser.username.toLowerCase() === clean) {
                profileUsernameAvailable = true;
                if (statusEl) statusEl.innerHTML = '';
                return;
            }

            if (!clean) {
                profileUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Username tidak boleh kosong.</span>';
                }
                return;
            }

            if (clean.length < 3) {
                profileUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Minimal 3 karakter.</span>';
                }
                return;
            }

            if (clean.length > 25) {
                profileUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Maksimal 25 karakter.</span>';
                }
                return;
            }

            if (!/^[a-zA-Z0-9_]+$/.test(clean)) {
                profileUsernameAvailable = false;
                if (statusEl) {
                    statusEl.innerHTML = '<span style="color: #ef4444;"><i class="fa-solid fa-circle-exclamation"></i> Hanya boleh huruf, angka, dan underscore (_).</span>';
                }
                return;
            }

            if (statusEl) {
                statusEl.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Memeriksa ketersediaan...</span>';
            }

            profileUsernameDebounce = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/blip/check-username?username=${encodeURIComponent(clean)}`, {
                        headers: getHeaders()
                    });
                    const data = await res.json();
                    if (data.available) {
                        profileUsernameAvailable = true;
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: #10b981; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> @${clean} tersedia!</span>`;
                        }
                    } else {
                        profileUsernameAvailable = false;
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(data.message || 'Username sudah dipakai.')}</span>`;
                        }
                    }
                } catch (e) {
                    if (statusEl) statusEl.innerHTML = '';
                }
            }, 300);
        }

        function updateProfilePreviewName(val) {
            const previewName = document.getElementById('profileNamePreview');
            const headerTitleName = document.getElementById('profileHeaderTitleName');
            const previewAv = document.getElementById('profileAvatarPreview');
            const name = (val || '').trim() || 'Akun Saya';
            if (previewName) previewName.innerText = name;
            if (headerTitleName) headerTitleName.innerText = name;
            // Hanya update inisial huruf jika user tidak menggunakan foto profil
            if (previewAv && (!currentUser || !currentUser.avatar_url)) {
                previewAv.innerText = name.charAt(0).toUpperCase();
            }
        }

        function updateProfilePreviewUsername(val) {
            const preview = document.getElementById('profileUsernamePreview');
            const clean = (val || '').trim().replace(/^@/, '');
            if (preview) {
                preview.innerText = clean ? `@${clean}` : '';
            }
        }

        function toggleAvatarDropdown(e) {
            if (e) e.stopPropagation();
            const dropdown = document.getElementById('avatarOptionsMenuDropdown');
            const deleteBtn = document.getElementById('avatarDropdownDeleteBtn');
            if (!dropdown) return;

            if (dropdown.style.display === 'flex') {
                dropdown.style.display = 'none';
            } else {
                // Tampilkan opsi hapus hanya jika pengguna punya foto profil
                const hasPhoto = !!(currentUser && currentUser.avatar_url);
                if (deleteBtn) {
                    deleteBtn.style.display = hasPhoto ? 'flex' : 'none';
                }
                dropdown.style.display = 'flex';
            }
        }

        function closeAvatarDropdown() {
            const dropdown = document.getElementById('avatarOptionsMenuDropdown');
            if (dropdown) dropdown.style.display = 'none';
        }

        function onAvatarDropdownUploadClick() {
            closeAvatarDropdown();
            const fileInput = document.getElementById('inputAvatarFile');
            if (fileInput) fileInput.click();
        }

        function onAvatarDropdownDeleteClick() {
            closeAvatarDropdown();
            confirmRemoveAvatar();
        }

        let cropperInstance = null;

        function updateProfileAvatarPreview() {
            const previewAv = document.getElementById('profileAvatarPreview');
            const editPreviewAv = document.getElementById('profileEditAvatarPreview');
            const previewName = document.getElementById('profileNamePreview');
            const headerTitleName = document.getElementById('profileHeaderTitleName');
            const bioDisplay = document.getElementById('profileBioDisplay');
            const deleteBadge = document.getElementById('btnDeleteAvatarBadge');
            const metaGender = document.getElementById('profileMetaGender');
            const metaGenderWrap = document.getElementById('profileMetaGenderWrap');
            const metaAge = document.getElementById('profileMetaAge');
            const metaAgeWrap = document.getElementById('profileMetaAgeWrap');
            const metaJoined = document.getElementById('profileMetaJoined');

            if (currentUser) {
                const applyAvatarStyle = (el) => {
                    if (!el) return;
                    if (currentUser.avatar_url) {
                        el.innerText = '';
                        el.style.backgroundImage = `url('${escapeHtml(currentUser.avatar_url)}')`;
                        el.style.backgroundSize = 'cover';
                        el.style.backgroundPosition = 'center';
                        el.style.backgroundColor = 'transparent';
                        el.style.cursor = 'pointer';
                        el.title = 'Klik untuk melihat foto lebih besar';
                        el.onclick = () => openImageLightbox(currentUser.avatar_url);
                    } else {
                        el.innerText = (currentUser.name || 'B').charAt(0).toUpperCase();
                        el.style.backgroundImage = 'none';
                        el.style.backgroundColor = selectedColor || currentUser.avatar_color;
                        el.style.cursor = 'default';
                        el.title = '';
                        el.onclick = null;
                    }
                };

                applyAvatarStyle(previewAv);
                applyAvatarStyle(editPreviewAv);
                if (previewName) {
                    previewName.innerText = currentUser.name || 'Akun Saya';
                }
                if (headerTitleName) {
                    headerTitleName.innerText = currentUser.name || 'Profil';
                }
                if (bioDisplay) {
                    bioDisplay.innerText = currentUser.bio || 'Belum ada bio';
                    bioDisplay.style.color = currentUser.bio ? 'var(--text-main)' : 'var(--text-muted)';
                }
                const previewUsername = document.getElementById('profileUsernamePreview');
                if (previewUsername) {
                    previewUsername.innerText = currentUser.username ? `@${currentUser.username}` : '';
                }
                if (deleteBadge) {
                    deleteBadge.style.display = currentUser.avatar_url ? 'inline-flex' : 'none';
                }

                // Gender meta
                if (metaGender && metaGenderWrap) {
                    if (currentUser.gender) {
                        metaGender.innerText = currentUser.gender === 'male' ? 'Pria' : 'Wanita';
                        metaGenderWrap.style.display = 'inline-flex';
                    } else {
                        metaGenderWrap.style.display = 'none';
                    }
                }

                // Age meta
                if (metaAge && metaAgeWrap) {
                    if (currentUser.age || currentUser.calculated_age) {
                        metaAge.innerText = `${currentUser.age || currentUser.calculated_age} tahun`;
                        metaAgeWrap.style.display = 'inline-flex';
                    } else {
                        metaAgeWrap.style.display = 'none';
                    }
                }

                // Joined meta
                if (metaJoined) {
                    if (currentUser.created_at) {
                        try {
                            const d = new Date(currentUser.created_at);
                            const monthYear = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                            metaJoined.innerText = `Bergabung ${monthYear}`;
                        } catch (e) {
                            metaJoined.innerText = 'Bergabung baru-baru ini';
                        }
                    } else {
                        metaJoined.innerText = 'Bergabung baru-baru ini';
                    }
                }
            }
        }

        // Ketika user memilih file gambar dari file picker
        function onAvatarFileSelected(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                showToast('Pilih file gambar yang valid (JPG, PNG, WebP).', 'error');
                event.target.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                const cropModal = document.getElementById('avatarCropModal');
                const cropImg = document.getElementById('avatarCropImage');
                if (!cropModal || !cropImg) return;

                cropImg.src = e.target.result;
                cropModal.style.display = 'flex';

                if (cropperInstance) {
                    cropperInstance.destroy();
                }

                // Inisialisasi Cropper.js dengan aspect ratio 1:1 (persegi/lingkaran)
                cropperInstance = new Cropper(cropImg, {
                    aspectRatio: 1,
                    viewMode: 1,
                    dragMode: 'move',
                    autoCropArea: 0.9,
                    restore: false,
                    guides: true,
                    center: true,
                    highlight: false,
                    cropBoxMovable: true,
                    cropBoxResizable: true,
                    toggleDragModeOnDblclick: false
                });
            };
            reader.readAsDataURL(file);
            event.target.value = '';
        }

        function closeAvatarCropModal() {
            const cropModal = document.getElementById('avatarCropModal');
            if (cropModal) cropModal.style.display = 'none';
            if (cropperInstance) {
                cropperInstance.destroy();
                cropperInstance = null;
            }
        }

        // Accept & Upload Foto yang sudah di-crop (dengan kompresi kanvas ke ~100KB)
        async function acceptAvatarCrop() {
            if (!cropperInstance) return;

            const acceptBtn = document.getElementById('btnAcceptCrop');
            const originalBtnHtml = acceptBtn ? acceptBtn.innerHTML : '';
            if (acceptBtn) {
                acceptBtn.disabled = true;
                acceptBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
            }

            // Dapatkan canvas hasil crop (resolusi 512x512)
            const canvas = cropperInstance.getCroppedCanvas({
                width: 512,
                height: 512,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high'
            });

            // Convert canvas ke Blob JPEG dengan kompresi kualitas 0.8
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    showToast('Gagal memproses gambar.', 'error');
                    if (acceptBtn) {
                        acceptBtn.disabled = false;
                        acceptBtn.innerHTML = originalBtnHtml;
                    }
                    return;
                }

                const formData = new FormData();
                formData.append('avatar', blob, 'avatar.jpg');

                try {
                    const res = await fetch('/api/blip/profile/avatar', {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'X-Blip-Token': getStoredToken() || ''
                        },
                        body: formData
                    });

                    const data = await res.json();
                    if (data.status === 'success') {
                        currentUser = data.user;
                        updateUserUI();
                        closeAvatarCropModal();
                        showToast('Foto profil berhasil diubah!', 'success');
                        
                        // Perbarui radar sekitar dan friends agar foto langsung tampak
                        if (currentTab === 'nearby') loadNearbyUsers(false);
                        else loadFriends();
                    } else {
                        showToast(data.message || 'Gagal mengunggah foto profil.', 'error');
                    }
                } catch (err) {
                    console.error(err);
                    showToast('Koneksi bermasalah saat upload foto.', 'error');
                } finally {
                    if (acceptBtn) {
                        acceptBtn.disabled = false;
                        acceptBtn.innerHTML = originalBtnHtml;
                    }
                }
            }, 'image/jpeg', 0.82);
        }

        // Konfirmasi Hapus Foto Profil dengan UX dialog SweetAlert2 yang elegan
        function confirmRemoveAvatar() {
            if (!currentUser || !currentUser.avatar_url) return;

            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Hapus Foto Profil?',
                    text: 'Foto profil akan dihapus dan avatar Anda akan kembali ke warna inisial.',
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-trash-can" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: 'Hapus Foto',
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        handleRemoveAvatar();
                    }
                });
            } else {
                if (confirm('Hapus foto profil dan kembalikan ke avatar inisial?')) {
                    handleRemoveAvatar();
                }
            }
        }

        // Hapus foto profil dan kembalikan ke inisial warna
        async function handleRemoveAvatar() {
            try {
                const res = await fetch('/api/blip/profile/avatar', {
                    method: 'DELETE',
                    headers: getHeaders()
                });
                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data.user;
                    updateUserUI();
                    showToast('Foto profil dihapus.', 'info');
                    if (currentTab === 'nearby') loadNearbyUsers(false);
                    else loadFriends();
                } else {
                    showToast(data.message || 'Gagal menghapus foto.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Koneksi bermasalah.', 'error');
            }
        }

        // Konfirmasi Hapus Akun Permanen dengan SweetAlert2
        function confirmDeleteAccount() {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Hapus Akun Permanen?',
                    text: 'Semua riwayat chat, pertemanan, dan foto profil Anda akan dihapus permanen dari server. Tindakan ini tidak dapat dibatalkan.',
                    icon: 'warning',
                    iconHtml: '<i class="fa-solid fa-triangle-exclamation" style="font-size: 1.4rem; color: #ef4444;"></i>',
                    showCancelButton: true,
                    confirmButtonText: 'Ya, Hapus Akun',
                    cancelButtonText: 'Batal',
                    reverseButtons: true,
                    buttonsStyling: false,
                    customClass: {
                        popup: 'blip-swal-popup',
                        title: 'blip-swal-title',
                        htmlContainer: 'blip-swal-html',
                        icon: 'blip-swal-icon danger',
                        confirmButton: 'blip-swal-confirm-btn danger',
                        cancelButton: 'blip-swal-cancel-btn',
                        actions: 'blip-swal-actions'
                    }
                }).then((result) => {
                    if (result.isConfirmed) {
                        handleDeleteAccount();
                    }
                });
            } else {
                if (confirm('Hapus akun Anda secara permanen? Semua riwayat obrolan dan pertemanan akan hilang.')) {
                    handleDeleteAccount();
                }
            }
        }

        // Eksekusi API Hapus Akun
        async function handleDeleteAccount() {
            try {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Menghapus Akun...',
                        text: 'Mohon tunggu sebentar, data akun Anda sedang dibersihkan.',
                        allowOutsideClick: false,
                        didOpen: () => {
                            Swal.showLoading();
                        }
                    });
                }

                const res = await fetch('/api/blip/account', {
                    method: 'DELETE',
                    headers: getHeaders()
                });

                const data = await res.json();
                if (data.status === 'success') {
                    // Bersihkan token dari localStorage
                    localStorage.removeItem('blip_session_token');

                    if (typeof Swal !== 'undefined') {
                        await Swal.fire({
                            title: 'Akun Berhasil Dihapus',
                            text: 'Akun Anda telah berhasil dibersihkan. Halaman akan dimuat ulang untuk sesi baru.',
                            icon: 'success',
                            iconHtml: '<i class="fa-solid fa-check" style="font-size: 1.4rem; color: #10b981;"></i>',
                            confirmButtonText: 'OK, Mengerti',
                            buttonsStyling: false,
                            customClass: {
                                popup: 'blip-swal-popup',
                                title: 'blip-swal-title',
                                htmlContainer: 'blip-swal-html',
                                icon: 'blip-swal-icon success',
                                confirmButton: 'blip-swal-confirm-btn primary',
                                actions: 'blip-swal-actions'
                            }
                        });
                    }
                    // Reload halaman untuk inisialisasi akun baru
                    window.location.reload();
                } else {
                    showToast(data.message || 'Gagal menghapus akun.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Koneksi bermasalah saat menghapus akun.', 'error');
            }
        }

        function selectAvatarColor(color, el) {
            selectedColor = color;
            document.querySelectorAll('.color-circle').forEach(c => c.classList.remove('selected'));
            if (el) el.classList.add('selected');
            const previewAv = document.getElementById('profileAvatarPreview');
            if (previewAv && (!currentUser || !currentUser.avatar_url)) {
                previewAv.style.backgroundColor = color;
            }
        }

        async function handleUpdateProfile(e) {
            e.preventDefault();
            const nameInput = document.getElementById('inputProfileName');
            const name = (nameInput ? nameInput.value : '').trim();
            const usernameInput = document.getElementById('inputProfileUsername');
            let username = usernameInput ? usernameInput.value.trim().replace(/^@/, '').toLowerCase() : '';
            let bio = (document.getElementById('inputProfileBio')?.value || '').trim();
            bio = bio.replace(/[\r\n]+/g, ' ').trim();
            const birthdateVal = document.getElementById('inputProfileBirthdate')?.value || '';

            if (!name) {
                showToast('Nama Anda wajib diisi.', 'error');
                if (nameInput) nameInput.focus();
                return;
            }

            if (!username) {
                showToast('Username wajib diisi.', 'error');
                if (usernameInput) usernameInput.focus();
                return;
            }

            if (username.length < 3 || username.length > 25) {
                showToast('Panjang username harus antara 3 - 25 karakter.', 'error');
                if (usernameInput) usernameInput.focus();
                return;
            }

            if (!/^[a-zA-Z0-9_]+$/.test(username)) {
                showToast('Username hanya boleh berupa huruf, angka, dan underscore (_).', 'error');
                if (usernameInput) usernameInput.focus();
                return;
            }

            if (!profileUsernameAvailable) {
                showToast(`Username @${username} sudah digunakan atau tidak valid.`, 'error');
                if (usernameInput) usernameInput.focus();
                return;
            }

            try {
                const res = await fetch('/api/blip/profile', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({
                        name,
                        username,
                        bio: bio || null,
                        avatar_color: selectedColor,
                        gender: selectedGender,
                        birthdate: birthdateVal || null
                    })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    currentUser = data.user;
                    updateUserUI();
                    showToast('Profil berhasil disimpan!', 'success');
                    switchProfileSubTab('knots');
                } else {
                    // Tampilkan pesan error validasi spesifik dari backend (misal: unique username)
                    const errMsg = data.message || (data.errors ? Object.values(data.errors).flat().join(' ') : 'Gagal update profil.');
                    showToast(errMsg, 'error');
                    const statusEl = document.getElementById('profileUsernameStatus');
                    if (statusEl && errMsg.toLowerCase().includes('username')) {
                        statusEl.innerHTML = `<span style="color: #ef4444; font-weight: 600;"><i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(errMsg)}</span>`;
                    }
                }
            } catch (err) {
                showToast('Gagal menyimpan profil, periksa koneksi Anda.', 'error');
            }
        }

        function startPolling() {
            // Sepenuhnya menggunakan Reverb WebSocket secara realtime (tanpa polling)
            if (radarPollInterval) {
                clearInterval(radarPollInterval);
                radarPollInterval = null;
            }
        }

        // Setup Infinite Scroll (Lazy Load) saat di-scroll ke bawah
        function setupScrollListeners() {
            const listEl = document.getElementById('listContent');
            if (!listEl) return;

            listEl.addEventListener('scroll', () => {
                // Lazy Load untuk Radar Sekitar
                if (currentTab === 'nearby') {
                    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 60) {
                        if (nearbyHasMore && !nearbyLoading) {
                            loadNearbyUsers(true);
                        }
                    }
                }
                // Lazy Load untuk Postingan Knot
                else if (currentTab === 'threads') {
                    if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 60) {
                        if (threadsHasMore && !threadsLoading) {
                            loadThreads(true);
                        }
                    }
                }
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Render teks thread / balasan dengan konversi @username menjadi mention tag yang bisa diklik
        function renderThreadContentWithMentions(content) {
            if (!content) return '';
            const safe = escapeHtml(content);
            // Regex mencari @username (karakter alfanumerik + garis bawah)
            return safe.replace(/@([a-zA-Z0-9_]{3,30})/g, (match, username) => {
                return `<span class="thread-mention-tag" onclick="event.stopPropagation(); openMentionUserProfile('${escapeHtml(username)}')" title="Lihat profil @${escapeHtml(username)}">@${escapeHtml(username)}</span>`;
            });
        }

        // Buka panel profil pengguna saat mention @username diklik
        async function openMentionUserProfile(username) {
            const clean = username.replace(/^@/, '').trim().toLowerCase();
            if (!clean) return;

            try {
                let url = `/api/blip/users/by-username/${clean}`;
                const params = new URLSearchParams();
                if (currentUser && currentUser.latitude) params.append('latitude', currentUser.latitude);
                if (currentUser && currentUser.longitude) params.append('longitude', currentUser.longitude);
                if (params.toString()) url += `?${params.toString()}`;

                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();

                if (data.status === 'success' && data.user) {
                    const u = data.user;
                    updateContactInfoPanel(
                        u.name,
                        u.avatar_color,
                        u.distance_formatted,
                        u.gender,
                        u.age,
                        u.bio,
                        u.is_friend,
                        u.id,
                        u.friendship_status,
                        u.friendship_initiator,
                        u.friendship_id,
                        u.avatar_url,
                        u.username
                    );
                    toggleContactInfoPanel(true);
                } else {
                    showToast(data.message || 'Pengguna tidak ditemukan.', 'warning');
                }
            } catch (err) {
                console.error('openMentionUserProfile error:', err);
                showToast('Gagal memuat profil pengguna.', 'error');
            }
        }

        // Inisialisasi Autocomplete Mention (@username) pada Input/Textarea
        function setupMentionAutocomplete(inputId, dropdownId) {
            const input = document.getElementById(inputId);
            const dropdown = document.getElementById(dropdownId);
            if (!input || !dropdown) return;

            let debounceTimer = null;
            let currentMentionQuery = null;
            let mentionStartIndex = -1;
            let selectedIndex = -1;
            let suggestionItems = [];

            // Hide dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            input.addEventListener('input', () => {
                const text = input.value;
                const cursorPos = input.selectionStart;
                
                // Cari apakah kursor tepat berada setelah simbol @
                const leftText = text.slice(0, cursorPos);
                const match = leftText.match(/(?:^|\s)@([a-zA-Z0-9_]*)$/);

                if (match) {
                    currentMentionQuery = match[1];
                    mentionStartIndex = leftText.lastIndexOf('@');
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => {
                        fetchMentionSuggestions(currentMentionQuery);
                    }, 180);
                } else {
                    dropdown.style.display = 'none';
                    currentMentionQuery = null;
                }
            });

            // Keyboard navigation (ArrowUp, ArrowDown, Enter, Tab, Escape)
            input.addEventListener('keydown', (e) => {
                if (dropdown.style.display === 'none' || suggestionItems.length === 0) return;

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedIndex = (selectedIndex + 1) % suggestionItems.length;
                    highlightSelectedMention();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIndex = (selectedIndex - 1 + suggestionItems.length) % suggestionItems.length;
                    highlightSelectedMention();
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                    if (selectedIndex >= 0 && selectedIndex < suggestionItems.length) {
                        e.preventDefault();
                        applyMention(suggestionItems[selectedIndex].username);
                    }
                } else if (e.key === 'Escape') {
                    dropdown.style.display = 'none';
                }
            });

            function highlightSelectedMention() {
                const items = dropdown.querySelectorAll('.mention-item');
                items.forEach((el, idx) => {
                    el.classList.toggle('selected', idx === selectedIndex);
                    if (idx === selectedIndex) {
                        el.scrollIntoView({ block: 'nearest' });
                    }
                });
            }

            async function fetchMentionSuggestions(q) {
                try {
                    let url = `/api/blip/users/mention-suggestions?q=${encodeURIComponent(q || '')}`;
                    const res = await fetch(url, { headers: getHeaders() });
                    const data = await res.json();

                    if (data.status === 'success' && data.users && data.users.length > 0) {
                        suggestionItems = data.users;
                        selectedIndex = 0;
                        renderDropdown(suggestionItems);
                    } else {
                        dropdown.style.display = 'none';
                        suggestionItems = [];
                    }
                } catch (e) {
                    dropdown.style.display = 'none';
                }
            }

            function renderDropdown(users) {
                dropdown.innerHTML = users.map((u, idx) => {
                    return `
                        <div class="mention-item ${idx === 0 ? 'selected' : ''}" data-username="${escapeHtml(u.username)}">
                            ${renderAvatarHtml(u.name || 'User', u.avatar_color, u.avatar_url, '', 'width: 32px; height: 32px; font-size: 0.85rem; flex-shrink: 0;')}
                            <div class="mention-item-info">
                                <span class="mention-item-name">${escapeHtml(u.name || 'User')}</span>
                                <span class="mention-item-handle">@${escapeHtml(u.username)}</span>
                            </div>
                            <span class="mention-item-dist">
                                <i class="fa-solid fa-location-arrow"></i> ${escapeHtml(u.distance_formatted)}
                            </span>
                        </div>
                    `;
                }).join('');

                dropdown.style.display = 'block';

                dropdown.querySelectorAll('.mention-item').forEach((item) => {
                    item.addEventListener('click', () => {
                        applyMention(item.getAttribute('data-username'));
                    });
                });
            }

            function applyMention(username) {
                if (mentionStartIndex < 0 || !username) return;

                const text = input.value;
                const cursorPos = input.selectionStart;
                const before = text.slice(0, mentionStartIndex);
                const after = text.slice(cursorPos);

                const replacement = `@${username} `;
                input.value = before + replacement + after;

                const newCursorPos = before.length + replacement.length;
                input.setSelectionRange(newCursorPos, newCursorPos);
                input.focus();

                dropdown.style.display = 'none';
                suggestionItems = [];
                selectedIndex = -1;

                if (inputId === 'createThreadInputContent') {
                    updateThreadCharCounter(input.value);
                }
            }
        }

        // ==========================================
        // THREADS SYSTEM (Public Posts & Discussions)
        // ==========================================
        let threadsList = [];
        let activeThreadId = null;
        let unreadThreadNotifsCount = 0;
        let cachedThreadNotifs = [];

        // Update badge notifikasi thread (di tab navigation & di header icon)
        function updateThreadNotificationBadge() {
            const navBadge = document.getElementById('unreadThreadsBadge');
            const headerBadge = document.getElementById('headerThreadNotifBadge');

            if (navBadge) {
                if (unreadThreadNotifsCount > 0) {
                    navBadge.innerText = unreadThreadNotifsCount > 99 ? '99+' : unreadThreadNotifsCount;
                    navBadge.style.display = 'inline-flex';
                } else {
                    navBadge.style.display = 'none';
                }
            }

            if (headerBadge) {
                if (unreadThreadNotifsCount > 0) {
                    headerBadge.innerText = unreadThreadNotifsCount > 99 ? '99+' : unreadThreadNotifsCount;
                    headerBadge.style.display = 'inline-flex';
                } else {
                    headerBadge.style.display = 'none';
                }
            }
        }

        // Ambil notifikasi thread dari backend
        async function fetchThreadNotifications() {
            try {
                const res = await fetch('/api/blip/threads/notifications', { headers: getHeaders() });
                const data = await res.json();
                if (data.status === 'success') {
                    unreadThreadNotifsCount = data.unread_count || 0;
                    cachedThreadNotifs = data.notifications || [];
                    updateThreadNotificationBadge();
                    renderThreadNotificationsList();
                }
            } catch (err) {
                console.error('fetchThreadNotifications error:', err);
            }
        }

        // Buka / Tutup dropdown notifikasi thread di header
        function toggleThreadNotificationsDropdown(e) {
            if (e) {
                if (typeof e.stopPropagation === 'function') e.stopPropagation();
                if (typeof e.preventDefault === 'function') e.preventDefault();
            }
            const dropdown = document.getElementById('threadNotifsDropdownMenu');
            if (!dropdown) return;

            const isCurrentlyOpen = dropdown.style.display === 'flex' || dropdown.style.display === 'block';
            if (isCurrentlyOpen) {
                dropdown.style.display = 'none';
            } else {
                dropdown.style.display = 'flex';
                fetchThreadNotifications();
            }
        }
        window.toggleThreadNotificationsDropdown = toggleThreadNotificationsDropdown;
        window.markAllThreadNotifsAsRead = markAllThreadNotifsAsRead;
        window.onThreadNotificationClick = onThreadNotificationClick;

        // Tutup dropdown notifikasi jika klik di luar
        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('threadNotifsDropdownMenu');
            const toggleBtn = document.getElementById('btnThreadNotifsToggle');
            if (dropdown && dropdown.style.display !== 'none') {
                if (!dropdown.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
                    dropdown.style.display = 'none';
                }
            }
        });

        // Render daftar notifikasi ke dropdown
        function renderThreadNotificationsList() {
            const container = document.getElementById('threadNotifsListContainer');
            if (!container) return;

            if (cachedThreadNotifs.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
                        <i class="fa-regular fa-bell-slash" style="font-size: 1.5rem; opacity: 0.4; margin-bottom: 0.4rem;"></i>
                        <p style="font-size: 0.82rem; margin: 0;">Belum ada notifikasi balasan atau tag.</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = cachedThreadNotifs.map(n => {
                const s = n.sender || {};
                const isReply = n.type === 'thread_reply';
                const isLike = n.type === 'thread_like';
                const likeCount = n.like_count || 1;

                let actionText = '';
                let iconClass = '';
                let iconColor = '';

                if (isLike) {
                    if (likeCount > 1) {
                        actionText = `dan ${likeCount - 1} orang lainnya menyukai knot Anda`;
                    } else {
                        actionText = 'menyukai knot Anda';
                    }
                    iconClass = 'fa-heart';
                    iconColor = '#ef4444';
                } else if (isReply) {
                    actionText = 'membalas knot Anda';
                    iconClass = 'fa-reply';
                    iconColor = 'var(--primary)';
                } else {
                    actionText = 'menyebut Anda dalam knot';
                    iconClass = 'fa-at';
                    iconColor = '#8b5cf6';
                }

                const notifIdsJson = JSON.stringify(n.ids || [n.id]);

                return `
                    <div class="thread-notif-item ${!n.is_read ? 'unread' : ''}" onclick='onThreadNotificationClick(${notifIdsJson}, ${n.thread_id})'>
                        ${renderAvatarHtml(s.name || 'User', s.avatar_color, s.avatar_url, '', 'width: 34px; height: 34px; font-size: 0.85rem; flex-shrink: 0;')}
                        <div class="thread-notif-content">
                            <div class="thread-notif-title">
                                <span>${escapeHtml(s.name || 'Pengguna')}</span>
                                <span style="font-weight: 500; color: var(--text-muted); font-size: 0.78rem;"> ${actionText}</span>
                            </div>
                            <div class="thread-notif-preview">
                                <i class="fa-solid ${iconClass}" style="color: ${iconColor}; font-size: 0.72rem; margin-right: 3px;"></i>
                                "${escapeHtml(n.preview_text || '')}"
                            </div>
                            <div class="thread-notif-time">${n.created_at_human}</div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Klik salah satu notifikasi -> tandai dibaca & buka thread
        async function onThreadNotificationClick(notificationIds, threadId) {
            const dropdown = document.getElementById('threadNotifsDropdownMenu');
            if (dropdown) dropdown.style.display = 'none';

            const idsArray = Array.isArray(notificationIds) ? notificationIds : [notificationIds];

            // Tandai notifikasi spesifik ini dibaca
            try {
                const res = await fetch('/api/blip/threads/notifications/read', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ notification_ids: idsArray }),
                });
                const data = await res.json();
                if (data.status === 'success' && data.unread_count !== undefined) {
                    unreadThreadNotifsCount = data.unread_count;
                } else {
                    unreadThreadNotifsCount = Math.max(0, unreadThreadNotifsCount - idsArray.length);
                }
                updateThreadNotificationBadge();

                // Update in memory cache
                cachedThreadNotifs.forEach(item => {
                    if (idsArray.includes(item.id)) {
                        item.is_read = true;
                    }
                });
            } catch (e) {}

            // Buka tab thread dan buka detail thread
            if (currentTab !== 'threads') {
                switchTab('threads');
            }
            openThreadView(threadId);
        }

        // Tandai semua notifikasi thread dibaca
        async function markAllThreadNotifsAsRead() {
            try {
                const res = await fetch('/api/blip/threads/notifications/read', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.status === 'success') {
                    unreadThreadNotifsCount = 0;
                    cachedThreadNotifs.forEach(n => n.is_read = true);
                    updateThreadNotificationBadge();
                    renderThreadNotificationsList();
                }
            } catch (e) {}
        }

        function updateThreadCharCounter(val) {
            const counter = document.getElementById('createThreadCharCounter');
            if (counter) {
                counter.innerText = `${(val || '').length}/1000`;
            }
        }

        function openCreateThreadModal() {
            const modal = document.getElementById('createThreadModal');
            const textarea = document.getElementById('createThreadInputContent');
            const locBadge = document.getElementById('createThreadLocationBadge');
            const avatarContainer = document.getElementById('createThreadUserAvatar');
            const usernameEl = document.getElementById('createThreadUsername');

            if (modal) modal.style.display = 'flex';
            if (textarea) {
                textarea.value = '';
                textarea.style.height = 'auto';
                setTimeout(() => textarea.focus(), 50);
            }
            updateThreadCharCounter('');

            if (currentUser) {
                if (avatarContainer) {
                    avatarContainer.innerHTML = renderAvatarHtml(
                        currentUser.name || 'User',
                        currentUser.avatar_color,
                        currentUser.avatar_url,
                        '',
                        'width: 40px; height: 40px; font-size: 1rem; border-radius: 50%;'
                    );
                }
                if (usernameEl) {
                    usernameEl.innerText = currentUser.username ? `@${currentUser.username}` : (currentUser.name || 'Anda');
                }
            }

            if (locBadge) {
                if (currentUser && currentUser.latitude && currentUser.longitude) {
                    locBadge.innerHTML = `<i class="fa-solid fa-location-arrow"></i> <span>Lokasi aktif</span>`;
                    locBadge.style.color = 'var(--primary)';
                } else {
                    locBadge.innerHTML = `<i class="fa-solid fa-location-arrow"></i> <span>Lokasi belum aktif</span>`;
                    locBadge.style.color = 'var(--text-muted)';
                }
            }
        }

        function closeCreateThreadModal() {
            const modal = document.getElementById('createThreadModal');
            if (modal) modal.style.display = 'none';
        }

        async function handleCreateThreadSubmit(e) {
            e.preventDefault();
            const textarea = document.getElementById('createThreadInputContent');
            const btn = document.getElementById('btnSubmitNewThread');
            const content = (textarea ? textarea.value : '').trim();
            if (!content) return;

            if (btn) btn.disabled = true;

            try {
                const res = await fetch('/api/blip/threads', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({
                        content: content,
                        latitude: (currentUser && currentUser.latitude) ? currentUser.latitude : null,
                        longitude: (currentUser && currentUser.longitude) ? currentUser.longitude : null,
                    }),
                });
                const data = await res.json();
                if (data.status === 'success' && data.thread) {
                    closeCreateThreadModal();
                    threadsList.unshift(data.thread);
                    filterAndRenderThreads();
                    openThreadView(data.thread.id);
                } else {
                    alert(data.message || 'Gagal memposting knot.');
                }
            } catch (err) {
                console.error(err);
                alert('Terjadi kesalahan koneksi saat memposting knot.');
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        let threadsNextCursor = null;
        let threadsHasMore = false;
        let threadsLoading = false;

        function renderKnotSkeletonHtml() {
            return `
                ${[1, 2, 3, 4].map(() => `
                    <div class="knot-skeleton-card">
                        <div class="knot-skeleton-shimmer knot-skeleton-avatar"></div>
                        <div class="knot-skeleton-body">
                            <div class="knot-skeleton-shimmer knot-skeleton-line-title"></div>
                            <div class="knot-skeleton-shimmer knot-skeleton-line-text1"></div>
                            <div class="knot-skeleton-shimmer knot-skeleton-line-text2"></div>
                        </div>
                    </div>
                `).join('')}
            `;
        }

        async function loadThreads(isAppend = false) {
            const container = document.getElementById('listContent');
            if (!container) return;

            if (threadsLoading) return;
            if (isAppend && !threadsHasMore) return;

            threadsLoading = true;

            if (isAppend) {
                const loader = document.getElementById('threadsInfiniteLoader');
                if (loader) loader.style.display = 'block';
            } else {
                threadsNextCursor = null;
                // Tampilkan Skeleton Shimmer Loading ala Twitter / Threads
                container.innerHTML = renderKnotSkeletonHtml();
            }

            try {
                let url = '/api/blip/threads';
                const params = new URLSearchParams();
                params.append('limit', 15);
                if (isAppend && threadsNextCursor) {
                    params.append('cursor', threadsNextCursor);
                }
                if (searchQuery) params.append('search', searchQuery);
                if (currentUser && currentUser.latitude) params.append('latitude', currentUser.latitude);
                if (currentUser && currentUser.longitude) params.append('longitude', currentUser.longitude);
                url += `?${params.toString()}`;

                const res = await fetch(url, { headers: getHeaders() });
                if (!res.ok) {
                    throw new Error(`HTTP error status ${res.status}`);
                }
                const data = await res.json();

                if (data.status === 'success') {
                    threadsNextCursor = data.next_cursor || null;
                    threadsHasMore = !!data.has_more;

                    if (isAppend) {
                        const existingIds = new Set(threadsList.map(t => t.id));
                        (data.threads || []).forEach(t => {
                            if (!existingIds.has(t.id)) threadsList.push(t);
                        });
                    } else {
                        threadsList = data.threads || [];
                    }
                    filterAndRenderThreads();
                } else {
                    throw new Error(data.message || 'Gagal memuat knot');
                }
            } catch (err) {
                console.error('loadThreads error:', err);
                if (!isAppend) {
                    container.innerHTML = `
                        <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
                            <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.8rem; color: #ef4444; margin-bottom: 0.75rem;"></i>
                            <p style="font-size: 0.88rem;">Gagal memuat knot.</p>
                            <button type="button" class="btn btn-outline btn-sm" onclick="loadThreads()" style="margin-top: 0.75rem;">Coba Lagi</button>
                        </div>
                    `;
                }
            } finally {
                threadsLoading = false;
                const loader = document.getElementById('threadsInfiniteLoader');
                if (loader) loader.style.display = 'none';
            }
        }

        function filterAndRenderThreads() {
            if (currentTab !== 'threads') return;
            const container = document.getElementById('listContent');
            if (!container) return;

            let list = threadsList;
            let html = '';

            // Section Hasil Pencarian Pengguna untuk di-Add Friend (muncul saat user melakukan pencarian)
            if (searchQuery) {
                if (isSearchingThreadUsers) {
                    html += `
                        <div style="padding: 0.5rem 0.75rem; margin-bottom: 0.5rem; background: var(--bg-main); border-radius: 12px; border: 1px dashed var(--border-color);">
                            <div style="font-size: 0.72rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.4rem; display: flex; align-items: center; gap: 0.35rem;">
                                <i class="fa-solid fa-spinner fa-spin"></i> Mencari pengguna...
                            </div>
                        </div>
                    `;
                } else if (threadSearchedUsers && threadSearchedUsers.length > 0) {
                    html += `
                        <div style="padding: 0.6rem 0.75rem 0.35rem; margin-bottom: 0.75rem; background: var(--bg-main); border-radius: 12px; border: 1px solid var(--border-subtle);">
                            <div style="font-size: 0.72rem; font-weight: 700; color: var(--primary); text-transform: uppercase; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
                                <span><i class="fa-solid fa-user-plus"></i> Tambah Teman (${threadSearchedUsers.length})</span>
                                <span style="font-size: 0.68rem; color: var(--text-muted); text-transform: none; font-weight: 500;">Klik untuk lihat profil</span>
                            </div>
                            <div class="knot-search-users-container" style="display: flex; flex-direction: column;">
                    `;

                    threadSearchedUsers.forEach(u => {
                        const safeName = escapeHtml(u.name || 'User');
                        const safeUsername = u.username ? `@${escapeHtml(u.username)}` : '';
                        const genderIcon = renderGenderIcon(u.gender);
                        const isMe = (currentUser && currentUser.id == u.id);

                        let actionBtnHtml = '';
                        if (!isMe) {
                            if (u.is_friend || u.friendship_status === 'accepted') {
                                actionBtnHtml = `<span class="knot-search-user-btn friend"><i class="fa-solid fa-check"></i> Teman</span>`;
                            } else if (u.friendship_status === 'pending') {
                                if (u.friendship_initiator == (currentUser ? currentUser.id : null)) {
                                    actionBtnHtml = `<span class="knot-search-user-btn pending"><i class="fa-solid fa-clock"></i> Terkirim</span>`;
                                } else {
                                    actionBtnHtml = `<button type="button" class="knot-search-user-btn add" id="likeUserActionBtn_${u.id}" onclick="event.stopPropagation(); respondFriend(${u.friendship_id}, 'accept')"><i class="fa-solid fa-check"></i> Terima</button>`;
                                }
                            } else {
                                actionBtnHtml = `<button type="button" class="knot-search-user-btn add" id="likeUserActionBtn_${u.id}" onclick="event.stopPropagation(); sendFriendRequest(${u.id})"><i class="fa-solid fa-user-plus"></i> Add</button>`;
                            }
                        }

                        html += `
                            <div class="knot-search-user-item" onclick="openNearbyUserInfo(${u.id})">
                                <div style="display: flex; align-items: center; gap: 0.6rem; min-width: 0; flex: 1;">
                                    ${renderAvatarHtml(u.name, u.avatar_color, u.avatar_url, '', 'width: 36px; height: 36px; font-size: 0.9rem; flex-shrink: 0;')}
                                    <div style="min-width: 0; flex: 1;">
                                        <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); display: flex; align-items: center; gap: 0.35rem; line-height: 1.2;">
                                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${safeName}</span>
                                            ${genderIcon}
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">
                                            ${safeUsername ? `<span style="color: var(--primary); font-weight: 500;">${safeUsername}</span><span>•</span>` : ''}
                                            <span style="display: inline-flex; align-items: center; gap: 0.2rem;"><i class="fa-solid fa-location-arrow" style="font-size: 0.68rem;"></i> ${escapeHtml(u.distance_formatted || 'Jarak ?')}</span>
                                        </div>
                                    </div>
                                </div>
                                ${actionBtnHtml}
                            </div>
                        `;
                    });

                    // Tombol Muat Lebih Banyak Pengguna (Lazy load user search)
                    if (threadSearchUserHasMore) {
                        html += `
                            <div style="text-align: center; padding: 0.4rem 0 0.25rem;">
                                <button type="button" class="btn btn-ghost btn-sm" onclick="searchUsersInThreadTab('${escapeHtml(searchQuery)}', true)" style="font-size: 0.74rem; color: var(--primary); padding: 0.25rem 0.6rem;" ${isSearchingMoreUsers ? 'disabled' : ''}>
                                    ${isSearchingMoreUsers ? '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...' : '<i class="fa-solid fa-chevron-down"></i> Muat user lainnya'}
                                </button>
                            </div>
                        `;
                    }

                    html += `
                            </div>
                        </div>
                    `;
                }
            }

            if (list.length === 0) {
                html += `
                    <div style="text-align: center; padding: 3rem 1.5rem; color: var(--text-muted);">
                        <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--item-active); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1rem;">
                            <span class="knot-icon-mask" style="font-size: 2rem; color: var(--primary);"></span>
                        </div>
                        <h4 style="font-weight: 700; font-size: 1.05rem; color: var(--text-main); margin-bottom: 0.35rem;">Belum ada postingan knot</h4>
                        <p style="font-size: 0.84rem; line-height: 1.45; max-width: 280px; margin: 0 auto 1.25rem;">
                            ${searchQuery ? 'Tidak ada postingan knot yang cocok dengan pencarian.' : 'Jadilah yang pertama membuat postingan terbuka untuk orang-orang di sekitarmu!'}
                        </p>
                        ${!searchQuery ? `<button type="button" class="btn btn-primary btn-sm" onclick="openCreateThreadModal()"><i class="fa-solid fa-pen-to-square"></i> Buat Knot Pertama</button>` : ''}
                    </div>
                `;
            } else {
                list.forEach(t => {
                    html += renderKnotCardHtml(t);
                });
            }

            // Infinite Loader untuk Scroll Postingan Knot
            html += `
                <div id="threadsInfiniteLoader" style="display: none; text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.8rem;">
                    <i class="fa-solid fa-spinner fa-spin"></i> Memuat knot lainnya...
                </div>
            `;

            container.innerHTML = html;
        }

        async function openThreadView(threadId) {
            activeThreadId = threadId;

            // Close chat if open
            if (activeChatFriendId) {
                closeChat();
            }

            // Pastikan class mobile chat bersih saat membuka knot di HP
            document.body.classList.remove('in-chat-mobile');
            document.body.classList.add('in-thread-mobile');
            try {
                history.pushState({ inThread: true, threadId }, '');
            } catch(e) {}

            // Bersihkan teks draft balasan dari knot sebelumnya
            const replyInputEl = document.getElementById('threadReplyInput');
            if (replyInputEl) replyInputEl.value = '';

            // Switch Column 3 views
            const emptyState = document.getElementById('chatEmptyState');
            const chatInterface = document.getElementById('activeChatInterface');
            const threadInterface = document.getElementById('activeThreadInterface');

            if (emptyState) emptyState.style.display = 'none';
            if (chatInterface) chatInterface.style.display = 'none';
            if (threadInterface) threadInterface.style.display = 'flex';

            // Highlight card in list
            document.querySelectorAll('.thread-card').forEach(el => el.classList.remove('active-thread'));
            const activeCard = document.getElementById(`threadCard_${threadId}`);
            if (activeCard) activeCard.classList.add('active-thread');

            const opContainer = document.getElementById('threadOriginalPostContainer');
            const repliesContainer = document.getElementById('threadRepliesListContainer');
            const repliesCountHeader = document.getElementById('threadRepliesHeaderCount');

            if (opContainer) {
                opContainer.innerHTML = `
                    <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                        <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.5rem; color: var(--primary);"></i>
                    </div>
                `;
            }
            if (repliesContainer) repliesContainer.innerHTML = '';

            try {
                let url = `/api/blip/threads/${threadId}`;
                const params = new URLSearchParams();
                if (currentUser && currentUser.latitude) params.append('latitude', currentUser.latitude);
                if (currentUser && currentUser.longitude) params.append('longitude', currentUser.longitude);
                if (params.toString()) url += `?${params.toString()}`;

                const res = await fetch(url, { headers: getHeaders() });
                if (!res.ok) {
                    throw new Error(`HTTP error status ${res.status}`);
                }
                const data = await res.json();

                if (data.status === 'success' && data.thread) {
                    const t = data.thread;
                    const u = t.user || {};
                    const isMy = t.is_mine;
                    const isLiked = t.is_liked;
                    const genderIcon = renderGenderIcon(u.gender);
                    const ageBadge = (u.age && !isNaN(u.age)) ? `<span class="user-tag age-badge">${u.age} th</span>` : '';
                    const usernameHandle = u.username ? `<span class="thread-author-handle">@${escapeHtml(u.username)}</span>` : '';

                    if (opContainer) {
                        opContainer.innerHTML = `
                            <div class="thread-op-card">
                                <div class="thread-header">
                                    <div class="thread-author">
                                        <div onclick="openNearbyUserInfo(${u.id || t.user_id})" style="cursor: pointer;" title="Lihat profil ${escapeHtml(u.name || 'User')}">
                                            ${renderAvatarHtml(u.name || 'User', u.avatar_color, u.avatar_url, '', 'width: 44px; height: 44px; font-size: 1.1rem; flex-shrink: 0;')}
                                        </div>
                                        <div style="min-width: 0; flex: 1;">
                                            <div class="thread-author-name" onclick="openNearbyUserInfo(${u.id || t.user_id})" style="cursor: pointer;" title="Lihat profil ${escapeHtml(u.name || 'User')}">
                                                <span>${escapeHtml(u.name || 'User')}</span>
                                                ${genderIcon}
                                                ${ageBadge}
                                            </div>
                                            <div style="font-size: 0.76rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.35rem;">
                                                ${usernameHandle ? `<span>${usernameHandle}</span><span>•</span>` : ''}
                                                <span>${t.created_at_human}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <span class="thread-distance-badge" style="font-size: 0.74rem; padding: 0.25rem 0.65rem;" title="Jarak saat memposting">
                                        <i class="fa-solid fa-location-arrow"></i> ${escapeHtml(t.distance_formatted)}
                                    </span>
                                </div>

                                <div class="thread-content-text">${renderThreadContentWithMentions(t.content)}</div>

                                <div class="thread-footer" style="padding-top: 0.65rem; margin-top: 0.65rem;">
                                    <div class="thread-actions-group">
                                        <button type="button" class="thread-action-pill ${isLiked ? 'liked' : ''}" id="opLikeBtn" data-thread-like-btn="${t.id}" onclick="toggleLikeThread(${t.id}, true)" style="font-size: 0.85rem; padding: 0.3rem 0.65rem;" title="${isLiked ? 'Batal Suka' : 'Suka'}">
                                            <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
                                            <span id="opLikeCount" class="thread-like-count-click" data-thread-like-count="${t.id}" onclick="${t.likes_count > 0 ? `event.stopPropagation(); openThreadLikesModal(${t.id})` : ''}" title="${t.likes_count > 0 ? 'Lihat siapa yang menyukai' : 'Suka'}">${t.likes_count}</span>
                                        </button>
                                        <span class="thread-action-pill" style="cursor: default; font-size: 0.85rem;">
                                            <i class="fa-regular fa-comment"></i>
                                            <span id="opReplyCount">${t.replies_count}</span>
                                        </span>
                                    </div>
                                    ${isMy ? `
                                        <button type="button" class="thread-action-pill danger" onclick="confirmDeleteThread(${t.id})" title="Hapus Postingan" style="font-size: 0.82rem;">
                                            <i class="fa-regular fa-trash-can"></i> <span>Hapus</span>
                                        </button>
                                    ` : ''}
                                </div>
                            </div>
                        `;
                    }

                    const threadReplies = data.replies || (t && t.replies) || [];

                    if (repliesCountHeader) {
                        repliesCountHeader.innerText = `Balasan (${threadReplies.length})`;
                    }

                    renderRepliesList(threadReplies);

                    // Focus reply input
                    const replyInput = document.getElementById('threadReplyInput');
                    if (replyInput) replyInput.focus();
                }
            } catch (err) {
                console.error(err);
                if (opContainer) {
                    opContainer.innerHTML = `<div style="color: #ef4444; padding: 1rem; text-align: center;">Gagal memuat detail knot.</div>`;
                }
            }
        }

        function renderRepliesList(replies) {
            const container = document.getElementById('threadRepliesListContainer');
            if (!container) return;

            if (!replies || replies.length === 0) {
                container.innerHTML = `
                    <div class="thread-empty-replies">
                        <i class="fa-regular fa-comments"></i>
                        <h4>Belum ada balasan</h4>
                        <p>Jadilah yang pertama memberikan respon pada knot ini!</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = replies.map(r => {
                const u = r.user || {};
                const isMy = r.is_mine;
                const genderIcon = renderGenderIcon(u.gender);
                const ageBadge = (u.age && !isNaN(u.age)) ? `<span class="user-tag age-badge">${u.age} th</span>` : '';
                const usernameHandle = u.username ? `@${escapeHtml(u.username)}` : '';

                return `
                    <div class="thread-reply-item" id="replyItem_${r.id}">
                        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
                            <div style="display: flex; align-items: flex-start; gap: 0.6rem; min-width: 0; flex: 1;">
                                <div onclick="openNearbyUserInfo(${u.id || r.user_id})" style="cursor: pointer;" title="Lihat profil ${escapeHtml(u.name || 'User')}">
                                    ${renderAvatarHtml(u.name || 'User', u.avatar_color, u.avatar_url, '', 'width: 34px; height: 34px; font-size: 0.85rem; flex-shrink: 0;')}
                                </div>
                                <div style="min-width: 0; flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 0.35rem; line-height: 1.2;">
                                        <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); cursor: pointer;" onclick="openNearbyUserInfo(${u.id || r.user_id})" title="Lihat profil ${escapeHtml(u.name || 'User')}">${escapeHtml(u.name || 'User')}</span>
                                        ${genderIcon}
                                        ${ageBadge}
                                    </div>
                                    <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 0.25rem;">
                                        ${usernameHandle ? `<span>${usernameHandle}</span><span>•</span>` : ''}
                                        <span>${r.created_at_human}</span>
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                                <span class="thread-distance-badge" style="font-size: 0.68rem; padding: 0.15rem 0.45rem;" title="Jarak pembalas">
                                    <i class="fa-solid fa-location-arrow"></i> ${escapeHtml(r.distance_formatted)}
                                </span>
                                ${isMy ? `
                                    <button type="button" class="thread-action-pill danger" onclick="confirmDeleteReply(${r.id})" style="padding: 0.15rem 0.35rem; font-size: 0.75rem;" title="Hapus Balasan">
                                        <i class="fa-regular fa-trash-can"></i>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                        <div class="thread-reply-content">${renderThreadContentWithMentions(r.content)}</div>
                    </div>
                `;
            }).join('');
        }

        function closeThreadView() {
            activeThreadId = null;
            document.body.classList.remove('in-thread-mobile');

            const emptyState = document.getElementById('chatEmptyState');
            const chatInterface = document.getElementById('activeChatInterface');
            const threadInterface = document.getElementById('activeThreadInterface');

            if (threadInterface) threadInterface.style.display = 'none';

            if (activeChatFriendId) {
                if (chatInterface) chatInterface.style.display = 'flex';
                if (emptyState) emptyState.style.display = 'none';
            } else {
                if (chatInterface) chatInterface.style.display = 'none';
                if (emptyState) emptyState.style.display = 'flex';
            }

            document.querySelectorAll('.thread-card').forEach(el => el.classList.remove('active-thread'));
        }

        async function handleSendReply(e) {
            e.preventDefault();
            if (!activeThreadId) return;

            const input = document.getElementById('threadReplyInput');
            const content = (input ? input.value : '').trim();
            if (!content) return;

            try {
                const res = await fetch(`/api/blip/threads/${activeThreadId}/replies`, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({
                        content: content,
                        latitude: (currentUser && currentUser.latitude) ? currentUser.latitude : null,
                        longitude: (currentUser && currentUser.longitude) ? currentUser.longitude : null,
                    }),
                });
                const data = await res.json();
                if (data.status === 'success' && data.reply) {
                    input.value = '';

                    // Update UI in detail view
                    const repliesContainer = document.getElementById('threadRepliesListContainer');
                    const emptyNotice = repliesContainer ? repliesContainer.querySelector('.thread-empty-replies') : null;
                    if (emptyNotice) emptyNotice.remove();

                    const u = data.reply.user || {};
                    const genderIcon = renderGenderIcon(u.gender);
                    const ageBadge = (u.age && !isNaN(u.age)) ? `<span class="user-tag age-badge">${u.age} th</span>` : '';
                    const usernameHandle = u.username ? `@${escapeHtml(u.username)}` : '';

                    const replyHtml = `
                        <div class="thread-reply-item" id="replyItem_${data.reply.id}">
                            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem;">
                                <div style="display: flex; align-items: flex-start; gap: 0.6rem; min-width: 0; flex: 1;">
                                    <div onclick="openNearbyUserInfo(${u.id || data.reply.user_id})" style="cursor: pointer;" title="Lihat profil ${escapeHtml(u.name || 'User')}">
                                        ${renderAvatarHtml(u.name || 'User', u.avatar_color, u.avatar_url, '', 'width: 34px; height: 34px; font-size: 0.85rem; flex-shrink: 0;')}
                                    </div>
                                    <div style="min-width: 0; flex: 1;">
                                        <div style="display: flex; align-items: center; gap: 0.35rem; line-height: 1.2;">
                                            <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); cursor: pointer;" onclick="openNearbyUserInfo(${u.id || data.reply.user_id})" title="Lihat profil ${escapeHtml(u.name || 'User')}">${escapeHtml(u.name || 'User')}</span>
                                            ${genderIcon}
                                            ${ageBadge}
                                        </div>
                                        <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; display: flex; align-items: center; gap: 0.25rem;">
                                            ${usernameHandle ? `<span>${usernameHandle}</span><span>•</span>` : ''}
                                            <span>${data.reply.created_at_human}</span>
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0;">
                                    <span class="thread-distance-badge" style="font-size: 0.68rem; padding: 0.15rem 0.45rem;" title="Jarak pembalas">
                                        <i class="fa-solid fa-location-arrow"></i> ${escapeHtml(data.reply.distance_formatted)}
                                    </span>
                                    <button type="button" class="thread-action-pill danger" onclick="confirmDeleteReply(${data.reply.id})" style="padding: 0.15rem 0.35rem; font-size: 0.75rem;" title="Hapus Balasan">
                                        <i class="fa-regular fa-trash-can"></i>
                                    </button>
                                </div>
                            </div>
                            <div class="thread-reply-content">${renderThreadContentWithMentions(data.reply.content)}</div>
                        </div>
                    `;

                    if (repliesContainer) {
                        repliesContainer.insertAdjacentHTML('beforeend', replyHtml);
                        repliesContainer.lastElementChild.scrollIntoView({ behavior: 'smooth' });
                    }

                    // Update counts
                    const repliesCount = data.replies_count;
                    const opReplyCount = document.getElementById('opReplyCount');
                    if (opReplyCount) opReplyCount.innerText = repliesCount;
                    const threadCardReplyCount = document.querySelectorAll(`[data-thread-reply-count="${activeThreadId}"], #threadCardReplyCount_${activeThreadId}`);
                    threadCardReplyCount.forEach(el => el.innerText = `${repliesCount}`);

                    const repliesCountHeader = document.getElementById('threadRepliesHeaderCount');
                    if (repliesCountHeader) repliesCountHeader.innerText = `Balasan (${repliesCount})`;

                    // Update in memory list
                    const found = threadsList.find(t => parseInt(t.id, 10) === parseInt(activeThreadId, 10));
                    if (found) found.replies_count = repliesCount;
                } else {
                    alert(data.message || 'Gagal mengirim balasan.');
                }
            } catch (err) {
                console.error(err);
                alert('Terjadi kesalahan koneksi saat mengirim balasan.');
            }
        }

        const pendingLikesSet = new Set();

        function syncLikeUI(threadId, isLiked, count) {
            const numId = parseInt(threadId, 10);
            if (!numId) return;

            const safeCount = Math.max(0, parseInt(count, 10) || 0);

            // 1. Update semua tombol like kartu (di feed utama, profil kontak, dll.)
            const likeBtns = document.querySelectorAll(`[data-thread-like-btn="${numId}"], #threadCardLikeBtn_${numId}`);
            likeBtns.forEach(btn => {
                btn.classList.toggle('liked', !!isLiked);
                btn.title = isLiked ? 'Batal Suka' : 'Suka';
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.className = `fa-${isLiked ? 'solid' : 'regular'} fa-heart`;
                }
            });

            // 2. Update semua teks hitungan like
            const countEls = document.querySelectorAll(`[data-thread-like-count="${numId}"], #threadCardLikeCount_${numId}`);
            countEls.forEach(el => {
                el.innerText = `${safeCount}`;
                el.title = safeCount > 0 ? 'Lihat siapa yang menyukai' : 'Suka';
                if (safeCount > 0) {
                    el.onclick = (e) => { e.stopPropagation(); openThreadLikesModal(numId); };
                } else {
                    el.onclick = null;
                }
            });

            // 3. Update detail Knot jika sedang dibuka (baik activeThreadId bertipe string atau number)
            if (activeThreadId && parseInt(activeThreadId, 10) === numId) {
                const opBtn = document.getElementById('opLikeBtn');
                const opCount = document.getElementById('opLikeCount');
                if (opBtn) {
                    opBtn.classList.toggle('liked', !!isLiked);
                    opBtn.title = isLiked ? 'Batal Suka' : 'Suka';
                    const icon = opBtn.querySelector('i');
                    if (icon) icon.className = `fa-${isLiked ? 'solid' : 'regular'} fa-heart`;
                }
                if (opCount) {
                    opCount.innerText = `${safeCount}`;
                    opCount.title = safeCount > 0 ? 'Lihat siapa yang menyukai' : 'Suka';
                    if (safeCount > 0) {
                        opCount.onclick = (e) => { e.stopPropagation(); openThreadLikesModal(numId); };
                    } else {
                        opCount.onclick = null;
                    }
                }
            }

            // 4. Update data cache di memori
            const found = threadsList.find(t => parseInt(t.id, 10) === numId);
            if (found) {
                found.is_liked = !!isLiked;
                found.likes_count = safeCount;
            }
        }

        async function toggleLikeThread(threadId, fromDetail = false) {
            const numId = parseInt(threadId, 10);
            if (!numId) return;

            // Mencegah spam klik berulang saat request masih terbang di background
            if (pendingLikesSet.has(numId)) return;
            pendingLikesSet.add(numId);

            // Deteksi status saat ini dari tombol atau memori
            let currentLiked = false;
            let currentCount = 0;

            const existingBtn = document.querySelector(`[data-thread-like-btn="${numId}"], #threadCardLikeBtn_${numId}`)
                || (activeThreadId && parseInt(activeThreadId, 10) === numId ? document.getElementById('opLikeBtn') : null);

            if (existingBtn) {
                currentLiked = existingBtn.classList.contains('liked');
            } else {
                const found = threadsList.find(t => parseInt(t.id, 10) === numId);
                if (found) currentLiked = !!found.is_liked;
            }

            const existingCountEl = document.querySelector(`[data-thread-like-count="${numId}"], #threadCardLikeCount_${numId}`)
                || (activeThreadId && parseInt(activeThreadId, 10) === numId ? document.getElementById('opLikeCount') : null);

            if (existingCountEl) {
                currentCount = parseInt(existingCountEl.innerText, 10) || 0;
            } else {
                const found = threadsList.find(t => parseInt(t.id, 10) === numId);
                if (found) currentCount = found.likes_count || 0;
            }

            // OPTIMISTIC UPDATE: Ubah warna dan angka seketika tanpa delay jaringan!
            const optimisticLiked = !currentLiked;
            const optimisticCount = optimisticLiked ? currentCount + 1 : Math.max(0, currentCount - 1);
            syncLikeUI(numId, optimisticLiked, optimisticCount);

            try {
                const res = await fetch(`/api/blip/threads/${numId}/like`, {
                    method: 'POST',
                    headers: getHeaders(),
                });
                const data = await res.json();
                console.log('[Like] Response:', res.status, data);
                if (data.status === 'success') {
                    // Sinkronisasi dengan angka valid dari server
                    syncLikeUI(numId, data.is_liked, data.likes_count);
                } else {
                    // Rollback jika server mengembalikan error (misal rate limit)
                    syncLikeUI(numId, currentLiked, currentCount);
                    console.warn('[Like] Failed:', data.message);
                }
            } catch (err) {
                console.error('[Like] Fetch error:', err);
                // Rollback jika terjadi kendala koneksi
                syncLikeUI(numId, currentLiked, currentCount);
            } finally {
                pendingLikesSet.delete(numId);
            }
        }

        async function openThreadLikesModal(threadId) {
            const numId = parseInt(threadId, 10);
            if (!numId) return;

            const countEl = document.querySelector(`[data-thread-like-count="${numId}"]`)
                || (activeThreadId && parseInt(activeThreadId, 10) === numId ? document.getElementById('opLikeCount') : null);
            const currentCount = countEl ? (parseInt(countEl.innerText, 10) || 0) : 0;

            // Jika belum ada yang suka, jangan buka modal
            if (currentCount === 0) {
                return;
            }

            const modal = document.getElementById('threadLikesModal');
            const container = document.getElementById('threadLikesListContainer');
            const title = document.getElementById('threadLikesModalTitle');

            if (modal) modal.style.display = 'flex';
            if (title) title.innerText = 'Disukai oleh...';
            if (container) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
                        <i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar...
                    </div>
                `;
            }

            try {
                let url = `/api/blip/threads/${threadId}/likes`;
                if (currentUser && currentUser.latitude && currentUser.longitude) {
                    url += `?latitude=${currentUser.latitude}&longitude=${currentUser.longitude}`;
                }
                const res = await fetch(url, { headers: getHeaders() });
                const data = await res.json();

                if (data.status === 'success') {
                    if (title) title.innerText = `Disukai oleh (${data.likes_count || 0})`;

                    if (!data.users || data.users.length === 0) {
                        container.innerHTML = `
                            <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
                                <i class="fa-regular fa-heart" style="font-size: 1.8rem; margin-bottom: 0.5rem; opacity: 0.5;"></i>
                                <p style="font-size: 0.88rem; margin: 0;">Belum ada yang menyukai postingan ini.</p>
                            </div>
                        `;
                        return;
                    }

                    let listHtml = '';
                    data.users.forEach(u => {
                        const genderIcon = renderGenderIcon(u.gender);
                        const ageBadge = (u.age && !isNaN(u.age)) ? `<span class="user-tag age-badge">${u.age} th</span>` : '';
                        const usernameHandle = u.username ? `@${escapeHtml(u.username)}` : '';
                        const isMe = u.is_me;

                        let actionBtnHtml = '';
                        if (!isMe) {
                            if (u.friendship_status === 'accepted') {
                                actionBtnHtml = `<span class="knot-search-user-btn friend"><i class="fa-solid fa-check"></i> Teman</span>`;
                            } else if (u.friendship_status === 'pending') {
                                if (u.friendship_initiator == (currentUser ? currentUser.id : null)) {
                                    actionBtnHtml = `<span class="knot-search-user-btn pending"><i class="fa-solid fa-clock"></i> Terkirim</span>`;
                                } else {
                                    actionBtnHtml = `<button type="button" class="knot-search-user-btn add" id="likeUserActionBtn_${u.id}" onclick="event.stopPropagation(); respondFriend(${u.friendship_id}, 'accept')"><i class="fa-solid fa-check"></i> Terima</button>`;
                                }
                            } else {
                                actionBtnHtml = `<button type="button" class="knot-search-user-btn add" id="likeUserActionBtn_${u.id}" onclick="event.stopPropagation(); sendFriendRequest(${u.id})"><i class="fa-solid fa-user-plus"></i> Add</button>`;
                            }
                        }

                        listHtml += `
                            <div class="thread-like-user-row" onclick="closeThreadLikesModal(); openNearbyUserInfo(${u.id})">
                                <div class="thread-like-user-meta">
                                    ${renderAvatarHtml(u.name || 'User', u.avatar_color, u.avatar_url, '', 'width: 38px; height: 38px; font-size: 0.95rem; flex-shrink: 0;')}
                                    <div style="min-width: 0; flex: 1;">
                                        <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-main); display: flex; align-items: center; gap: 0.35rem; line-height: 1.2;">
                                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(u.name || 'User')}</span>
                                            ${isMe ? '<span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 500;">(Anda)</span>' : ''}
                                            ${genderIcon}
                                            ${ageBadge}
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.74rem; color: var(--text-muted); margin-top: 2px;">
                                            ${usernameHandle ? `<span style="color: var(--primary); font-weight: 500;">${usernameHandle}</span><span>•</span>` : ''}
                                            <span style="display: inline-flex; align-items: center; gap: 0.2rem;"><i class="fa-solid fa-location-arrow" style="font-size: 0.65rem;"></i> ${escapeHtml(u.distance_formatted || 'Jarak ?')}</span>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    ${actionBtnHtml}
                                </div>
                            </div>
                        `;
                    });

                    container.innerHTML = listHtml;
                } else {
                    throw new Error(data.message || 'Gagal memuat');
                }
            } catch (err) {
                console.error('openThreadLikesModal error:', err);
                if (container) {
                    container.innerHTML = `
                        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
                            <p style="font-size: 0.85rem; color: #ef4444; margin-bottom: 0.5rem;">Gagal memuat daftar penyuka.</p>
                            <button type="button" class="btn btn-outline btn-sm" onclick="openThreadLikesModal(${threadId})">Coba Lagi</button>
                        </div>
                    `;
                }
            }
        }

        function closeThreadLikesModal() {
            const modal = document.getElementById('threadLikesModal');
            if (modal) modal.style.display = 'none';
        }

        async function confirmDeleteThread(threadId) {
            Swal.fire({
                title: 'Hapus Postingan Knot?',
                text: 'Postingan knot ini beserta seluruh balasannya akan dihapus permanen.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Ya, Hapus',
                cancelButtonText: 'Batal',
                customClass: {
                    popup: 'blip-swal-popup',
                    title: 'blip-swal-title',
                    htmlContainer: 'blip-swal-text',
                    actions: 'blip-swal-actions',
                    confirmButton: 'blip-swal-confirm-btn',
                    cancelButton: 'blip-swal-cancel-btn',
                },
                buttonsStyling: false,
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        const res = await fetch(`/api/blip/threads/${threadId}`, {
                            method: 'DELETE',
                            headers: getHeaders(),
                        });
                        const data = await res.json();
                        if (data.status === 'success') {
                            threadsList = threadsList.filter(t => parseInt(t.id, 10) !== parseInt(threadId, 10));
                            filterAndRenderThreads();
                            if (activeThreadId && parseInt(activeThreadId, 10) === parseInt(threadId, 10)) {
                                closeThreadView();
                            }
                        } else {
                            alert(data.message || 'Gagal menghapus knot.');
                        }
                    } catch (err) {
                        console.error(err);
                    }
                }
            });
        }

        async function confirmDeleteReply(replyId) {
            Swal.fire({
                title: 'Hapus Balasan?',
                text: 'Balasan ini akan dihapus permanen.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Ya, Hapus',
                cancelButtonText: 'Batal',
                customClass: {
                    popup: 'blip-swal-popup',
                    title: 'blip-swal-title',
                    htmlContainer: 'blip-swal-text',
                    actions: 'blip-swal-actions',
                    confirmButton: 'blip-swal-confirm-btn',
                    cancelButton: 'blip-swal-cancel-btn',
                },
                buttonsStyling: false,
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        const res = await fetch(`/api/blip/threads/replies/${replyId}`, {
                            method: 'DELETE',
                            headers: getHeaders(),
                        });
                        const data = await res.json();
                        if (data.status === 'success') {
                            const item = document.getElementById(`replyItem_${replyId}`);
                            if (item) item.remove();

                            const count = data.replies_count;
                            const opReplyCount = document.getElementById('opReplyCount');
                            if (opReplyCount) opReplyCount.innerText = count;

                            const cardReplyCounts = document.querySelectorAll(`[data-thread-reply-count="${activeThreadId}"], #threadCardReplyCount_${activeThreadId}`);
                            cardReplyCounts.forEach(el => el.innerText = `${count}`);

                            const repliesCountHeader = document.getElementById('threadRepliesHeaderCount');
                            if (repliesCountHeader) repliesCountHeader.innerText = `Balasan (${count})`;

                            const found = threadsList.find(t => parseInt(t.id, 10) === parseInt(activeThreadId, 10));
                            if (found) found.replies_count = count;
                        } else {
                            alert(data.message || 'Gagal menghapus balasan.');
                        }
                    } catch (err) {
                        console.error(err);
                    }
                }
            });
        }

        // Shortcut tombol Escape (Esc)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                const lightbox = document.getElementById('imageLightboxModal');
                if (lightbox && lightbox.style.display === 'flex') {
                    closeImageLightbox();
                    return;
                }
                const threadModal = document.getElementById('createThreadModal');
                if (threadModal && threadModal.style.display === 'flex') {
                    closeCreateThreadModal();
                    return;
                }
                const threadLikesModal = document.getElementById('threadLikesModal');
                if (threadLikesModal && threadLikesModal.style.display === 'flex') {
                    closeThreadLikesModal();
                    return;
                }
                // Jika sedang di mode detail thread, tutup jendela thread
                if (activeThreadId) {
                    closeThreadView();
                    return;
                }
                // Jika sedang di mode select pesan, batalkan mode select terlebih dahulu
                if (isSelectionMode) {
                    cancelSelectMode();
                    return;
                }
                // Jika chat sedang terbuka, tutup jendela chat
                if (activeChatFriendId) {
                    closeChat();
                }
            }
        });

        // Android / Mobile Browser Back Button Handling
        window.addEventListener('popstate', (e) => {
            if (activeChatFriendId) {
                closeChat();
            } else if (activeThreadId) {
                closeThreadView();
            } else {
                const contactPanel = document.getElementById('contactInfoPanel');
                if (contactPanel && contactPanel.classList.contains('open')) {
                    toggleContactInfoPanel(false);
                }
            }
        });

        window.addEventListener('DOMContentLoaded', () => {
            initApp();
            setupScrollListeners();
            setupMentionAutocomplete('createThreadInputContent', 'createThreadMentionDropdown');
            setupMentionAutocomplete('threadReplyInput', 'threadReplyMentionDropdown');
            fetchThreadNotifications();
        });
