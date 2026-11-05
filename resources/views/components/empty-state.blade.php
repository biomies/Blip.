@props([
    'id' => null,
    'icon' => 'fa-regular fa-comment-dots',
    'customIcon' => null,
    'title' => 'Belum Ada Data',
    'description' => null,
])

<div @if($id) id="{{ $id }}" @endif class="profile-empty-knots" {{ $attributes }}>
    @if($customIcon)
        <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--item-active); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.5rem;">
            <span class="{{ $customIcon }}" style="font-size: 2rem; color: var(--primary);"></span>
        </div>
    @elseif($icon)
        <i class="{{ $icon }}"></i>
    @endif
    <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main);">{{ $title }}</span>
    @if($description)
        <p style="font-size: 0.82rem; margin: 0; line-height: 1.4; max-width: 280px; text-align: center;">{{ $description }}</p>
    @endif
    {{ $slot }}
</div>

