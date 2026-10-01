import { clearPassphraseUnlock, isPassphraseUnlocked, savePassphraseUnlock, verifyPassphrase } from '../lib/passphrase';

const root = document.documentElement;
const gate = document.querySelector<HTMLElement>('[data-gate]');
const slotRow = gate?.querySelector<HTMLElement>('.gate-slots');
const form = gate?.querySelector<HTMLFormElement>('[data-gate-form]');
const input = gate?.querySelector<HTMLInputElement>('[data-gate-input]');
const error = gate?.querySelector<HTMLElement>('[data-gate-error]');
const remember = gate?.querySelector<HTMLInputElement>('[data-gate-remember]');
const slots = gate ? [...gate.querySelectorAll<HTMLElement>('[data-slot]')] : [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const CODE_LENGTH = 4;

document.querySelectorAll<HTMLElement>('[data-lock-site]').forEach((button) => {
  button.addEventListener('click', () => {
    clearPassphraseUnlock();
    window.scrollTo(0, 0);
    window.location.reload();
  });
});

/** Everything outside the gate is inert while it is shown. */
function setPageInert(inert: boolean) {
  for (const element of document.body.children) {
    if (element !== gate && element instanceof HTMLElement) element.inert = inert;
  }
}

if (gate && slotRow && form && input && error && remember) {
  // Tells the <head> fail-safe that this bundle is alive. A locked page keeps
  // `is-locked` on purpose; only a bundle that never ran is released by the timer.
  root.classList.add('gate-ready');
  let checking = false;
  let clearTimer: number | undefined;

  const renderSlots = () => {
    const focused = document.activeElement === input;
    slots.forEach((slot, index) => {
      slot.textContent = input.value[index] ?? '';
      slot.classList.toggle('is-filled', index < input.value.length);
      slot.classList.toggle('is-active', focused && index === Math.min(input.value.length, CODE_LENGTH - 1));
    });
    form.classList.toggle('is-complete', input.value.length === CODE_LENGTH);
  };

  const unlock = () => {
    savePassphraseUnlock(remember.checked);
    setPageInert(false);
    root.classList.remove('is-locked');
    document.dispatchEvent(new CustomEvent('gate:open'));
    document.querySelector<HTMLElement>('#main')?.focus({ preventScroll: true });

    if (reducedMotion.matches) return;
    gate.classList.add('is-leaving');
    window.setTimeout(() => gate.classList.remove('is-leaving'), 900);
  };

  const reject = () => {
    error.textContent = '好像不对，再想想。';
    input.setAttribute('aria-invalid', 'true');
    slotRow.classList.remove('is-shaking');
    void slotRow.offsetWidth;
    slotRow.classList.add('is-shaking');
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(() => {
      input.value = '';
      renderSlots();
    }, 650);
  };

  if (isPassphraseUnlocked()) {
    root.classList.remove('is-locked');
  } else {
    root.classList.add('is-locked');
    setPageInert(true);
    window.setTimeout(() => input.focus({ preventScroll: true }), 80);
  }

  input.addEventListener('input', () => {
    window.clearTimeout(clearTimer);
    input.value = input.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    renderSlots();
    if (input.value.length === CODE_LENGTH) form.requestSubmit();
  });
  input.addEventListener('focus', renderSlots);
  input.addEventListener('blur', renderSlots);
  // Keep the caret at the end so the slots always mirror the typed order.
  input.addEventListener('select', () => {
    const end = input.value.length;
    if (input.selectionStart !== end) input.setSelectionRange(end, end);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (checking) return;
    if (input.value.length < CODE_LENGTH) {
      error.textContent = '还差几位数字。';
      input.focus();
      return;
    }
    checking = true;
    const valid = await verifyPassphrase(input.value);
    checking = false;
    if (valid) unlock();
    else reject();
  });

  slotRow.addEventListener('animationend', (event) => {
    if (event.target === slotRow) slotRow.classList.remove('is-shaking');
  });

  renderSlots();
}
