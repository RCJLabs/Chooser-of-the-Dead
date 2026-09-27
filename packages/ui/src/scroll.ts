/*
 * Where the page is as the player moves through the game (docs/tech-spec.md §30). A new screen, or a
 * new part of one (a scene, then what follows it), opens at its top; after a choice in a scene, the
 * lines it brought start at the top of the view. Nothing focused for the keyboard scrolls the page on
 * its own: focus is always given with `preventScroll`.
 */

/** Scrolls the window to its top, at once, and a shift crowded enough to scroll on its own (a short phone's). */
export function toTop(): void {
  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  document.querySelector('.shift')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
}

/** Brings an element to the top of the view, at once (its `scroll-margin-top` leaves a little room). */
export function toTopOf(el: Element | null | undefined): void {
  el?.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
}
