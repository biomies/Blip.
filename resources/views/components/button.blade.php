@props([
    'variant' => 'primary', // primary, outline, danger, ghost
    'size' => 'md',        // sm, md, lg
    'icon' => null,
    'type' => 'button',
])

@php
    $sizeClass = match($size) {
        'sm' => 'btn-sm',
        'lg' => 'btn-lg',
        default => '',
    };

    $variantClass = match($variant) {
        'primary' => 'btn-primary',
        'outline' => 'btn-outline',
        'danger' => 'btn-danger',
        'ghost' => 'btn-ghost',
        default => 'btn-primary',
    };
@endphp

<button
    type="{{ $type }}"
    {{ $attributes->merge(['class' => "btn $variantClass $sizeClass"]) }}
>
    @if($icon)
        <i class="{{ $icon }}"></i>
    @endif
    {{ $slot }}
</button>
