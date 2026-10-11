self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window' }).then(windows => {
    const current = windows.find(window => window.url.startsWith(self.registration.scope));
    return current ? current.focus() : clients.openWindow(self.registration.scope);
  }));
});
