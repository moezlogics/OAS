// Web app manifests: what phones and computers use when the app is installed.
// Built on request so the app name follows the office name in Settings.
const db = require('./db');

const ICONS = [
  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
];
const shortcutIcon = [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }];

function manifest(kind) {
  const office = db.getSettings().office_name || 'Office';
  const base = {
    lang: 'en',
    dir: 'ltr',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    background_color: '#f3f4f7',
    theme_color: '#2b4acb',
    categories: ['business', 'productivity'],
    prefer_related_applications: false,
    icons: ICONS
  };
  if (kind === 'admin') {
    return {
      ...base,
      id: '/admin',
      name: `${office} Admin`,
      short_name: 'Admin',
      description: 'Attendance, fines, requests and reports for the admin.',
      start_url: '/admin#dashboard',
      scope: '/admin',
      shortcuts: [
        { name: 'Requests', url: '/admin#requests', icons: shortcutIcon },
        { name: 'Attendance', url: '/admin#attendance', icons: shortcutIcon },
        { name: 'Fines', url: '/admin#fines', icons: shortcutIcon }
      ]
    };
  }
  return {
    ...base,
    id: '/',
    name: `${office} Attendance`,
    short_name: 'Attendance',
    description: 'Check in, see your fines and send leave requests.',
    start_url: '/#home',
    scope: '/',
    orientation: 'portrait',
    shortcuts: [
      { name: 'Check in', url: '/#home', icons: shortcutIcon },
      { name: 'Send a request', url: '/#requests', icons: shortcutIcon },
      { name: 'My history', url: '/#history', icons: shortcutIcon }
    ]
  };
}

module.exports = { manifest };
