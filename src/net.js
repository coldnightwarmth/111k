// WebSocket client with reconnect/backoff, heartbeats and latest-pose-only
// sending. Ported from the cards.art showroom client.
const POSE_BUFFER_LIMIT = 64 * 1024;
const POSE_RETRY_MS = 100;
const HEARTBEAT_MS = 25000;
const PONG_TIMEOUT_MS = 15000;

export function connectRoom({url, onState, onPose, onLeave, onChat, onStatus, onItem, onPunch, onMessage}) {
  // the session lives as long as the tab: a refresh reconnects as the same player
  let session = null;
  try { session = sessionStorage.getItem('111k:session'); } catch {}
  if (!/^[a-f0-9-]{36}$/.test(session || '')) {
    session = crypto.randomUUID();
    try { sessionStorage.setItem('111k:session', session); } catch {}
  }
  let id = null, socket, closed = false, delay = 1000, offset = 0, synchronized = false;
  let reconnectTimer, poseTimer, pongTimer, queuedPose = null, lastActivity = 0;

  function clearConnectionWork() {
    clearTimeout(poseTimer); poseTimer = undefined; queuedPose = null;
    clearTimeout(pongTimer); pongTimer = undefined; synchronized = false;
  }
  function retry() {
    if (closed || reconnectTimer !== undefined) return;
    onStatus('reconnecting');
    // Spread reconnects after an outage instead of waking the entire room together.
    const wait = delay * (0.8 + Math.random() * 0.4);
    delay = Math.min(delay * 1.5, 15000);
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, wait);
  }
  function disconnect(current) {
    if (closed || current !== socket) return;
    clearConnectionWork();
    socket = undefined;
    try { current.close(); } catch {}
    retry();
  }
  function transmit(data) {
    if (closed || socket?.readyState !== 1) return false;
    const current = socket;
    try { current.send(data); return true; } catch { disconnect(current); return false; }
  }
  function flushPose(force = false) {
    clearTimeout(poseTimer); poseTimer = undefined;
    if (!queuedPose || closed || socket?.readyState !== 1) return;
    if (!force && socket.bufferedAmount > POSE_BUFFER_LIMIT) { poseTimer = setTimeout(() => flushPose(), POSE_RETRY_MS); return; }
    const data = queuedPose; queuedPose = null; transmit(data);
  }
  function heartbeat() {
    if (closed || socket?.readyState !== 1 || pongTimer !== undefined) return;
    const current = socket;
    if (!transmit('ping')) return;
    pongTimer = setTimeout(() => {
      pongTimer = undefined;
      // Background tabs can suspend timers; only treat a missing pong as fatal while visible.
      if (!document.hidden) disconnect(current);
    }, PONG_TIMEOUT_MS);
  }
  function visibility() { if (document.hidden) return; clearTimeout(pongTimer); pongTimer = undefined; heartbeat(); }
  function connect() {
    if (closed) return;
    onStatus('connecting');
    let current;
    try { current = new WebSocket(`${url}?session=${session}`); } catch { retry(); return; }
    socket = current;
    current.onmessage = event => {
      if (closed || current !== socket) return;
      if (event.data === 'pong') { clearTimeout(pongTimer); pongTimer = undefined; return; }
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'welcome') { id = m.id; offset = m.now - Date.now(); }
      else if (m.type === 'state') {
        offset = m.now - Date.now(); delay = 1000;
        if (!synchronized) { synchronized = true; onStatus('online'); }
        onState(m);
      }
      else if (m.type === 'pose') onPose(m);
      else if (m.type === 'leave') onLeave(m.id);
      else if (m.type === 'chat') onChat(m);
      else if (m.type === 'item') onItem?.(m.item, m.fall, m.path, m.refused === true);
      else if (m.type === 'punch') onPunch?.(m);
      else onMessage?.(m);
    };
    current.onclose = () => disconnect(current);
    current.onerror = () => disconnect(current);
  }
  function activity(event) {
    if (!event.isTrusted || document.hidden || Date.now() - lastActivity < 10000) return;
    lastActivity = Date.now(); transmit(JSON.stringify({type: 'activity'}));
  }
  const activityEvents = ['pointerdown', 'keydown', 'wheel'];
  for (const type of activityEvents) addEventListener(type, activity, {passive: true});
  document.addEventListener('visibilitychange', visibility);
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
  connect();

  return {
    get id() { return id; },
    get online() { return !closed && socket?.readyState === 1 && synchronized; },
    now: () => Date.now() + offset,
    sendPose(pose) {
      if (closed || socket?.readyState !== 1) return;
      // Poses describe current state: keep only the latest while a connection drains.
      queuedPose = JSON.stringify({type: 'pose', pose}); flushPose();
    },
    sendChat(text) {
      if (closed || socket?.readyState !== 1) return false;
      flushPose(true); return transmit(JSON.stringify({type: 'chat', text}));
    },
    send(msg) {
      if (closed || socket?.readyState !== 1) return false;
      flushPose(true); return transmit(JSON.stringify(msg));
    },
    close() {
      if (closed) return;
      closed = true;
      for (const type of activityEvents) removeEventListener(type, activity);
      document.removeEventListener('visibilitychange', visibility);
      clearInterval(heartbeatTimer); clearTimeout(reconnectTimer);
      clearConnectionWork();
      try { socket?.close(); } catch {}
    },
  };
}
