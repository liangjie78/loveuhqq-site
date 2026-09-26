import { clearPassphraseUnlock, isPassphraseUnlocked, savePassphraseUnlock, verifyPassphrase } from '../lib/passphrase';

const gate = document.querySelector<HTMLElement>('#passphrase-gate');
const card = document.querySelector<HTMLElement>('#passphrase-card');
const form = document.querySelector<HTMLFormElement>('#passphrase-form');
const input = document.querySelector<HTMLInputElement>('#passphrase-input');
const errorMsg = document.querySelector<HTMLElement>('#passphrase-error');
const remember = document.querySelector<HTMLInputElement>('#passphrase-remember');

document.querySelectorAll<HTMLElement>('[data-lock-site]').forEach((btn) => {
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    clearPassphraseUnlock();
    window.location.reload();
  });
});

if (gate && card && form && input && errorMsg && remember) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (isPassphraseUnlocked()) {
    document.documentElement.classList.remove('is-locked');
    gate.hidden = true;
  } else {
    document.documentElement.classList.add('is-locked');
    gate.hidden = false;
    window.setTimeout(() => input.focus(), 50);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value;
    const isValid = await verifyPassphrase(value);

    if (isValid) {
      errorMsg.hidden = true;
      input.removeAttribute('aria-invalid');
      savePassphraseUnlock(remember.checked);

      if (reducedMotion.matches) {
        document.documentElement.classList.remove('is-locked');
        gate.hidden = true;
        (document.querySelector<HTMLElement>('#album-main') ?? document.querySelector<HTMLElement>('main'))?.focus();
      } else {
        card.classList.add('is-unlocking');
        window.setTimeout(() => {
          document.documentElement.classList.remove('is-locked');
          gate.hidden = true;
          card.classList.remove('is-unlocking');
          (document.querySelector<HTMLElement>('#album-main') ?? document.querySelector<HTMLElement>('main'))?.focus();
        }, 300);
      }
    } else {
      errorMsg.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      card.classList.remove('is-shaking');
      // Trigger reflow to restart shake animation
      void card.offsetWidth;
      card.classList.add('is-shaking');
      input.select();
    }
  });

  card.addEventListener('animationend', (event) => {
    if (event.animationName === 'gentle-shake') {
      card.classList.remove('is-shaking');
    }
  });

  // Focus trap inside gate dialog while locked
  gate.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = card.querySelectorAll<HTMLElement>(
      'input:not([disabled]), button:not([disabled]), a[href]'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
