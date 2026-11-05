@props([
    'id',
    'title' => null,
    'onClose' => null,
    'maxWidth' => '460px',
    'closeOnClickOutside' => true,
    'headerClose' => true,
])

<div
    id="{{ $id }}"
    class="onboarding-overlay"
    style="display: none;"
    @if($closeOnClickOutside && $onClose)
        onclick="if(event.target === this) {{ $onClose }}"
    @endif
    {{ $attributes }}
>
    <div class="blip-reusable-modal-dialog" style="max-width: {{ $maxWidth }};" onclick="event.stopPropagation()">
        @if($title || $headerClose)
            <div class="blip-reusable-modal-header">
                <span class="blip-reusable-modal-title" id="{{ $id }}Title">{{ $title }}</span>
                @if($headerClose && $onClose)
                    <button type="button" class="header-icon-btn" onclick="{{ $onClose }}" title="Tutup">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                @endif
            </div>
        @endif

        <div class="blip-reusable-modal-body">
            {{ $slot }}
        </div>
    </div>
</div>

