/** DSH-local draw.io configuration. No cloud or external service is required. */
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null;
window.DRAWIO_BASE_URL = null;
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = null;
window.DRAWIO_CONFIG = {
  compressXml: false,
  enableCssDarkMode: true,
  defaultLibraries: 'general;uml;er;bpmn;flowchart;basic;arrows2',
  enabledLibraries: null
};
urlParams['sync'] = 'manual';
urlParams['offline'] = '1';
urlParams['local'] = '1';
urlParams['plugins'] = '0';

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function(regs) {
    for (var i = 0; i < regs.length; i++) regs[i].unregister();
  }).catch(function() {});
}
