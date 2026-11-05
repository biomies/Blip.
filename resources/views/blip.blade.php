<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="theme-color" content="#2b77f8">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <title>Blip.</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://js.pusher.com/8.3.0/pusher.min.js"></script>
    <script src="https://unpkg.com/@tailwindcss/browser@4"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.1/cropper.min.js"></script>
    <script type="module" src="https://cdn.jsdelivr.net/npm/emoji-picker-element@^1/index.js"></script>
    <link rel="stylesheet" href="{{ asset('css/app.css') }}?v={{ time() }}">
</head>
<body>

    <!-- App Window Container (Telegram Desktop UI Style) -->
    <div class="tg-app-window">

        <!-- 1. Leftmost Navigation Sidebar (Icon Tabs & Profile) -->
        <aside class="tg-nav-sidebar">
            <div class="tg-nav-top">
                <div class="tg-logo" onclick="loadNearbyUsers()" title="Blip.">
                    Blip.
                </div>
                
                <x-nav-item
                    id="tabFriendsNavBtn"
                    label="Chat"
                    icon="fa-solid fa-comments"
                    :active="true"
                    badgeId="unreadMessagesBadge"
                    title="Percakapan Chat"
                    onclick="switchTab('friends')"
                />

                <x-nav-item
                    id="tabContactsNavBtn"
                    label="Teman"
                    icon="fa-solid fa-user-group"
                    badgeId="friendRequestBadge"
                    title="Daftar Teman (Friend List)"
                    onclick="switchTab('contacts')"
                />

                <x-nav-item
                    id="tabNearbyNavBtn"
                    label="Sekitar"
                    icon="fa-solid fa-tower-broadcast"
                    title="Radar Orang di Sekitar"
                    onclick="switchTab('nearby')"
                />

                <x-nav-item
                    id="tabThreadsNavBtn"
                    label="Knot"
                    customIcon="knot-icon-mask"
                    badgeId="unreadThreadsBadge"
                    title="Knot & Postingan Sekitar"
                    onclick="switchTab('threads')"
                />
            </div>

            <div class="tg-nav-bottom">
                <button type="button" class="tg-nav-btn tg-profile-nav-btn" id="tabProfileNavBtn" onclick="openProfileModal()" title="Profil Akun Saya">
                    <div class="tg-my-avatar" id="navAvatar">
                        B
                    </div>
                    <span class="tg-nav-label">Profil</span>
                </button>
            </div>
        </aside>

        <!-- 2. Second Column: Chats & Radar User List OR Inline Profile View -->
        <section class="tg-chats-sidebar" id="chatsSidebar">
            <!-- Normal Chat/Radar Sidebar Content -->
            <div id="chatsSidebarContent" style="display: flex; flex-direction: column; height: 100%; width: 100%;">
                <!-- Search & Actions Header -->
                <div class="tg-search-header">
                    <form class="tg-search-box" id="searchHeaderForm" onsubmit="handleSearchSubmit(event)">
                        <button type="submit" class="tg-search-btn-trigger" id="btnSearchTrigger" title="Cari">
                            <i class="fa-solid fa-magnifying-glass tg-search-icon"></i>
                        </button>
                        <input type="text" id="searchInput" class="tg-search-input" placeholder="Cari riwayat percakapan..." oninput="handleSearchInputChange(this.value)">
                        <button type="button" class="tg-search-clear-btn" id="btnSearchClear" onclick="clearSearchInput()" style="display: none;" title="Hapus Pencarian">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </form>
                    <button type="button" class="tg-refresh-btn" id="btnOpenNewThread" onclick="openCreateThreadModal()" style="display: none; background: var(--primary); color: #ffffff; border-color: var(--primary);" title="Buat Knot Baru">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button type="button" class="tg-refresh-btn" id="btnThreadNotifsToggle" onclick="toggleThreadNotificationsDropdown(event)" style="display: none; position: relative;" title="Notifikasi Knot & Mention">
                        <i class="fa-regular fa-bell"></i>
                        <span class="badge-count" id="headerThreadNotifBadge" style="display: none; top: -4px; right: -4px; font-size: 0.65rem; min-width: 16px; height: 16px;">0</span>
                    </button>
                    <button type="button" class="tg-refresh-btn" id="btnRefreshNearby" onclick="refreshNearbyManual()" title="Pindai Ulang Radar Sekitar">
                        <i class="fa-solid fa-arrows-rotate" id="refreshIcon"></i>
                    </button>

                    <!-- Dropdown Notifikasi Thread/Knot -->
                    <div id="threadNotifsDropdownMenu" class="thread-notifs-dropdown" style="display: none;">
                        <div class="thread-notifs-header">
                            <span style="font-weight: 700; font-size: 0.88rem; color: var(--text-main);">Notifikasi Knot</span>
                            <button type="button" class="thread-notifs-mark-read" onclick="markAllThreadNotifsAsRead()" title="Tandai semua dibaca">
                                <i class="fa-solid fa-check-double"></i> Tandai Dibaca
                            </button>
                        </div>
                        <div class="thread-notifs-list" id="threadNotifsListContainer">
                            <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.82rem;">
                                Memuat notifikasi...
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tabs Pill Filter (Semua, Wanita, Pria) -->
                <div class="tg-filter-tabs" id="nearbyFilterTabs" style="display: none;">
                    <button type="button" class="tg-filter-pill active" id="filterAll" onclick="setNearbyGenderFilter('all')">
                        Semua
                    </button>
                    <button type="button" class="tg-filter-pill" id="filterFemale" onclick="setNearbyGenderFilter('female')">
                        <i class="fa-solid fa-venus" style="color: #db2777;"></i> Wanita
                    </button>
                    <button type="button" class="tg-filter-pill" id="filterMale" onclick="setNearbyGenderFilter('male')">
                        <i class="fa-solid fa-mars" style="color: #2563eb;"></i> Pria
                    </button>
                </div>

                <!-- Main Items List (Nearby / Friends) -->
                <div class="list-container" id="listContent">
                    <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
                        <i class="fa-solid fa-spinner fa-spin" style="font-size: 1.6rem; color: var(--primary); margin-bottom: 0.75rem;"></i>
                        <p style="font-size: 0.88rem;">Memuat daftar chat...</p>
                    </div>
                </div>
            </div>

            <!-- Inline Profile Panel (Threads Clean Style Profile & Postings) -->
            <div id="inlineProfileView" style="display: none; flex-direction: column; height: 100%; width: 100%; background: var(--bg-main);">
                <!-- Profile Header Bar -->
                <div class="tg-search-header" style="justify-content: space-between; flex-shrink: 0; border-bottom: 1px solid var(--border-color); padding: 0.6rem 0.85rem; height: 52px;">
                    <div style="display: flex; align-items: center; gap: 0.6rem;">
                        <button type="button" class="tg-refresh-btn" onclick="closeProfileModal()" title="Kembali">
                            <i class="fa-solid fa-arrow-left"></i>
                        </button>
                        <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">Profil Saya</span>
                    </div>
                </div>

                <!-- Scrollable Profile View -->
                <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column;">
                    <!-- Threads Style Profile Header Area -->
                    <div class="threads-profile-header-area">
                        <div class="threads-profile-top-row">
                            <!-- Left: Avatar with Single Camera Badge & Dropdown -->
                            <div class="threads-avatar-wrap" style="position: relative;">
                                <div class="profile-avatar-wrapper" style="position: relative; width: 64px; height: 64px;">
                                    <div id="profileAvatarPreview" class="threads-profile-avatar-img">
                                        B
                                    </div>
                                    <button type="button" class="avatar-badge-btn change-photo-badge" onclick="toggleAvatarDropdown(event)" title="Kelola Foto Profil">
                                        <i class="fa-solid fa-camera"></i>
                                    </button>
                                    <input type="file" id="inputAvatarFile" accept="image/*" style="display: none;" onchange="onAvatarFileSelected(event)">
                                </div>

                                <!-- Dropdown Menu Foto Profil -->
                                <div id="avatarOptionsMenuDropdown" class="avatar-options-dropdown" style="display: none;">
                                    <button type="button" class="avatar-dropdown-item" onclick="onAvatarDropdownUploadClick()">
                                        <i class="fa-solid fa-cloud-arrow-up" style="color: var(--primary);"></i>
                                        <span>Ganti Foto</span>
                                    </button>
                                    <button type="button" id="avatarDropdownDeleteBtn" class="avatar-dropdown-item danger" onclick="onAvatarDropdownDeleteClick()" style="display: none;">
                                        <i class="fa-solid fa-trash-can"></i>
                                        <span>Hapus Foto</span>
                                    </button>
                                </div>
                            </div>

                            <!-- Right: Names & Username -->
                            <div class="threads-profile-info-col">
                                <h2 id="profileNamePreview" class="threads-display-name">Akun Saya</h2>
                                <div id="profileUsernamePreview" class="threads-handle">@username</div>
                            </div>
                        </div>

                        <!-- User Bio -->
                        <p id="profileBioDisplay" class="threads-bio-text">Tulis bio Anda untuk memperkenalkan diri...</p>

                        <!-- User Meta Details (Gender, Age, Joined) -->
                        <div class="twitter-profile-meta-list" style="margin-top: 0.4rem;">
                            <div class="twitter-meta-item" id="profileMetaGenderWrap" style="display: none;">
                                <i class="fa-solid fa-mars-and-venus"></i>
                                <span id="profileMetaGender">-</span>
                            </div>
                            <div class="twitter-meta-item" id="profileMetaAgeWrap" style="display: none;">
                                <i class="fa-solid fa-cake-candles"></i>
                                <span id="profileMetaAge">-</span>
                            </div>
                            <div class="twitter-meta-item">
                                <i class="fa-regular fa-calendar"></i>
                                <span id="profileMetaJoined">Bergabung baru-baru ini</span>
                            </div>
                        </div>

                        <!-- Action Button: Edit Profil (Full Width ala Threads) -->
                        <div style="margin-top: 0.85rem; width: 100%;">
                            <button type="button" class="threads-btn-action edit-profile" id="btnToggleEditProfile" onclick="toggleEditProfileSection()">
                                <i class="fa-solid fa-pen"></i> <span>Edit Profil</span>
                            </button>
                        </div>
                    </div>

                    <!-- TAB 1: Daftar Knot Milik User Langsung -->
                    <div id="profileKnotsTabContent" style="display: flex; flex-direction: column; flex: 1;">
                        <div id="profileKnotsList" class="profile-knots-container">
                            <!-- Populated via JavaScript -->
                        </div>
                    </div>

                    <!-- TAB 2: Form Edit Profil & Hapus Akun (Muncul saat tombol Edit Profil ditekan) -->
                    <div id="profileEditTabContent" style="display: none; padding: 1.25rem 1rem; flex-direction: column; flex: 1;">
                        <p style="font-size: 0.78rem; color: var(--text-muted); margin-bottom: 1.25rem; line-height: 1.4; background: var(--item-hover); padding: 0.65rem 0.85rem; border-radius: 8px;">
                            <i class="fa-solid fa-circle-info" style="color: var(--primary); margin-right: 4px;"></i>
                            Jika tidak ada aktivitas selama 1 bulan, akun akan dihapus otomatis.
                        </p>

                        <form onsubmit="handleUpdateProfile(event)">
                            <!-- 1. Nama -->
                            <div class="form-group">
                                <label>Nama Anda</label>
                                <input type="text" id="inputProfileName" class="form-input" required maxlength="50" placeholder="Masukkan nama panggilan..." oninput="onProfileNameChange(this.value)">
                                <div id="profileNameErrorStatus" style="font-size: 0.75rem; margin-top: 4px; display: none;"></div>
                            </div>

                            <!-- 2. Username (Twitter Handle style) via Component -->
                            <x-username-input
                                id="inputProfileUsername"
                                statusId="profileUsernameStatus"
                                oninput="onProfileUsernameChange(this.value)"
                            />

                            <!-- 3. Bio -->
                            <div class="form-group">
                                <label style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>Bio</span>
                                    <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;" id="profileBioCounter">0/160</span>
                                </label>
                                <textarea id="inputProfileBio" class="form-input" rows="2" maxlength="160" placeholder="Tulis sedikit tentang diri Anda..." style="resize: none; font-size: 0.85rem; line-height: 1.4; padding: 0.5rem 0.65rem;" oninput="updateProfileBioCounter(this.value)" onkeydown="if(event.key === 'Enter'){ event.preventDefault(); }"></textarea>
                            </div>

                            <!-- 4. Jenis Kelamin dan Tanggal Lahir -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1.25rem;">
                                <div>
                                    <label style="display: block; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.4rem; font-weight: 600;">Jenis Kelamin</label>
                                    <div class="gender-options" style="grid-template-columns: 1fr 1fr; gap: 0.4rem;">
                                        <button type="button" class="gender-btn" id="genderBtnMale" onclick="selectGender('male')" style="padding: 0.55rem 0.4rem; font-size: 0.8rem;">
                                            <i class="fa-solid fa-mars" style="color: #2563eb; pointer-events: none;"></i>
                                            <span style="pointer-events: none;">Pria</span>
                                        </button>
                                        <button type="button" class="gender-btn" id="genderBtnFemale" onclick="selectGender('female')" style="padding: 0.55rem 0.4rem; font-size: 0.8rem;">
                                            <i class="fa-solid fa-venus" style="color: #db2777; pointer-events: none;"></i>
                                            <span style="pointer-events: none;">Wanita</span>
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem;">
                                        <label style="font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">Tgl Lahir</label>
                                        <span id="calculatedAgeDisplay" style="font-size: 0.72rem; font-weight: 700; color: var(--primary);"></span>
                                    </div>
                                    <input type="date" id="inputProfileBirthdate" class="form-input" style="height: 40px; padding: 0.4rem 0.6rem; font-size: 0.82rem;" onchange="onBirthdateChange()">
                                </div>
                            </div>

                            <div style="display: flex; justify-content: flex-end; gap: 0.6rem; margin-top: 1.5rem;">
                                <x-button variant="outline" size="sm" onclick="switchProfileSubTab('knots')">Batal</x-button>
                                <x-button type="submit" variant="primary" size="sm">Simpan Perubahan</x-button>
                            </div>
                        </form>

                        <!-- Paling Bawah Mentok: Tombol Hapus Akun -->
                        <div style="margin-top: auto; padding-top: 2rem; border-top: 1px dashed var(--border-color); flex-shrink: 0;">
                            <button type="button" onclick="confirmDeleteAccount()" style="width: 100%; padding: 0.65rem 1rem; background: #ef4444; color: #ffffff; border: none; border-radius: 8px; font-weight: 600; font-size: 0.88rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.5rem; transition: background 0.15s ease;" onmouseover="this.style.background='#dc2626'" onmouseout="this.style.background='#ef4444'">
                                <i class="fa-solid fa-trash-can"></i> Hapus Akun
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- 3. Third Column: Main Active Chat Window -->
        <main class="chat-panel" id="chatPanel">
            <!-- Empty state when no chat is opened -->
            <div class="chat-empty-state" id="chatEmptyState">
                <div class="tg-empty-icon-wrap">
                    <i class="fa-solid fa-comments chat-empty-icon"></i>
                </div>
                <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.4rem; color: var(--text-main);">Pilih Teman untuk Chat</h3>
                <p style="max-width: 380px; font-size: 0.88rem; line-height: 1.5; color: var(--text-muted);">
                    Kirim pesan instan secara gratis. Pilih teman di daftar sebelah kiri atau klik <b>Add Teman</b> pada orang di sekitar Anda.
                </p>
            </div>

            <!-- Active chat interface -->
            <div id="activeChatInterface" style="display: none; height: 100%; flex-direction: column;">
                
                <!-- Chat Selection Header Bar (Muncul saat Select Mode Aktif) -->
                <div class="chat-selection-header" id="chatSelectionHeader">
                    <div class="chat-selection-header-left">
                        <button type="button" class="selection-close-btn" onclick="cancelSelectMode()" title="Batal (Esc)">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                        <span class="selection-count-title" id="selectedCountText">0 terpilih</span>
                    </div>
                    <div class="chat-selection-header-right">
                        <button type="button" class="selection-action-btn delete" id="btnDeleteSelected" onclick="confirmDeleteSelected()" title="Hapus pesan terpilih">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>

                <!-- Chat Header Regular (Telegram Desktop Style) -->
                <div class="chat-header" id="chatRegularHeader">
                    <div style="display: flex; align-items: center; gap: 0.5rem; min-width: 0; flex: 1;">
                        <button type="button" class="header-icon-btn chat-mobile-back-btn" onclick="closeChat()" title="Kembali ke Daftar">
                            <i class="fa-solid fa-arrow-left"></i>
                        </button>
                        <div class="chat-header-info" onclick="toggleContactInfoPanel()" style="cursor: pointer; min-width: 0; flex: 1;" title="Klik untuk lihat info profil">
                            <div class="avatar-circle" id="chatHeaderAvatar" style="width: 40px; height: 40px; font-size: 1rem; flex-shrink: 0;">U</div>
                            <div style="min-width: 0; overflow: hidden;">
                                <div style="display: flex; align-items: center; gap: 0.45rem;">
                                    <h4 id="chatHeaderName" style="font-weight: 700; font-size: 1rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Nama Teman</h4>
                                    <span id="chatHeaderUsername" style="font-size: 0.82rem; color: var(--text-muted); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
                                    <span id="chatHeaderTags" style="display: flex; gap: 0.25rem; flex-shrink: 0;"></span>
                                </div>
                                <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.15rem; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" id="chatHeaderBio">
                                    Belum ada bio
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div style="position: relative; display: flex; align-items: center; gap: 0.4rem;">
                        <button class="header-icon-btn" id="chatHeaderMenuBtn" onclick="toggleChatHeaderMenu(event)" title="Menu opsi obrolan">
                            <i class="fa-solid fa-ellipsis-vertical"></i>
                        </button>
                        
                        <!-- Dropdown Menu Chat Header -->
                        <div class="message-context-menu" id="chatHeaderDropdown" style="right: 0; top: 44px; min-width: 170px;">
                            <button class="message-menu-item" onclick="onHeaderSelectClicked()">
                                <i class="fa-regular fa-square-check" style="color: var(--primary);"></i>
                                <span>Pilih pesan</span>
                            </button>
                            <button class="message-menu-item danger" onclick="onHeaderClearChatClicked()">
                                <i class="fa-solid fa-trash-can"></i>
                                <span>Bersihkan obrolan</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Chat Message List (Telegram bubble styling) -->
                <div class="chat-body" id="chatMessages">
                </div>

                <!-- Chat Input Bar (Exact Telegram Desktop Style with photo attach button and emoji picker) -->
                <form class="chat-input-bar" id="chatInputBar" onsubmit="handleSendMessage(event)">
                    <!-- Telegram Desktop Style Complete Emoji Picker Element -->
                    <div class="tg-emoji-picker-popover" id="tgEmojiPicker" style="display: none;">
                        <emoji-picker id="blipEmojiPickerElement" class="light"></emoji-picker>
                    </div>

                    <div class="tg-input-wrapper">
                        <button type="button" class="tg-attach-btn" id="attachPhotoBtn" onclick="triggerPhotoUpload()" title="Kirim Foto">
                            <i class="fa-solid fa-paperclip"></i>
                        </button>
                        <div class="tg-input-divider"></div>
                        <input type="file" id="chatPhotoFileInput" accept="image/jpeg,image/png,image/webp,image/gif" style="display: none;" onchange="handlePhotoSelected(event)">
                        <input type="text" id="chatInputMessage" class="chat-input" placeholder="Write a message..." autocomplete="off">
                        <div class="tg-input-actions">
                            <button type="button" class="tg-emoji-btn" id="tgEmojiToggleBtn" onclick="toggleEmojiPicker(event)" title="Pilih Emoji">
                                <i class="fa-regular fa-face-smile"></i>
                            </button>
                            <button type="submit" class="tg-send-action-btn" title="Kirim Pesan">
                                <i class="fa-regular fa-paper-plane"></i>
                            </button>
                        </div>
                    </div>
                </form>

                <!-- Floating Context Menu for Bubble -->
                <div class="message-context-menu" id="messageContextMenu">
                    <button class="message-menu-item" id="menuItemSelect" onclick="onMenuSelectClicked()">
                        <i class="fa-regular fa-square-check" style="color: var(--primary);"></i>
                        <span>Pilih pesan</span>
                    </button>
                    <button class="message-menu-item danger" id="menuItemDelete" onclick="onMenuDeleteClicked()">
                        <i class="fa-solid fa-trash-can"></i>
                        <span>Hapus pesan</span>
                    </button>
                </div>
            </div>

            <!-- Active Thread Interface (Diskusi Publik & Balasan) -->
            <div id="activeThreadInterface" style="display: none; height: 100%; flex-direction: column;">
                <!-- Header -->
                <div class="chat-header">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span class="knot-icon-mask" style="color: var(--primary); width: 24px; height: 24px; display: inline-block;"></span>
                    </div>
                    <button type="button" class="header-icon-btn" onclick="closeThreadView()" title="Tutup">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>

                <!-- Scrollable Body for Thread & Replies -->
                <div class="chat-body thread-detail-body" id="threadDetailBody">
                    <div class="thread-detail-container">
                        <div id="threadOriginalPostContainer"></div>
                        <div class="thread-replies-divider" id="threadRepliesDivider">
                            <span style="font-size: 0.85rem; font-weight: 700; color: var(--text-main);" id="threadRepliesHeaderCount">Balasan (0)</span>
                            <div style="flex: 1; height: 1px; background: var(--border-color);"></div>
                        </div>
                        <div id="threadRepliesListContainer" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
                    </div>
                </div>

                <!-- Reply Input Bar -->
                <form class="chat-input-bar thread-reply-input-bar" id="threadReplyForm" onsubmit="handleSendReply(event)">
                    <div class="thread-reply-input-wrapper" style="position: relative;">
                        <!-- Mention Autocomplete Dropdown for Reply -->
                        <div id="threadReplyMentionDropdown" class="mention-autocomplete-dropdown" style="display: none; bottom: 100%; top: auto; margin-bottom: 8px;"></div>
                        
                        <input type="text" id="threadReplyInput" class="chat-input" placeholder="Tulis balasan untuk knot ini... (ketik @ untuk mention)" autocomplete="off" maxlength="1000" required>
                        <button type="submit" class="tg-send-action-btn" title="Kirim Balasan">
                            <i class="fa-regular fa-paper-plane"></i>
                        </button>
                    </div>
                </form>
            </div>
        </main>

        <!-- 4. Fourth Column: Right Contact Info Panel (Threads Clean Style Profile - No Banner Header) -->
        <aside class="tg-info-panel" id="contactInfoPanel">
            <!-- Header Bar with Title, Options Menu, and Close Button -->
            <div class="tg-info-header" style="justify-content: space-between; flex-shrink: 0; border-bottom: 1px solid var(--border-color); padding: 0.6rem 0.85rem; height: 52px; position: relative;">
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">Info Pengguna</span>
                </div>
                <div style="display: flex; align-items: center; gap: 0.35rem; position: relative;">
                    <!-- Dropdown Button Titik Tiga (Opsi Teman ala foto) -->
                    <button type="button" class="header-icon-btn" id="btnInfoPanelMenu" onclick="toggleInfoPanelDropdownMenu(event)" title="Opsi pengguna" style="display: none;">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </button>

                    <!-- Dropdown Menu Opsi Teman -->
                    <div class="user-card-dropdown" id="infoPanelDropdownMenu" style="top: 42px; right: 35px; width: 185px;" onclick="event.stopPropagation()">
                        <button type="button" class="message-menu-item" onclick="onInfoPanelClearChatClicked()">
                            <i class="fa-solid fa-eraser" style="color: var(--primary);"></i>
                            <span>Hapus riwayat chat</span>
                        </button>
                        <button type="button" class="message-menu-item danger" onclick="onInfoPanelRemoveFriendClicked()">
                            <i class="fa-solid fa-user-xmark" style="color: var(--danger);"></i>
                            <span>Hapus teman</span>
                        </button>
                    </div>

                    <button type="button" class="header-icon-btn" onclick="toggleContactInfoPanel()" title="Tutup Info">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
            </div>

            <!-- Scrollable Content -->
            <div style="flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column;">
                <!-- Profile Area: Clean Threads Style -->
                <div class="threads-profile-header-area">
                    <div class="threads-profile-top-row">
                        <!-- Left: Avatar -->
                        <div class="threads-avatar-wrap">
                            <div class="threads-profile-avatar-img" id="infoPanelAvatar">
                                U
                            </div>
                        </div>

                        <!-- Right: Names & Username -->
                        <div class="threads-profile-info-col">
                            <h2 class="threads-display-name" id="infoPanelName">Nama Teman</h2>
                            <div class="threads-handle" id="infoPanelUsername">@username</div>
                        </div>
                    </div>

                    <!-- Bio Text (Threads Style) -->
                    <p class="threads-bio-text" id="infoPanelBio">-</p>

                    <!-- Meta Details: Location/Distance, Age, Gender -->
                    <div class="twitter-profile-meta-list" style="margin-top: 0.4rem;">
                        <div class="twitter-meta-item" id="infoPanelMetaDist">
                            <i class="fa-solid fa-location-dot" style="color: var(--primary);"></i>
                            <span id="infoPanelLocation">0 m</span>
                        </div>
                        <div class="twitter-meta-item" id="infoPanelMetaGenderWrap" style="display: none;">
                            <i class="fa-solid fa-mars-and-venus"></i>
                            <span id="infoPanelGender">-</span>
                        </div>
                        <div class="twitter-meta-item" id="infoPanelMetaAgeWrap" style="display: none;">
                            <i class="fa-solid fa-cake-candles"></i>
                            <span id="infoPanelAge">-</span>
                        </div>
                    </div>

                    <!-- Full-Width Action Button (Add Friend / Unfriend) -->
                    <div id="infoPanelAddFriendWrap" style="margin-top: 0.85rem; width: 100%;"></div>
                </div>

                <!-- Feed Postingan Knot Pengguna Langsung (Clean Threads/Twitter Style) -->
                <div style="display: flex; flex-direction: column; flex: 1;">
                    <div id="infoPanelKnotsList" class="profile-knots-container">
                        <!-- Postingan pengguna dirender di sini via JS -->
                    </div>
                </div>
            </div>
        </aside>

    </div>



    <!-- Image Lightbox Modal for P2P Photos -->
    <div class="image-lightbox-modal" id="imageLightboxModal" onclick="closeImageLightbox()">
        <div class="image-lightbox-content" onclick="event.stopPropagation()">
            <button class="image-lightbox-close" onclick="closeImageLightbox()" title="Tutup">
                <i class="fa-solid fa-xmark"></i>
            </button>
            <img id="imageLightboxImg" class="image-lightbox-img" src="" alt="Foto P2P">
        </div>
    </div>

    <!-- Modal Crop Foto Profil (Unified Blip Modal Design) -->
    <div id="avatarCropModal" class="avatar-crop-backdrop" style="display: none;">
        <div class="avatar-crop-dialog">
            <div class="blip-modal-icon primary">
                <i class="fa-solid fa-crop-simple"></i>
            </div>
            <h2 class="blip-modal-title">Sesuaikan Foto Profil</h2>
            <p class="blip-modal-desc">
                Geser dan sesuaikan foto agar pas di dalam lingkaran profil Anda.
            </p>
            
            <div class="avatar-crop-body" style="border-radius: 14px; overflow: hidden; background: #0f172a; max-height: 280px; margin-bottom: 1.25rem; padding: 0;">
                <img id="avatarCropImage" src="" alt="Crop Preview" style="max-width: 100%; display: block;">
            </div>

            <div class="blip-swal-actions" style="margin-top: 0;">
                <button type="button" class="blip-swal-cancel-btn" onclick="closeAvatarCropModal()">Batal</button>
                <button type="button" class="blip-swal-confirm-btn primary" id="btnAcceptCrop" onclick="acceptAvatarCrop()">
                    <i class="fa-solid fa-check"></i> Gunakan Foto
                </button>
            </div>
        </div>
    </div>



    <!-- Onboarding Modal: Setup Akun Awal (Nama, Username Unik, Jenis Kelamin) -->
    <div id="onboardingModal" class="onboarding-overlay" style="display: none;">
        <div class="onboarding-card">
            <div class="blip-modal-icon primary">
                <i class="fa-solid fa-user-plus"></i>
            </div>
            <h2 class="blip-modal-title">Selamat Datang di Blip!</h2>
            <p class="blip-modal-desc">
                Siapkan identitas Anda sebelum mulai terhubung dan mengobrol dengan orang di sekitar.
            </p>

            <form onsubmit="event.preventDefault(); submitOnboardingData();" style="display: flex; flex-direction: column; gap: 0.95rem; text-align: left;">
                <!-- 1. Nama Pengguna (Display Name) -->
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Nama Pengguna</label>
                        <span style="font-size: 0.72rem; color: var(--text-muted);">Boleh sama dengan orang lain</span>
                    </div>
                    <input type="text" id="onboardInputName" class="form-input" maxlength="50" placeholder="Masukkan nama panggilan..." required oninput="onOnboardingInputChange()" style="background: #ffffff; border: 1.5px solid var(--border-subtle); padding: 0.65rem 0.85rem; font-size: 0.9rem;">
                </div>

                <!-- 2. Username (Unique Handle) -->
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
                        <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">Username</label>
                        <span style="font-size: 0.72rem; color: #ef4444; font-weight: 600;">Harus unik</span>
                    </div>
                    <div class="tg-username-input-wrap" id="onboardUsernameWrap" style="background: #ffffff; border: 1.5px solid var(--border-subtle);">
                        <span class="tg-username-prefix">@</span>
                        <input type="text" id="onboardInputUsername" class="form-input tg-username-input" maxlength="25" placeholder="username" autocomplete="off" spellcheck="false" oninput="onOnboardingUsernameChange(this.value)" style="padding: 0.65rem 0.6rem 0.65rem 0.2rem; font-size: 0.9rem;">
                        <span id="onboardUsernameSpinner" style="display: none; padding-right: 0.75rem; color: var(--text-muted); font-size: 0.85rem;"><i class="fa-solid fa-spinner fa-spin"></i></span>
                    </div>
                    <div id="onboardUsernameStatus" style="font-size: 0.75rem; margin-top: 0.25rem; min-height: 18px; line-height: 1.2;"></div>
                </div>

                <!-- 3. Jenis Kelamin -->
                <div>
                    <label style="display: block; font-size: 0.85rem; font-weight: 600; color: var(--text-main); margin-bottom: 0.4rem;">
                        Jenis Kelamin
                    </label>
                    <div class="onboarding-gender-grid" style="gap: 0.75rem; margin-bottom: 0.25rem;">
                        <button type="button" class="onboarding-gender-card" id="onboardGenderMale" onclick="selectOnboardingGender('male')" style="padding: 0.85rem 0.5rem; border-radius: 12px; gap: 0.45rem;">
                            <div class="onboard-icon male" style="width: 40px; height: 40px; font-size: 1.25rem;">
                                <i class="fa-solid fa-mars"></i>
                            </div>
                            <span class="onboard-label" style="font-size: 0.88rem;">Pria</span>
                        </button>
                        <button type="button" class="onboarding-gender-card" id="onboardGenderFemale" onclick="selectOnboardingGender('female')" style="padding: 0.85rem 0.5rem; border-radius: 12px; gap: 0.45rem;">
                            <div class="onboard-icon female" style="width: 40px; height: 40px; font-size: 1.25rem;">
                                <i class="fa-solid fa-venus"></i>
                            </div>
                            <span class="onboard-label" style="font-size: 0.88rem;">Wanita</span>
                        </button>
                    </div>
                </div>

                <button type="submit" class="onboarding-submit-btn" id="btnSubmitOnboarding" disabled style="margin-top: 0.5rem;">
                    <span>Mulai Menggunakan Blip</span>
                    <i class="fa-solid fa-arrow-right"></i>
                </button>
            </form>
        </div>
    </div>

    <!-- Modal: Buat Knot Publik Baru (Simple Threads/Twitter Compose Style) -->
    <div id="createThreadModal" class="onboarding-overlay" style="display: none;" onclick="if(event.target === this) closeCreateThreadModal()">
        <div class="threads-compose-modal">
            <!-- Header bar -->
            <div class="threads-compose-header">
                <button type="button" class="threads-compose-cancel-btn" onclick="closeCreateThreadModal()">
                    <i class="fa-solid fa-xmark" style="font-size: 1.15rem;"></i>
                </button>
                <span class="threads-compose-title">Knot baru</span>
                <button type="button" class="threads-compose-submit-btn" onclick="document.getElementById('composeThreadForm').requestSubmit()">
                    Posting
                </button>
            </div>

            <form id="composeThreadForm" onsubmit="handleCreateThreadSubmit(event)" style="display: flex; flex-direction: column; flex: 1; min-height: 0;">
                <!-- Main Body: Avatar + Content Area -->
                <div class="threads-compose-body">
                    <div id="createThreadUserAvatar" class="threads-compose-avatar">
                        <!-- Rendered by JS or default placeholder -->
                        <div class="avatar-circle" style="width: 40px; height: 40px; font-size: 1rem;">U</div>
                    </div>
                    <div class="threads-compose-main">
                        <div class="threads-compose-username" id="createThreadUsername">Anda</div>
                        <div style="position: relative; width: 100%; flex: 1; display: flex; flex-direction: column;">
                            <textarea id="createThreadInputContent" class="threads-compose-textarea" rows="3" maxlength="1000" placeholder="Ada apa baru?" required oninput="updateThreadCharCounter(this.value)"></textarea>
                            
                            <!-- Mention Autocomplete Dropdown -->
                            <div id="createThreadMentionDropdown" class="mention-autocomplete-dropdown" style="display: none;"></div>
                        </div>
                    </div>
                </div>

                <!-- Footer: Attachment / Location & Counter -->
                <div class="threads-compose-footer">
                    <div class="threads-compose-meta">
                        <span id="createThreadLocationBadge" class="threads-compose-loc" title="Jarak relatif Anda">
                            <i class="fa-solid fa-location-arrow"></i> <span>Lokasi terhubung</span>
                        </span>
                        <span id="createThreadCharCounter" class="threads-compose-counter">0/1000</span>
                    </div>
                </div>
            </form>
        </div>
    </div>

    <!-- Modal: Pengguna yang Menyukai Knot (Likes List Modal via Reusable Component) -->
    <x-modal
        id="threadLikesModal"
        title="Disukai oleh"
        maxWidth="380px"
        onClose="closeThreadLikesModal()"
    >
        <div class="thread-likes-list" id="threadLikesListContainer" style="max-height: 380px; overflow-y: auto;">
            <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted); font-size: 0.85rem;">
                <i class="fa-solid fa-spinner fa-spin"></i> Memuat daftar...
            </div>
        </div>
    </x-modal>

    <script>
        window.BLIP_CONFIG = {
            reverbKey: "{{ env('REVERB_APP_KEY', 'blip-key') }}",
            reverbHost: "{{ env('VITE_REVERB_HOST', '127.0.0.1') }}",
            reverbPort: {{ env('VITE_REVERB_PORT', 8088) }}
        };
    </script>
    <script src="{{ asset('js/app.js') }}?v={{ time() }}"></script>
</body>
</html>
