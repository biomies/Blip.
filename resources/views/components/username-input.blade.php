@props([
    'id',
    'value' => '',
    'placeholder' => 'username',
    'statusId' => null,
    'required' => true,
    'minlength' => 3,
    'maxlength' => 25,
])

<div class="form-group" {{ $attributes }}>
    <label style="display: flex; justify-content: space-between; align-items: center;">
        <span>Username</span>
        <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">Huruf, angka, _ ({{ $minlength }}-{{ $maxlength }} karakter)</span>
    </label>
    <div class="tg-username-input-wrap">
        <span class="tg-username-prefix">@</span>
        <input
            type="text"
            id="{{ $id }}"
            class="form-input tg-username-input"
            placeholder="{{ $placeholder }}"
            value="{{ $value }}"
            autocomplete="off"
            spellcheck="false"
            @if($required) required @endif
            minlength="{{ $minlength }}"
            maxlength="{{ $maxlength }}"
            {{ $attributes->merge(['class' => 'form-input tg-username-input']) }}
        >
    </div>
    @if($statusId)
        <div id="{{ $statusId }}" style="font-size: 0.75rem; margin-top: 5px; min-height: 18px;"></div>
    @endif
</div>

