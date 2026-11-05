@props([
    'variant' => 'ghost', // ghost, primary, danger
    'size' => 'md',       // sm, md, lg
    'icon' => null,
    'type' => 'button',
])

@php
    $sizeClass = match($size) {
        'sm' => 'sm',
        'lg' => 'lg',
        default => '',
    };

    $variantClass = match($variant) {
        'primary' => 'primary',
        'danger' => 'danger',
        default => '',
    };
@endphp

<button
    type="{{ $type }}"
    {{ $attributes->merge(['class' => "btn-icon $variantClass $sizeClass"]) }}
>
    @if($icon)
        <i class="{{ $icon }}"></i>
    @endif
    {{ $slot }}
</button>
