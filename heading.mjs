import './v41-enhancements.mjs';

// Bearings are clockwise from north. Never infer a bearing from GPS drift.
export const normalizeHeading = value => Number.isFinite(value) ? ((value % 360) + 360) % 360 : null;
export function compassReading(event, screenAngle = 0, now = Date.now()) {
  let bearing = null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    if (Number.isFinite(event.webkitCompassAccuracy) && (event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 30)) return null;
    bearing = event.webkitCompassHeading;
  } else if (event.absolute === true && Number.isFinite(event.alpha) && Number.isFinite(event.beta) && Number.isFinite(event.gamma) && Math.abs(event.beta) < 45 && Math.abs(event.gamma) < 45) {
    bearing = 360 - event.alpha;
  }
  return bearing === null ? null : { bearing: normalizeHeading(bearing + screenAngle), timestamp: now, source: 'compass' };
}
export function chooseHeading(fix, compass, now = Date.now()) {
  if (!fix || !Number.isFinite(fix.timestamp) || now - fix.timestamp > 20000 || fix.timestamp > now + 1000 || !Number.isFinite(fix.coords.accuracy) || fix.coords.accuracy > 50) return null;
  const c = fix.coords;
  if (now - fix.timestamp <= 10000 && Number.isFinite(c.heading) && Number.isFinite(c.speed) && c.speed >= 0.7 && c.heading >= 0 && c.heading < 360 && c.accuracy >= 0 && c.accuracy <= 30) return { bearing: normalizeHeading(c.heading), source: 'course' };
  if (compass && now >= compass.timestamp && now - compass.timestamp <= 3000 && Number.isFinite(compass.bearing)) return compass;
  return null;
}
export function destination(point, bearing, metres = 20) {
  const rad = Math.PI / 180, lat = point[1] * rad, lon = point[0] * rad, b = bearing * rad, d = metres / 6371000;
  const y = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
  const x = lon + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(y));
  return [((x / rad + 540) % 360) - 180, y / rad];
}
export function drawHeadingCone(ctx, origin, target) {
  if (![...origin, ...target].every(Number.isFinite)) return;
  const angle = Math.atan2(target[1] - origin[1], target[0] - origin[0]);
  ctx.save(); ctx.translate(...origin); ctx.rotate(angle);
  const fill = ctx.createRadialGradient(0, 0, 5, 0, 0, 65);
  fill.addColorStop(0, '#4285f4aa'); fill.addColorStop(1, '#4285f400');
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 65, -0.48, 0.48); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.restore();
}

// iOS PWA: keep the activity sheet outside transformed/scrolled map containers.
// A fixed element inside those containers can otherwise become clipped or behave
// like a half-screen panel. Portalling it beside the bottom nav makes viewport
// positioning deterministic across Safari/PWA safe-area changes.
function installActivityPortal() {
  let panel = null;
  const syncVisibility = (view) => {
    if (!panel) return;
    const mapVisible = view ? view === 'map' : !document.getElementById('mapView')?.classList.contains('hide');
    panel.hidden = !mapVisible;
  };
  const portal = (candidate) => {
    if (!candidate || candidate.dataset.activityPortal === 'body') return false;
    panel = candidate;
    const nav = document.querySelector('body > nav');
    if (nav) document.body.insertBefore(panel, nav);
    else document.body.append(panel);
    panel.dataset.activityPortal = 'body';
    syncVisibility();
    return true;
  };
  if (!portal(document.querySelector('.activity-panel'))) {
    const observer = new MutationObserver(() => {
      if (portal(document.querySelector('.activity-panel'))) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  window.addEventListener('trail:view', event => syncVisibility(event.detail));
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installActivityPortal, { once: true });
  else queueMicrotask(installActivityPortal);
}
