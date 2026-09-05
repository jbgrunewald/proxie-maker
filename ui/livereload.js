// Dev convenience: reload the page when the front-end changes, or when the
// server comes back after a `npm run dev` restart. Inert if the endpoint is
// unreachable — EventSource just keeps retrying quietly.
(() => {
  let connectedBefore = false;

  const es = new EventSource('/api/livereload');

  es.addEventListener('open', () => {
    // A reconnect means the process restarted under us, so the code the page is
    // running is stale. The first open is just startup.
    if (connectedBefore) location.reload();
    connectedBefore = true;
  });

  es.addEventListener('message', () => location.reload());
})();
