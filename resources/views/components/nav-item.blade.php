@props([
    'id',
    'label',
    'icon' => null,
    'customIcon' => null,
    'active' => false,
    'badgeId' => null,
    'title' => null,
    'onclick' => null,
])

<button
    type="button"
    id="{{ $id }}"
    class="tg-nav-btn {{ $active ? 'active' : '' }}"
    @if($onclick) onclick="{{ $onclick }}" @endif
    title="{{ $title ?? $label }}"
    {{ $attributes }}
>
    @if($customIcon)
        <span class="{{ $customIcon }}"></span>
    @elseif($icon)
        <i class="{{ $icon }}"></i>
    @endif
    <span class="tg-nav-label">{{ $label }}</span>
    @if($badgeId)
        <span class="badge-count" id="{{ $badgeId }}" style="display:none;">0</span>
    @endif
</button>

