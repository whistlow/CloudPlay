// CloudPlay page script. Runs at document start on xbox.com and applies the app's settings.
// window.__CP_CFG is prepended by the app.
(function () {
  if (window.__cpInstalled) return;
  if (!/(^|\.)xbox\.com$/.test(location.hostname)) return;
  window.__cpInstalled = true;

  var C = window.__CP_CFG || {};
  // With the Better xCloud engine on, it handles stream quality, region, stats and its own
  // touch layouts, so CloudPlay leaves those alone and only adds rumble, clarity and overlays.
  var BX = C.engine === 'betterxcloud';
  var OS_NAMES = { '720p': 'android', '1080p': 'windows', '1080p_hq': 'tizen' };
  var H264_PROFILES = { h264_high: '64', h264_main: '4d', h264_baseline: '42' };

  function native() { return window.CloudPlayNative; }

  // Look like regular Chrome rather than an in-app WebView (some Xbox features check this).
  try {
    var uad = navigator.userAgentData;
    if (uad && uad.brands && uad.brands.some(function (b) { return /webview/i.test(b.brand); })) {
      var ver = (navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || '130';
      var brands = [{ brand: 'Chromium', version: ver }, { brand: 'Google Chrome', version: ver },
        { brand: 'Not?A_Brand', version: '99' }];
      var fake = {
        brands: brands, mobile: uad.mobile, platform: uad.platform,
        getHighEntropyValues: function (hints) {
          return uad.getHighEntropyValues(hints).then(function (r) {
            r.brands = brands;
            if (r.fullVersionList) {
              var full = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || ver;
              r.fullVersionList = brands.map(function (b) { return { brand: b.brand, version: b.brand.indexOf('Not') === 0 ? '99.0.0.0' : full }; });
            }
            return r;
          });
        },
        toJSON: function () { return { brands: brands, mobile: uad.mobile, platform: uad.platform }; }
      };
      Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: function () { return fake; } });
    }
  } catch (e) {}
  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  // ================================================================== fetch
  var origFetch = window.fetch;

  async function readBody(input, init) {
    if (init && init.body != null) return typeof init.body === 'string' ? init.body : null;
    if (typeof Request !== 'undefined' && input instanceof Request && input.method === 'POST') {
      try { return await input.clone().text(); } catch (e) {}
    }
    return null;
  }

  function withBody(input, init, body) {
    if (init && init.body != null) return [input, Object.assign({}, init, { body: body })];
    return [new Request(input, { body: body }), init];
  }

  // ------------------------------------------------------------ Remote Play
  // Console streaming ("xhome"). Approach adapted from Better xCloud (MIT, redphx):
  // report a desktop browser, and add the console's own addresses as ICE candidates
  // so the stream can connect directly to the Xbox.
  var consoleAddrs = {};

  function isXhome(url) {
    return url.indexOf('/sessions/home') >= 0 || url.indexOf('xhome.') >= 0 ||
      (location.pathname.indexOf('/play/consoles/launch/') >= 0 && /\/inputconfigs$/.test(url.split('?')[0]));
  }

  function deviceInfo() {
    var os = OS_NAMES[C.resolution] || 'windows';
    return JSON.stringify({
      appInfo: { env: { clientAppId: location.host, clientAppType: 'browser', clientAppVersion: '26.1.97',
        clientSdkVersion: '10.3.7', httpEnvironment: 'prod', sdkInstallId: '' } },
      dev: {
        os: { name: os, ver: '22631.2715', platform: 'desktop' },
        hw: { make: 'Microsoft', model: 'unknown', sdktype: 'web' },
        browser: { browserName: 'chrome', browserVersion: '140.0.3485.54' },
        displayInfo: { dimensions: { widthInPixels: 4096, heightInPixels: 2160 }, pixelDensity: { dpiX: 1, dpiY: 1 } }
      }
    });
  }

  function patchCandidates(list) {
    var re = /a=candidate:(\d+) (\d+) UDP (\d+) ([^\s]+) (\d+) (.*)/;
    var out = [], n = 1;
    function cand(c) { return { candidate: c, messageType: 'iceCandidate', sdpMLineIndex: '0', sdpMid: '0' }; }
    list.forEach(function (item) {
      var m = re.exec(item.candidate || '');
      if (!m) return;
      out.push(cand('a=candidate:' + n + ' 1 UDP ' + (n === 1 ? 2130706431 : 1) + ' ' + m[4] + ' ' + m[5] + ' ' + m[6]));
      n++;
    });
    Object.keys(consoleAddrs).forEach(function (ip) {
      consoleAddrs[ip].forEach(function (port) {
        out.push(cand('a=candidate:' + (out.length + 1) + ' 1 UDP 1 ' + ip + ' ' + port + ' typ host'));
      });
    });
    out.push(cand('a=end-of-candidates'));
    return out;
  }

  function jsonResponse(res, obj) {
    var h = new Headers(res.headers);
    h.delete('content-length');
    h.delete('content-encoding');
    return new Response(JSON.stringify(obj), { status: res.status, statusText: res.statusText, headers: h });
  }

  async function handleXhome(input, init, url, path) {
    var req = new Request(input, init);
    var headers = new Headers(req.headers);
    headers.set('x-ms-device-info', deviceInfo());
    var opts = { method: req.method, headers: headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') opts.body = await req.clone().text();
    var res = await origFetch(new Request(url, opts));

    try {
      if (url.indexOf('/configuration') >= 0 && res.ok) {
        var cfg = await res.clone().json(), d = cfg.serverDetails || {};
        consoleAddrs = {};
        [['ipAddress', 'port'], ['ipV4Address', 'ipV4Port'], ['ipV6Address', 'ipV6Port']].forEach(function (p) {
          if (!d[p[0]]) return;
          var ports = [];
          if (d[p[1]]) ports.push(d[p[1]]);
          if (ports.indexOf(9002) < 0) ports.push(9002);
          consoleAddrs[d[p[0]]] = ports;
        });
      } else if (/\/ice$/.test(path) && req.method === 'GET' && res.ok) {
        var text = await res.clone().text();
        if (text.length) {
          var obj = JSON.parse(text);
          obj.exchangeResponse = JSON.stringify(patchCandidates(JSON.parse(obj.exchangeResponse)));
          return jsonResponse(res, obj);
        }
      }
    } catch (e) {}
    return res;
  }

  if (!BX) window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var path = url.split('?')[0];

    if (isXhome(url)) return handleXhome(input, init, url, path);

    // Stream resolution for cloud games and Remote Play: the server picks quality
    // from the client's reported OS.
    if (/\/sessions\/cloud\/play$/.test(path) && OS_NAMES[C.resolution]) {
      try {
        var raw = await readBody(input, init);
        if (raw) {
          var b = JSON.parse(raw);
          b.settings = b.settings || {};
          b.settings.osName = OS_NAMES[C.resolution];
          var r = withBody(input, init, JSON.stringify(b));
          input = r[0]; init = r[1];
        }
      } catch (e) {}
    }

    var res = await origFetch.call(this, input, init);

    // Server regions: remember the list, and make the chosen one the default.
    if (/\/v2\/login\/user/.test(path)) {
      try {
        var j = await res.clone().json();
        var regions = j && j.offeringSettings && j.offeringSettings.regions;
        if (regions && regions.length) {
          try { native() && native().setRegions(JSON.stringify(regions.map(function (x) { return x.name; }))); } catch (e) {}
          if (C.region && C.region !== 'auto' && regions.some(function (x) { return x.name === C.region; })) {
            regions.forEach(function (x) { x.isDefault = x.name === C.region; });
            var h = new Headers(res.headers);
            h.delete('content-length');
            h.delete('content-encoding');
            return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers: h });
          }
        }
      } catch (e) {}
    }
    return res;
  };

  // ================================================================= WebRTC
  var pcs = [];
  var PC = window.RTCPeerConnection;

  function streaming() {
    return pcs.some(function (p) { return p.connectionState === 'connected'; });
  }

  function applyCodec(pc) {
    var want = H264_PROFILES[C.codec];
    if (!want || !window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
    var caps = RTCRtpReceiver.getCapabilities('video');
    if (!caps) return;
    function score(c) {
      if (c.mimeType.toLowerCase() !== 'video/h264') return 0;
      return (c.sdpFmtpLine || '').toLowerCase().indexOf('profile-level-id=' + want) >= 0 ? 2 : 1;
    }
    var codecs = caps.codecs.slice().sort(function (a, b) { return score(b) - score(a); });
    if (score(codecs[0]) < 2) return; // device can't decode that profile
    pc.getTransceivers().forEach(function (t) {
      if (t.receiver && t.receiver.track && t.receiver.track.kind === 'video' && t.setCodecPreferences) {
        try { t.setCodecPreferences(codecs); } catch (e) {}
      }
    });
  }

  function limitBitrate(sdp) {
    var kbps = parseInt(C.maxBitrate, 10) || 0;
    if (!kbps) return sdp;
    var lines = sdp.split('\r\n'), out = [], inVideo = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.indexOf('m=') === 0) inVideo = l.indexOf('m=video') === 0;
      if (inVideo && l.indexOf('b=AS:') === 0) continue;
      out.push(l);
      if (inVideo && l.indexOf('c=') === 0) out.push('b=AS:' + kbps);
    }
    return out.join('\r\n');
  }

  if (PC && PC.prototype.createOffer) {
    var origCreateOffer = PC.prototype.createOffer;
    PC.prototype.createOffer = async function () {
      if (pcs.indexOf(this) < 0) pcs.push(this); // used to know when a stream is live
      if (!BX) { try { applyCodec(this); } catch (e) {} }
      var offer = await origCreateOffer.apply(this, arguments);
      if (!BX) {
        try {
          if (offer && offer.sdp) offer = { type: offer.type, sdp: limitBitrate(offer.sdp) };
        } catch (e) {}
      }
      return offer;
    };
  }

  // ========================================================= clarity boost
  // Two algorithms: a 3x3 sharpen kernel, and an unsharp mask (blur + subtract).
  function applyVideoStyle() {
    var old = document.getElementById('cp-style'); if (old) old.remove();
    var oldSvg = document.getElementById('cp-svg'); if (oldSvg) oldSvg.remove();

    var filters = [];
    var lvl = parseInt(C.sharpness, 10) || 0;
    if (lvl > 0) {
      var f;
      if (C.clarityAlgo === 'unsharp') {
        var a = lvl * 0.18;
        f = '<feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="b"/>' +
          '<feComposite in="SourceGraphic" in2="b" operator="arithmetic" k1="0" k2="' + (1 + a).toFixed(3) +
          '" k3="-' + a.toFixed(3) + '" k4="0"/>';
      } else {
        var k = (lvl * 0.06).toFixed(3), c = (1 + 4 * lvl * 0.06).toFixed(3);
        f = '<feConvolveMatrix order="3" preserveAlpha="true" kernelMatrix="0 -' + k + ' 0 -' + k + ' ' + c +
          ' -' + k + ' 0 -' + k + ' 0"/>';
      }
      var holder = document.createElement('div');
      holder.innerHTML = '<svg id="cp-svg" width="0" height="0" style="position:absolute">' +
        '<filter id="cp-sharpen" color-interpolation-filters="sRGB">' + f + '</filter></svg>';
      document.body.appendChild(holder.firstChild);
      filters.push('url(#cp-sharpen)');
    }
    if (C.saturation && C.saturation !== 100) filters.push('saturate(' + C.saturation / 100 + ')');
    if (C.contrast && C.contrast !== 100) filters.push('contrast(' + C.contrast / 100 + ')');
    if (C.brightness && C.brightness !== 100) filters.push('brightness(' + C.brightness / 100 + ')');

    var style = document.createElement('style');
    style.id = 'cp-style';
    style.textContent = 'video{' + (BX ? '' : 'object-fit:' + (C.videoFit || 'contain') + ' !important;') +
      (filters.length ? 'filter:' + filters.join(' ') + ' !important;' : '') + '}' +
      'html,body{overscroll-behavior:none;}';
    document.head.appendChild(style);
  }
  onReady(applyVideoStyle);

  // Called by the app to switch clarity presets live, without reloading.
  window.__cpSetVideo = function (v) {
    Object.assign(C, v || {});
    onReady(applyVideoStyle);
  };

  // ================================================================= rumble
  var rumbleOn = !!(C.rumble && C.rumble !== 'off');
  var actuator = {
    type: 'dual-rumble',
    effects: ['dual-rumble', 'trigger-rumble'],
    canPlayEffectType: function (t) { return t === 'dual-rumble' || t === 'trigger-rumble'; },
    playEffect: function (type, p) {
      p = p || {};
      var d = Math.max(0, p.duration || 0), delay = Math.max(0, p.startDelay || 0);
      var s = p.strongMagnitude || 0, w = p.weakMagnitude || 0;
      if (type === 'trigger-rumble') {
        s = Math.max(s, p.leftTrigger || 0);
        w = Math.max(w, p.rightTrigger || 0);
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          try { native() && native().rumble(Math.round(d), s, w); } catch (e) {}
          setTimeout(function () { resolve('complete'); }, d);
        }, delay);
      });
    },
    reset: function () {
      try { native() && native().stopRumble(); } catch (e) {}
      return Promise.resolve('complete');
    }
  };

  // ========================================================= touch controls
  var touchOn = C.touchMode === 'always' || (C.touchMode === 'auto' && !BX);
  var VPAD_ID = 'CloudPlay Touch Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)';
  var vpad = {
    id: VPAD_ID, index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator, hapticActuators: []
  };
  for (var bi = 0; bi < 17; bi++) vpad.buttons.push({ pressed: false, touched: false, value: 0 });
  var vpadActive = false;

  function press(i, down) {
    var b = vpad.buttons[i];
    b.pressed = b.touched = down;
    b.value = down ? 1 : 0;
    vpad.timestamp = performance.now();
  }
  function setAxis(i, v) { vpad.axes[i] = v; vpad.timestamp = performance.now(); }
  function releaseAll() {
    for (var i = 0; i < vpad.buttons.length; i++) press(i, false);
    for (var a = 0; a < 4; a++) setAxis(a, 0);
  }

  // ======================================================= gamepad plumbing
  var nav = navigator;
  var origGetGamepads = nav.getGamepads ? nav.getGamepads.bind(nav) : null;

  function realPads() {
    var list = origGetGamepads ? origGetGamepads() : [];
    var out = [];
    for (var i = 0; i < list.length; i++) out.push(list[i] || null);
    return out;
  }
  function realPadConnected() {
    return realPads().some(function (p) { return p && p.connected; });
  }

  if (origGetGamepads && (rumbleOn || touchOn)) {
    Object.defineProperty(nav, 'getGamepads', {
      configurable: true,
      value: function () {
        var list = realPads().map(function (gp) {
          if (!gp || !rumbleOn) return gp;
          return {
            id: gp.id, index: gp.index, connected: gp.connected, mapping: gp.mapping,
            timestamp: gp.timestamp, axes: gp.axes, buttons: gp.buttons,
            vibrationActuator: actuator, hapticActuators: []
          };
        });
        if (vpadActive) {
          var slot = list.indexOf(null);
          if (slot < 0) slot = list.length;
          vpad.index = slot;
          list[slot] = vpad;
        }
        return list;
      }
    });
  }

  function announce(type) {
    try {
      var ev = new Event(type);
      Object.defineProperty(ev, 'gamepad', { value: vpad });
      window.dispatchEvent(ev);
    } catch (e) {}
  }

  // ======================================================== touch overlay UI
  var DEFAULT_LAYOUT = {
    ls:   { x: 12, y: 66, s: 30 },
    dpad: { x: 29, y: 84, s: 22 },
    rs:   { x: 72, y: 82, s: 24 },
    abxy: { x: 88, y: 62, s: 32 },
    lt:   { x: 7,  y: 11, s: 10 },
    lb:   { x: 7,  y: 27, s: 10 },
    rt:   { x: 93, y: 11, s: 10 },
    rb:   { x: 93, y: 27, s: 10 },
    view: { x: 42, y: 9,  s: 8 },
    menu: { x: 58, y: 9,  s: 8 },
    l3:   { x: 25, y: 52, s: 8 },
    r3:   { x: 60, y: 70, s: 8 }
  };
  var BUTTONS = {
    lt: [6, 'LT'], lb: [4, 'LB'], rt: [7, 'RT'], rb: [5, 'RB'],
    view: [8, '⧉'], menu: [9, '≡'], l3: [10, 'LS'], r3: [11, 'RS']
  };

  function loadLayout() {
    var l = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    try {
      var saved = C.touchLayout ? JSON.parse(C.touchLayout) : null;
      if (saved) Object.keys(l).forEach(function (k) { if (saved[k]) l[k] = saved[k]; });
    } catch (e) {}
    return l;
  }

  var layout = loadLayout();
  var root = null, els = {}, editing = false, forceShow = null, selected = null, toolbar = null;
  var scale = (C.touchSize || 100) / 100;

  function css(el, s) { el.style.cssText = s; return el; }
  function div(cls, text) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function placeAll() {
    Object.keys(els).forEach(function (k) {
      var L = layout[k], el = els[k], size = L.s * scale;
      el.style.left = L.x + 'vw';
      el.style.top = L.y + 'vh';
      el.style.width = el.style.height = size + 'vh';
      el.style.fontSize = (size * 0.32) + 'vh';
      el.classList.toggle('cp-sel', editing && selected === k);
    });
  }

  function buildOverlay() {
    root = div('cp-touch');
    var st = document.createElement('style');
    st.textContent =
      '.cp-touch{position:fixed;inset:0;z-index:2147483646;pointer-events:none;touch-action:none;' +
      'user-select:none;-webkit-user-select:none;opacity:' + ((C.touchOpacity || 60) / 100) + ';display:none}' +
      '.cp-touch.cp-edit{opacity:1;background:rgba(0,0,0,.35)}' +
      '.cp-c{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;touch-action:none;' +
      'font-family:system-ui,sans-serif;font-weight:700;color:#fff}' +
      '.cp-btn{border-radius:50%;border:2px solid rgba(255,255,255,.75);background:rgba(20,20,20,.45);' +
      'display:flex;align-items:center;justify-content:center}' +
      '.cp-btn.cp-on,.cp-face.cp-on{background:rgba(255,255,255,.55)}' +
      '.cp-stick{border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(20,20,20,.35)}' +
      '.cp-knob{position:absolute;left:50%;top:50%;width:44%;height:44%;margin:-22% 0 0 -22%;border-radius:50%;' +
      'background:rgba(255,255,255,.6)}' +
      '.cp-face{position:absolute;width:34%;height:34%;border-radius:50%;border:2px solid currentColor;' +
      'background:rgba(20,20,20,.45);display:flex;align-items:center;justify-content:center;transform:translate(-50%,-50%)}' +
      '.cp-dpad{background:none}' +
      '.cp-arm{position:absolute;background:rgba(20,20,20,.5);border:2px solid rgba(255,255,255,.7);border-radius:6px}' +
      '.cp-arm.cp-on{background:rgba(255,255,255,.55)}' +
      '.cp-sel{outline:3px dashed #16c60c;outline-offset:4px}' +
      '.cp-bar{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:8px;' +
      'align-items:center;background:rgba(0,0,0,.85);color:#fff;padding:8px 12px;border-radius:10px;' +
      'font:14px system-ui,sans-serif;pointer-events:auto}' +
      '.cp-bar button{font:inherit;color:#fff;background:#107c10;border:0;border-radius:6px;padding:6px 12px}';
    root.appendChild(st);

    // Sticks
    ['ls', 'rs'].forEach(function (k) {
      var el = div('cp-c cp-stick'), knob = div('cp-knob');
      el.appendChild(knob);
      var ax = k === 'ls' ? 0 : 2;
      stickHandler(el, knob, ax);
      els[k] = el;
    });

    // D-pad: four arms
    var dp = div('cp-c cp-dpad'), arms = {};
    [['up', 12, 'left:33%;top:0;width:34%;height:40%'], ['down', 13, 'left:33%;bottom:0;width:34%;height:40%'],
     ['left', 14, 'left:0;top:33%;width:40%;height:34%'], ['right', 15, 'right:0;top:33%;width:40%;height:34%']]
      .forEach(function (a) { var arm = css(div('cp-arm'), a[2]); arm.dataset.i = a[1]; arms[a[1]] = arm; dp.appendChild(arm); });
    dpadHandler(dp, arms);
    els.dpad = dp;

    // Face buttons
    var face = div('cp-c');
    [['Y', 3, '50%', '17%', '#f5c400'], ['X', 2, '17%', '50%', '#2f8cff'],
     ['B', 1, '83%', '50%', '#ff4d4d'], ['A', 0, '50%', '83%', '#3ad03a']].forEach(function (f) {
      var b = css(div('cp-face', f[0]), 'left:' + f[2] + ';top:' + f[3] + ';color:' + f[4]);
      buttonHandler(b, f[1]);
      face.appendChild(b);
    });
    els.abxy = face;

    // Shoulders, triggers, View/Menu, stick clicks
    Object.keys(BUTTONS).forEach(function (k) {
      var b = div('cp-c cp-btn', BUTTONS[k][1]);
      buttonHandler(b, BUTTONS[k][0]);
      els[k] = b;
    });

    Object.keys(els).forEach(function (k) { els[k].dataset.key = k; editHandler(els[k], k); root.appendChild(els[k]); });
    document.documentElement.appendChild(root);
    placeAll();
  }

  function buttonHandler(el, idx) {
    el.addEventListener('pointerdown', function (e) {
      if (editing) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      press(idx, true); el.classList.add('cp-on');
    });
    var up = function (e) { if (editing) return; press(idx, false); el.classList.remove('cp-on'); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function stickHandler(el, knob, ax) {
    var id = null;
    function move(e) {
      var r = el.getBoundingClientRect(), rad = r.width / 2;
      var dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1) { dx /= len; dy /= len; }
      setAxis(ax, dx); setAxis(ax + 1, dy);
      knob.style.transform = 'translate(' + (dx * 70) + '%,' + (dy * 70) + '%)';
    }
    el.addEventListener('pointerdown', function (e) {
      if (editing) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (x) {}
      move(e);
    });
    el.addEventListener('pointermove', function (e) { if (!editing && e.pointerId === id) move(e); });
    var up = function (e) {
      if (e.pointerId !== id) return;
      id = null; setAxis(ax, 0); setAxis(ax + 1, 0); knob.style.transform = '';
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function dpadHandler(el, arms) {
    var id = null;
    function set(dirs) {
      [12, 13, 14, 15].forEach(function (i) {
        var on = dirs.indexOf(i) >= 0;
        if (vpad.buttons[i].pressed !== on) press(i, on);
        arms[i].classList.toggle('cp-on', on);
      });
    }
    function move(e) {
      var r = el.getBoundingClientRect(), rad = r.width / 2;
      var dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad, t = 0.3, d = [];
      if (dy < -t) d.push(12); if (dy > t) d.push(13);
      if (dx < -t) d.push(14); if (dx > t) d.push(15);
      set(d);
    }
    el.addEventListener('pointerdown', function (e) {
      if (editing) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId;
      try { el.setPointerCapture(id); } catch (x) {}
      move(e);
    });
    el.addEventListener('pointermove', function (e) { if (!editing && e.pointerId === id) move(e); });
    var up = function (e) { if (e.pointerId === id) { id = null; set([]); } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function editHandler(el, k) {
    var start = null;
    el.addEventListener('pointerdown', function (e) {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      selected = k;
      start = { px: e.clientX, py: e.clientY, x: layout[k].x, y: layout[k].y };
      placeAll();
    }, true);
    el.addEventListener('pointermove', function (e) {
      if (!editing || !start) return;
      layout[k].x = Math.max(0, Math.min(100, start.x + (e.clientX - start.px) * 100 / innerWidth));
      layout[k].y = Math.max(0, Math.min(100, start.y + (e.clientY - start.py) * 100 / innerHeight));
      placeAll();
    }, true);
    var up = function () { start = null; };
    el.addEventListener('pointerup', up, true);
    el.addEventListener('pointercancel', up, true);
  }

  function showToolbar() {
    toolbar = div('cp-bar');
    var label = div(null, 'Drag to move. Tap a control, then resize:');
    function btn(text, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      toolbar.appendChild(b);
    }
    toolbar.appendChild(label);
    btn('−', function () { if (selected) { layout[selected].s = Math.max(4, layout[selected].s * 0.9); placeAll(); } });
    btn('+', function () { if (selected) { layout[selected].s = Math.min(60, layout[selected].s * 1.1); placeAll(); } });
    btn('Reset', function () { layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT)); placeAll(); });
    btn('Done', function () { window.__cpTouch.editDone(); });
    document.documentElement.appendChild(toolbar);
  }

  function computeVisible() {
    if (editing) return true;
    if (forceShow !== null) return forceShow && streaming();
    if (!touchOn || !streaming()) return false;
    if (C.touchMode === 'always') return true;
    return !realPadConnected();
  }

  function tick() {
    if (!root) return;
    var vis = computeVisible();
    root.style.display = vis ? 'block' : 'none';
    var active = vis && !editing;
    if (active !== vpadActive) {
      vpadActive = active;
      if (!active) releaseAll();
      announce(active ? 'gamepadconnected' : 'gamepaddisconnected');
    }
  }

  // Opens Better xCloud's own settings dialog (via its header button).
  window.__cpOpenBx = function () {
    var b = document.querySelector('.bx-header-settings-button');
    if (b) { b.classList.remove('bx-gone'); b.click(); return 'ok'; }
    return 'missing';
  };

  window.__cpTouch = {
    toggle: function () { forceShow = !computeVisible(); tick(); },
    edit: function () {
      if (!root) return;
      editing = true; selected = null;
      root.classList.add('cp-edit');
      releaseAll();
      showToolbar();
      placeAll(); tick();
    },
    editDone: function () {
      editing = false; selected = null;
      root.classList.remove('cp-edit');
      if (toolbar) { toolbar.remove(); toolbar = null; }
      placeAll(); tick();
      try { native() && native().saveTouchLayout(JSON.stringify(layout)); } catch (e) {}
    }
  };

  onReady(function () {
    buildOverlay();
    setInterval(tick, 400);
  });

  // ============================================================ stats panel
  if (C.showStats && !BX) {
    var el = null, prev = {};
    setInterval(async function () {
      var pc = pcs.filter(function (p) { return p.connectionState === 'connected'; }).pop();
      if (!pc) { if (el) el.style.display = 'none'; prev = {}; return; }
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:fixed;top:6px;left:6px;z-index:2147483647;background:rgba(0,0,0,.6);' +
          'color:#fff;font:12px/1.4 monospace;padding:4px 8px;border-radius:6px;pointer-events:none;white-space:pre';
        document.documentElement.appendChild(el);
      }
      var stats = await pc.getStats(), v = null, pair = null, codecs = {};
      stats.forEach(function (r) {
        if (r.type === 'inbound-rtp' && r.kind === 'video') v = r;
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r;
        if (r.type === 'codec') codecs[r.id] = r;
      });
      if (!v) return;
      var mbps = '-', loss = '-', dec = '-';
      if (prev.ts) {
        mbps = ((v.bytesReceived - prev.bytes) * 8 / ((v.timestamp - prev.ts) / 1000) / 1e6).toFixed(1);
        var lost = (v.packetsLost || 0) - prev.lost, got = v.packetsReceived - prev.recv;
        loss = lost + got > 0 ? (Math.max(lost, 0) * 100 / (lost + got)).toFixed(1) : '0.0';
        if (v.framesDecoded > prev.frames) {
          dec = ((v.totalDecodeTime - prev.decode) * 1000 / (v.framesDecoded - prev.frames)).toFixed(1);
        }
      }
      prev = { ts: v.timestamp, bytes: v.bytesReceived, lost: v.packetsLost || 0, recv: v.packetsReceived,
        frames: v.framesDecoded || 0, decode: v.totalDecodeTime || 0 };
      var codec = v.codecId && codecs[v.codecId] ? codecs[v.codecId].mimeType.replace('video/', '') : '';
      var ping = pair && pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) + ' ms' : '-';
      el.textContent = (v.frameWidth || '?') + 'x' + (v.frameHeight || '?') + ' ' + codec + '  ' +
        Math.round(v.framesPerSecond || 0) + ' fps\n' +
        'Ping ' + ping + '  ' + mbps + ' Mbps  Loss ' + loss + '%  Decode ' + dec + ' ms';
      el.style.display = 'block';
    }, 1000);
  }
})();
