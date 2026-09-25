// Loader for the checked STARS Three.js/WebXR application.
// Source is split into text fragments only to keep the GitHub connector writes
// reviewable; the browser assembles the exact module before importing it.
const parts = [
  './src/app-01.jsfrag',
  './src/app-02.jsfrag',
  './src/app-03.jsfrag',
  './src/app-04.jsfrag',
  './src/app-05.jsfrag'
];

try {
  const responses = await Promise.all(parts.map((path) => fetch(path)));
  for (const response of responses) {
    if (!response.ok) throw new Error(`Failed to load ${response.url}`);
  }
  const source = (await Promise.all(responses.map((response) => response.text()))).join('\n');
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
} catch (error) {
  console.error(error);
  const status = document.getElementById('statusText');
  const badge = document.getElementById('engineBadge');
  if (status) status.textContent = 'Application failed to initialise: ' + error.message;
  if (badge) badge.textContent = 'Load failed';
}
