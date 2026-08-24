/**
 * Shared handler for every "Get Early Access" CTA. Always scrolls to the
 * waitlist section, even when the URL already has the `#waitlist` hash —
 * relying on native hash-anchor navigation only fires once per hash, so
 * repeat clicks would otherwise do nothing.
 */
export function scrollToWaitlist(e: React.MouseEvent) {
  const waitlist = document.getElementById('waitlist');
  if (waitlist) {
    e.preventDefault();
    waitlist.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
