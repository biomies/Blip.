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

        // Helper untuk me-render avatar (foto profil jika ada, atau inisial nama + warna)
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
                    if (activeChatFriendId && (activeChatFriendId == msg.sender_id || activeChatFriendId == msg.receiver_id)) {
                        const existingIdx = currentChatMessages.findIndex(m => m.id === msg.id);
                        if (existingIdx !== -1) {
                            currentChatMessages[existingIdx] = {
                                ...msg,
                                is_me: msg.sender_id == currentUser.id,
                                status: 'sent'
                            };
                        } else {
                            currentChatMessages = currentChatMessages.filter(m => !(m.id && String(m.id).startsWith('temp_') && m.message === msg.message));
                            currentChatMessages.push({
                                ...msg,
                                is_me: msg.sender_id == currentUser.id,
                                status: 'sent'
                            });
                        }
                        renderMessages(currentChatMessages);

                        // Jika pesan datang dari teman saat kita sedang membuka chatnya, otomatis tandai terbaca (read receipt)
                        if (msg.sender_id == activeChatFriendId) {
                            fetch(`/api/blip/messages/${activeChatFriendId}/read`, {
                                method: 'POST',
                                headers: getHeaders()
                            }).catch(() => {});
                        }
                    } else if (msg.sender_id != currentUser.id) {
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
                    // Fallback jika ditolak/timeout/lokal: gunakan koordinat default Jakarta Selatan (-6.2538, 106.8206)
                    if (!currentUser.latitude || !currentUser.longitude) {
                        await syncCoordinates(-6.2538, 106.8206);
                    } else {
                        loadNearbyUsers();
                    }
                }, { timeout: 3500 });
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
                    loadNearbyUsers();
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
            const un = document.getElementById('infoPanelUsername');
            const dst = document.getElementById('infoPanelDist');
            const bi = document.getElementById('infoPanelBio');
            const gndr = document.getElementById('infoPanelGender');
            const ag = document.getElementById('infoPanelAge');
            const loc = document.getElementById('infoPanelLocation');
            const actions = document.querySelector('.tg-info-actions');
            const addFriendWrap = document.getElementById('infoPanelAddFriendWrap');

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
                    av.style.backgroundColor = color;
                    av.style.cursor = 'default';
                    av.title = '';
                    av.onclick = null;
                }
            }
            if (nm) nm.innerText = name;
            if (un) {
                un.innerText = username ? `@${username}` : '';
                un.style.display = username ? 'block' : 'none';
            }
            if (dst) dst.innerHTML = `<i class="fa-solid fa-location-arrow"></i> <span>${distFormatted || '0 m'}</span>`;
            if (bi) bi.innerText = bio || 'Belum ada bio';
            if (gndr) gndr.innerText = gender === 'male' ? 'Pria' : (gender === 'female' ? 'Wanita' : 'Tidak disebutkan');
            if (ag) ag.innerText = age ? `${age} tahun` : 'Tidak disebutkan';
            if (loc) loc.innerText = distFormatted || '0 m';

            // Jika belum berteman, sembunyikan aksi chat seperti 'Hapus Riwayat Chat'
            if (actions) {
                actions.style.display = isFriend ? 'flex' : 'none';
            }

            // Tombol Add Teman di Info Pengguna ketika belum berteman
            if (addFriendWrap) {
                if (!isFriend && userId) {
                    addFriendWrap.style.display = 'flex';
                    if (friendshipStatus === 'pending') {
                        if (friendshipInitiator == (currentUser ? currentUser.id : null)) {
                            addFriendWrap.innerHTML = `<span style="font-size: 0.85rem; color: var(--warning); display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.5rem 1rem; border-radius: 999px; background: rgba(245, 158, 11, 0.1); font-weight: 600;"><i class="fa-solid fa-clock"></i> Permintaan Terkirim</span>`;
                        } else {
                            addFriendWrap.innerHTML = uiButton({ text: 'Terima Permintaan', icon: 'fa-solid fa-check', variant: 'primary', size: 'md', onclick: `respondFriend(${friendshipId}, 'accept')` });
                        }
                    } else {
                        addFriendWrap.innerHTML = uiButton({ text: 'Add Teman', icon: 'fa-solid fa-user-plus', variant: 'primary', size: 'md', onclick: `sendFriendRequest(${userId})` });
                    }
                } else {
                    addFriendWrap.style.display = 'none';
                    addFriendWrap.innerHTML = '';
                }
            }
        }

        // Buka Info Pengguna untuk orang sekitar yang belum berteman
        function openNearbyUserInfo(userId) {
            const user = nearbyUsersList.find(u => u.id == userId);
            if (!user) return;
            const fInitiator = user.friendship_initiator !== undefined && user.friendship_initiator !== null ? user.friendship_initiator : null;
            const fId = user.friendship_id ? user.friendship_id : null;
            const fStatus = user.friendship_status ? user.friendship_status : null;
            updateContactInfoPanel(user.name, user.avatar_color, user.distance_formatted, user.gender, user.age, user.bio, false, user.id, fStatus, fInitiator, fId, user.avatar_url, user.username);
            toggleContactInfoPanel(true);
        }

        // Search Input Filter
        let searchQuery = '';
        function handleSearchFilter(query) {
            searchQuery = (query || '').toLowerCase().trim();
            if (currentTab === 'nearby') {
                filterAndRenderNearby();
            } else {
                filterAndRenderFriends();
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

            // Jika tab yang sama ditekan kembali, toggle tutup/buka window ke-2
            if (currentTab === tab && sidebar) {
                const isCurrentlyCollapsed = sidebar.classList.contains('collapsed');
                sidebar.classList.toggle('collapsed', !isCurrentlyCollapsed);
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
            const navAvatar = document.getElementById('navAvatar');

            if (nearbyBtn) nearbyBtn.classList.toggle('active', tab === 'nearby');
            if (contactsBtn) contactsBtn.classList.toggle('active', tab === 'contacts');
            if (friendsBtn) friendsBtn.classList.toggle('active', tab === 'friends');
            if (navAvatar) navAvatar.style.outline = (tab === 'profile') ? '2px solid var(--primary)' : 'none';

            // Jika user membuka tab Teman (contacts), reset notifikasi teman yang baru di-acc
            if (tab === 'contacts') {
                unreadAcceptedFriendsCount = 0;
                updateNotificationBadge();
            }

            // Tutup inline profile jika kembali ke nearby / contacts / friends
            const chatsContent = document.getElementById('chatsSidebarContent');
            const profileView = document.getElementById('inlineProfileView');
            if (tab === 'profile') {
                if (chatsContent) chatsContent.style.display = 'none';
                if (profileView) profileView.style.display = 'flex';
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
                } else {
                    searchInput.placeholder = 'Cari orang sekitar...';
                }
            }

            if (tab === 'nearby') {
                nearbyPage = 1;
                loadNearbyUsers(false);
            } else if (tab === 'contacts' || tab === 'friends') {
                loadFriends();
            }
        }

        // Manual Refresh Orang Sekitar
        async function refreshNearbyManual() {
            const icon = document.getElementById('refreshIcon');
            if (icon) icon.classList.add('fa-spin');
            
            showToast('Memindai ulang radar sekitar...', 'info');

            // Coba perbarui koordinat GPS jika ada
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(async (pos) => {
                    await syncCoordinates(pos.coords.latitude, pos.coords.longitude);
                    await finishRefresh();
                }, async () => {
                    await finishRefresh();
                }, { timeout: 4000 });
            } else {
                await finishRefresh();
            }

            async function finishRefresh() {
                if (currentTab === 'nearby') {
                    await loadNearbyUsers();
                } else {
                    await loadFriends();
                }
                setTimeout(() => {
                    if (icon) icon.classList.remove('fa-spin');
                    showToast('Radar sekitar berhasil diperbarui!', 'success');
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
                // Optimistic UI update: langsung ubah status target di list menjadi 'pending'
                const targetInList = nearbyUsersList.find(u => u.id == targetUserId);
                if (targetInList) {
                    targetInList.friendship_status = 'pending';
                    targetInList.friendship_initiator = currentUser ? currentUser.id : null;
                    filterAndRenderNearby();
                }

                // Perbarui juga tombol di panel Info Pengguna jika sedang terbuka untuk user ini
                const addFriendWrap = document.getElementById('infoPanelAddFriendWrap');
                if (addFriendWrap && addFriendWrap.style.display !== 'none') {
                    addFriendWrap.innerHTML = `<span style="font-size: 0.85rem; color: var(--warning); display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.5rem 1rem; border-radius: 999px; background: rgba(245, 158, 11, 0.1); font-weight: 600;"><i class="fa-solid fa-clock"></i> Permintaan Terkirim</span>`;
                }

                const res = await fetch('/api/blip/friend-request', {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ target_user_id: targetUserId })
                });
                const data = await res.json();
                if (data.status === 'success' || data.status === 'accepted') {
                    showToast(data.message, 'success');
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
            // Polling cadangan (setiap 2.5s) sebagai safety net agar obrolan tetap realtime jika websocket terputus/reconnect
            chatPollingInterval = setInterval(() => {
                if (activeChatFriendId) {
                    pollActiveChat();
                }
            }, 2500);
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
                        // Hitung sisa waktu kedaluwarsa jika ada
                        let expiryBadge = '';
                        if (m.is_saved) {
                            expiryBadge = `<span class="photo-status-badge saved"><i class="fa-solid fa-bookmark"></i> Disimpan</span>`;
                        } else if (m.expires_at) {
                            expiryBadge = `<span class="photo-status-badge ephemeral" title="Foto hilang dalam 1 jam jika tidak disimpan"><i class="fa-regular fa-clock"></i> 1 Jam</span>`;
                        }

                        // Tombol simpan foto
                        const saveBtnHtml = (!m.is_saved && isRealMessage) ? `
                            <button type="button" class="photo-save-btn" onclick="saveReceivedPhoto(event, ${m.id})" title="Simpan permanen agar tidak terhapus">
                                <i class="fa-solid fa-bookmark"></i> Simpan
                            </button>
                        ` : '';

                        bubbleContentHtml = `
                            <div class="server-photo-card">
                                <div class="photo-img-wrapper">
                                    <img src="${m.photo_url}" class="server-photo-img" onclick="openImageLightbox('${m.photo_url}')" alt="Foto Obrolan" loading="lazy">
                                    <div class="photo-overlay-badges">
                                        ${expiryBadge}
                                        ${saveBtnHtml}
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

        // Profile View (Inline di Sidebar, Menggantikan Popup)
        function openProfileModal() {
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

            const pal = document.getElementById('colorPalette');
            if (pal) {
                pal.innerHTML = colors.map(c => `
                    <div class="color-circle ${c === selectedColor ? 'selected' : ''}" style="background-color: ${c};" onclick="selectAvatarColor('${c}', this)"></div>
                `).join('');
            }

            switchTab('profile');
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

        function updateProfilePreviewName(val) {
            const previewName = document.getElementById('profileNamePreview');
            const previewAv = document.getElementById('profileAvatarPreview');
            const name = (val || '').trim() || 'Akun Saya';
            if (previewName) previewName.innerText = name;
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

        let cropperInstance = null;

        function updateProfileAvatarPreview() {
            const previewAv = document.getElementById('profileAvatarPreview');
            const previewName = document.getElementById('profileNamePreview');
            const deleteBadge = document.getElementById('btnDeleteAvatarBadge');
            if (currentUser) {
                if (previewAv) {
                    if (currentUser.avatar_url) {
                        previewAv.innerText = '';
                        previewAv.style.backgroundImage = `url('${escapeHtml(currentUser.avatar_url)}')`;
                        previewAv.style.backgroundSize = 'cover';
                        previewAv.style.backgroundPosition = 'center';
                        previewAv.style.backgroundColor = 'transparent';
                        previewAv.style.cursor = 'pointer';
                        previewAv.title = 'Klik untuk melihat foto lebih besar';
                        previewAv.onclick = () => openImageLightbox(currentUser.avatar_url);
                    } else {
                        previewAv.innerText = (currentUser.name || 'B').charAt(0).toUpperCase();
                        previewAv.style.backgroundImage = 'none';
                        previewAv.style.backgroundColor = selectedColor || currentUser.avatar_color;
                        previewAv.style.cursor = 'default';
                        previewAv.title = '';
                        previewAv.onclick = null;
                    }
                }
                if (previewName) {
                    previewName.innerText = currentUser.name || 'Akun Saya';
                }
                const previewUsername = document.getElementById('profileUsernamePreview');
                if (previewUsername) {
                    previewUsername.innerText = currentUser.username ? `@${currentUser.username}` : '';
                }
                if (deleteBadge) {
                    deleteBadge.style.display = currentUser.avatar_url ? 'inline-flex' : 'none';
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
            const name = document.getElementById('inputProfileName').value.trim();
            const usernameInput = document.getElementById('inputProfileUsername');
            let username = usernameInput ? usernameInput.value.trim().replace(/^@/, '').toLowerCase() : '';
            let bio = (document.getElementById('inputProfileBio')?.value || '').trim();
            // Auto phrase: ubah line break/enter menjadi satu spasi
            bio = bio.replace(/[\r\n]+/g, ' ').trim();
            const birthdateVal = document.getElementById('inputProfileBirthdate').value;

            if (!name) return;
            if (!username) {
                showToast('Username wajib diisi.', 'error');
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
                    closeProfileModal();
                } else {
                    showToast(data.message || 'Gagal update profil.', 'error');
                }
            } catch (err) {
                showToast('Gagal update profil.', 'error');
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
                if (currentTab !== 'nearby') return;
                // Jika sudah mendekati dasar list (sisa 60px)
                if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 60) {
                    if (nearbyHasMore && !nearbyLoading) {
                        loadNearbyUsers(true);
                    }
                }
            });
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // Shortcut tombol Escape (Esc)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                const lightbox = document.getElementById('imageLightboxModal');
                if (lightbox && lightbox.style.display === 'flex') {
                    closeImageLightbox();
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
        });
