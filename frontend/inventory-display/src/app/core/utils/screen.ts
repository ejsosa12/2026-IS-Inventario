import { DestroyRef, inject, Signal, signal } from '@angular/core';

// HU-19: below Tailwind's "md" breakpoint (768 px) the app shows the phone view
const PHONE_QUERY = '(max-width: 767px)';

// Call it in a field initializer: readonly isPhone = injectIsPhone();
// It updates when the window is resized or the phone is rotated.
export function injectIsPhone(): Signal<boolean> {
  // jsdom (unit tests) has no matchMedia: count as a computer
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return signal(false).asReadonly();
  }
  const query = window.matchMedia(PHONE_QUERY);
  const isPhone = signal(query.matches);
  const listener = (event: MediaQueryListEvent) => isPhone.set(event.matches);
  query.addEventListener('change', listener);
  inject(DestroyRef).onDestroy(() => query.removeEventListener('change', listener));
  return isPhone.asReadonly();
}
