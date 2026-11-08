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

  // Keep the Xbox website looking exactly like Microsoft's: the advanced engine only adds
  // settings. Applied once per install (and to existing installs on update); everything
  // stays changeable in Settings afterwards.
  if (BX) {
    try {
      if (!localStorage.getItem('cp.stockUi.v1')) {
        var cur = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
        var stock = {
          'ui.layout': 'default',
          'ui.theme': 'default',
          'ui.hideSections': [],
          'ui.gameCard.waitTime.show': false,
          'ui.controllerStatus.show': false,
          'ui.hideScrollbar': false,
          'ui.reduceAnimations': false,
          'ui.splashVideo.skip': false,
          'ui.streamMenu.simplify': false,
          'loadingScreen.gameArt.show': false,
          'loadingScreen.waitTime.show': false,
          'loadingScreen.rocket': 'show'
        };
        Object.keys(stock).forEach(function (k) { cur[k] = stock[k]; });
        if (!('stream.video.resolution' in cur)) cur['stream.video.resolution'] = '1080p';
        if (!('block.tracking' in cur)) cur['block.tracking'] = true;
        localStorage.setItem('BetterXcloud', JSON.stringify(cur));
        localStorage.setItem('cp.stockUi.v1', '1');
      }
    } catch (e) {}
    // Its own header buttons are replaced by the settings gear next to Search.
    onReady(function () {
      var st = document.createElement('style');
      st.textContent = '.bx-header-settings-button,.bx-header-remote-play-button{display:none !important}';
      document.head.appendChild(st);
    });
  }

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
  var VPAD_ID = 'Touch Controller (STANDARD GAMEPAD Vendor: 045e Product: 02ea)';
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
  // Controllers come from two places: WebView's own Gamepad API (not on every device),
  // and the app's native bridge, which reads controllers straight from Android.
  var nav = navigator;
  var origGetGamepads = nav.getGamepads ? nav.getGamepads.bind(nav) : null;
  var inputMode = C.controllerInput || 'auto';

  function realPads() {
    var out = [];
    if (!origGetGamepads || inputMode === 'bridge') return out;
    try {
      var list = origGetGamepads() || [];
      for (var i = 0; i < list.length; i++) out.push(list[i] || null);
    } catch (e) {}
    return out;
  }

  var bridgeVer = -1, bridgeObjs = {};
  function bridgePads() {
    var n = native();
    if (inputMode === 'webview' || !n || !n.padVersion) return bridgeObjs;
    var v = n.padVersion();
    if (v === bridgeVer) return bridgeObjs;
    bridgeVer = v;
    var arr;
    try { arr = JSON.parse(n.padState()); } catch (e) { return bridgeObjs; }
    var seen = {};
    arr.forEach(function (p) {
      var o = bridgeObjs[p.i], isNew = !o;
      if (!o) {
        o = bridgeObjs[p.i] = {
          id: p.id, index: p.i, connected: true, mapping: 'standard', timestamp: performance.now(),
          axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator, hapticActuators: [], _t: -1
        };
        for (var k = 0; k < 17; k++) o.buttons.push({ pressed: false, touched: false, value: 0 });
      }
      if (o._t !== p.t) {
        o._t = p.t;
        o.timestamp = performance.now();
        for (var b = 0; b < 17; b++) {
          var val = p.b[b] || 0, btn = o.buttons[b];
          btn.value = val;
          btn.pressed = btn.touched = val > 0.12;
        }
        for (var a = 0; a < 4; a++) o.axes[a] = p.a[a] || 0;
      }
      seen[p.i] = 1;
      if (isNew) announce('gamepadconnected', o);
    });
    Object.keys(bridgeObjs).forEach(function (k) {
      if (!seen[k]) {
        var o = bridgeObjs[k];
        o.connected = false;
        delete bridgeObjs[k];
        announce('gamepaddisconnected', o);
      }
    });
    return bridgeObjs;
  }

  function realPadConnected() {
    return Object.keys(bridgePads()).length > 0 || realPads().some(function (p) { return p && p.connected; });
  }

  Object.defineProperty(nav, 'getGamepads', {
    configurable: true,
    value: function () {
      var list = [null, null, null, null];
      var bp = bridgePads(), bridged = Object.keys(bp);
      if (bridged.length) {
        bridged.forEach(function (k) { list[k] = bp[k]; });
      } else {
        realPads().forEach(function (gp, i) {
          if (!gp) return;
          // Keep the real Gamepad object; only attach the app's rumble to it.
          if (rumbleOn) {
            try { Object.defineProperty(gp, 'vibrationActuator', { configurable: true, value: actuator }); } catch (e) {}
          }
          list[i] = gp;
        });
      }
      if (menuOpen) {
        return list.map(function (gp) { return gp ? neutral(gp) : null; });
      }
      if (vpadActive) {
        var slot = list.indexOf(null);
        if (slot < 0) slot = list.length;
        vpad.index = slot;
        list[slot] = vpad;
      }
      return list;
    }
  });

  var menuOpen = false, neutralCache = {};
  function neutral(gp) {
    var n = neutralCache[gp.index];
    if (!n) {
      n = neutralCache[gp.index] = { id: gp.id, index: gp.index, connected: true, mapping: 'standard',
        timestamp: performance.now(), axes: [0, 0, 0, 0], buttons: [], vibrationActuator: actuator, hapticActuators: [] };
      for (var k = 0; k < 17; k++) n.buttons.push({ pressed: false, touched: false, value: 0 });
    }
    return n;
  }
  // Raw controller state for the settings panel (bypasses the neutral copies above).
  function rawPads() {
    var bp = bridgePads(), keys = Object.keys(bp);
    if (keys.length) return keys.map(function (k) { return bp[k]; });
    return realPads().filter(function (p) { return p; });
  }

  function announce(type, pad) {
    try {
      var ev = new Event(type);
      Object.defineProperty(ev, 'gamepad', { value: pad || vpad });
      window.dispatchEvent(ev);
    } catch (e) {}
  }

  // Pick up newly connected controllers even before the page starts polling.
  setInterval(bridgePads, 500);

  // ========================================================== quick access
  // Tell the app when a game is streaming (it hides the floating gear then).
  var lastStreaming = null;
  setInterval(function () {
    var on = streaming();
    if (on !== lastStreaming) {
      lastStreaming = on;
      try { native() && native().setStreaming(on); } catch (e) {}
    }
  }, 700);

  // Put an "App settings" button at the top of Better xCloud's settings,
  // in place of its "install the Android app" link.
  if (BX) onReady(function () {
    new MutationObserver(function () {
      var top = document.querySelector('.bx-top-buttons');
      if (!top || top.querySelector('.cp-app-settings')) return;
      var ad = top.querySelector('a[href*="better-xcloud.github.io/android"]');
      if (ad) ad.remove();
      var b = document.createElement('button');
      b.className = 'bx-button bx-full-width bx-focusable cp-app-settings';
      b.tabIndex = 0;
      var span = document.createElement('span');
      span.textContent = '\u2699\uFE0F  App settings';
      b.appendChild(span);
      b.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        try { native() && native().openSettings(); } catch (x) {}
      });
      top.insertBefore(b, top.firstChild);
    }).observe(document.documentElement, { childList: true, subtree: true });
  });

  // ================================================================ settings
  // A gear in the Xbox header (cloned from the site's own Search button so it matches),
  // opening a panel styled like the site's Settings screen.
  var GEAR_PATH = 'M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z';
  var SVGNS = 'http://www.w3.org/2000/svg';

  function gearSvg(like) {
    var svg = document.createElementNS(SVGNS, 'svg');
    if (like) {
      ['class', 'width', 'height', 'style', 'aria-hidden'].forEach(function (a) {
        var v = like.getAttribute(a); if (v != null) svg.setAttribute(a, v);
      });
    } else {
      svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
    }
    svg.setAttribute('viewBox', '0 0 24 24');
    var path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', GEAR_PATH);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function findSearchButton() {
    var cands = document.querySelectorAll('a[href*="/search"], button[aria-label*="earch"], a[aria-label*="earch"]');
    for (var i = 0; i < cands.length; i++) {
      var r = cands[i].getBoundingClientRect();
      if (r.width > 0 && r.top < 160 && !cands[i].closest('.cpm-backdrop')) return cands[i];
    }
    return null;
  }

  var headerReported = null;
  function ensureHeaderGear() {
    var existing = document.querySelector('.cp-header-gear');
    var search = findSearchButton();
    if (!existing && search) {
      var btn = search.cloneNode(true);
      btn.classList.add('cp-header-gear');
      btn.removeAttribute('href');
      btn.removeAttribute('id');
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('aria-label', 'Settings');
      btn.setAttribute('title', 'Settings');
      var oldSvg = btn.querySelector('svg');
      if (oldSvg) oldSvg.parentNode.replaceChild(gearSvg(oldSvg), oldSvg);
      else btn.appendChild(gearSvg(null));
      btn.querySelectorAll('span').forEach(function (sp) { if (!sp.querySelector('svg')) sp.textContent = ''; });
      btn.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation(); window.__cpMenu.open();
      }, true);
      search.parentNode.insertBefore(btn, search);
      existing = btn;
    }
    var present = !!(existing && existing.isConnected && existing.getBoundingClientRect().width > 0);
    if (present !== headerReported) {
      headerReported = present;
      try { native() && native().setHeaderButton(present); } catch (e) {}
    }
  }
  onReady(function () { setInterval(ensureHeaderGear, 800); ensureHeaderGear(); });

  var CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLARITY = [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['vivid', 'Vivid'], ['custom', 'Custom']];

  function remotePlayUrl() {
    var m = location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//i);
    return 'https://www.xbox.com/' + (m ? m[1] : 'en-US') + '/play/consoles';
  }

  var menuEl = null, rows = [], focusIdx = 0, page = 'main', padTimer = null;

  function mainItems() {
    var preset = (CLARITY.filter(function (c) { return c[0] === (C.clarityPreset || 'off'); })[0] || CLARITY[0])[1];
    var items = [
      { label: 'App settings', sub: 'Stream quality, controls, rumble, performance', go: function () { close(); native() && native().openSettings(); } }
    ];
    if (BX) items.push({ label: 'Advanced settings', sub: 'Upscaling, stats, server, mouse & keyboard', go: function () {
      close(); setTimeout(function () { if (window.__cpOpenBx && __cpOpenBx() !== 'ok') toast('Sign in to use advanced settings'); }, 60);
    } });
    items.push(
      { label: 'Remote Play', sub: 'Play games installed on your Xbox console', go: function () { close(); location.href = remotePlayUrl(); } },
      { label: 'Clarity boost', detail: preset, go: function () { render('clarity'); } },
      { label: 'Touch controls', sub: 'Show or hide on-screen buttons', go: function () { close(); window.__cpTouch && __cpTouch.toggle(); } },
      { label: 'Edit touch layout', go: function () { close(); window.__cpTouch && __cpTouch.edit(); } },
      { label: 'Reload', go: function () { location.reload(); } },
      { label: 'Exit', go: function () { native() && native().exitApp(); } }
    );
    return items;
  }

  function clarityItems() {
    return CLARITY.map(function (c) {
      return { label: c[1], check: (C.clarityPreset || 'off') === c[0], go: function () {
        C.clarityPreset = c[0];
        try { native() && native().setClarity(c[0]); } catch (e) {}
        render('clarity', focusIdx);
      } };
    });
  }

  function injectMenuStyle() {
    if (document.getElementById('cpm-style')) return;
    var st = document.createElement('style');
    st.id = 'cpm-style';
    st.textContent =
      '.cpm-backdrop{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.35);font-family:inherit;-webkit-font-smoothing:antialiased;animation:cpmFade .15s ease-out}' +
      '.cpm{width:min(92vw,1180px);height:min(88vh,680px);box-sizing:border-box;padding:3.2vh 3.4vw;color:#fff;' +
      'background:rgba(52,55,82,.78);-webkit-backdrop-filter:blur(28px) saturate(150%);backdrop-filter:blur(28px) saturate(150%);' +
      'border-radius:6px;box-shadow:0 24px 80px rgba(0,0,0,.45);display:flex;flex-direction:column;animation:cpmPop .18s ease-out}' +
      '.cpm-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:2.6vh}' +
      '.cpm-title{font-size:22px;font-weight:600;letter-spacing:.2px;display:flex;align-items:center;gap:14px}' +
      '.cpm-back,.cpm-close{background:none;border:0;color:#fff;padding:8px;border-radius:50%;cursor:pointer;display:flex}' +
      '.cpm-back:hover,.cpm-close:hover{background:rgba(255,255,255,.12)}' +
      '.cpm-list{overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:2px;scrollbar-width:none}' +
      '.cpm-row{display:flex;align-items:center;gap:16px;min-height:48px;padding:8px 18px;border-radius:6px;cursor:pointer;' +
      'font-size:16px;font-weight:500;transition:background .12s}' +
      '.cpm-row .cpm-txt{display:flex;flex-direction:column;gap:2px}' +
      '.cpm-row .cpm-sub{font-size:12.5px;font-weight:400;color:rgba(255,255,255,.68)}' +
      '.cpm-row .cpm-detail{margin-left:auto;font-size:14px;font-weight:400;color:rgba(255,255,255,.75)}' +
      '.cpm-row .cpm-end{margin-left:auto;display:flex;align-items:center;opacity:.9}' +
      '.cpm-row .cpm-detail + .cpm-end{margin-left:10px}' +
      '.cpm-row.cpm-focus,.cpm-row:hover{background:rgba(196,200,255,.30)}' +
      '.cpm-row.cpm-focus{box-shadow:0 0 0 2px rgba(255,255,255,.85) inset}' +
      '.cpm-hint{margin-top:auto;padding-top:2vh;font-size:12.5px;color:rgba(255,255,255,.55)}' +
      '.cp-toast{position:fixed;left:50%;bottom:8vh;transform:translateX(-50%);z-index:2147483647;background:rgba(30,30,30,.92);' +
      'color:#fff;padding:10px 18px;border-radius:6px;font:14px system-ui,sans-serif}' +
      '@keyframes cpmFade{from{opacity:0}to{opacity:1}}@keyframes cpmPop{from{transform:scale(.98);opacity:.6}to{transform:none;opacity:1}}';
    document.head.appendChild(st);
  }

  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'cp-toast'; t.textContent = msg;
    document.documentElement.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function setFocus(i) {
    if (!rows.length) return;
    focusIdx = (i + rows.length) % rows.length;
    rows.forEach(function (r, k) { r.classList.toggle('cpm-focus', k === focusIdx); });
    rows[focusIdx].scrollIntoView({ block: 'nearest' });
  }

  function render(which, keepFocus) {
    page = which;
    var box = menuEl.querySelector('.cpm');
    box.innerHTML = '';
    var head = document.createElement('div'); head.className = 'cpm-head';
    var title = document.createElement('div'); title.className = 'cpm-title';
    if (which !== 'main') {
      var back = document.createElement('button'); back.className = 'cpm-back'; back.setAttribute('aria-label', 'Back');
      back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      back.onclick = function () { render('main'); };
      title.appendChild(back);
    }
    title.appendChild(document.createTextNode(which === 'main' ? 'Settings' : 'Clarity boost'));
    var x = document.createElement('button'); x.className = 'cpm-close'; x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    x.onclick = close;
    head.appendChild(title); head.appendChild(x); box.appendChild(head);

    var list = document.createElement('div'); list.className = 'cpm-list';
    var items = which === 'main' ? mainItems() : clarityItems();
    rows = items.map(function (it, k) {
      var r = document.createElement('div'); r.className = 'cpm-row';
      var txt = document.createElement('div'); txt.className = 'cpm-txt';
      var l = document.createElement('div'); l.textContent = it.label; txt.appendChild(l);
      if (it.sub) { var sb = document.createElement('div'); sb.className = 'cpm-sub'; sb.textContent = it.sub; txt.appendChild(sb); }
      r.appendChild(txt);
      if (it.detail) { var d = document.createElement('div'); d.className = 'cpm-detail'; d.textContent = it.detail; r.appendChild(d); }
      var end = document.createElement('div'); end.className = 'cpm-end';
      end.innerHTML = it.check ? CHECK : (it.check === false ? '' : CHEVRON);
      r.appendChild(end);
      r.addEventListener('click', function (e) { e.stopPropagation(); it.go(); });
      r.addEventListener('mouseenter', function () { setFocus(k); });
      if (it.check) r._checked = true;
      r._go = it.go;
      list.appendChild(r);
      return r;
    });
    box.appendChild(list);
    var hint = document.createElement('div'); hint.className = 'cpm-hint';
    hint.textContent = which === 'main' ? '\u24B6 Select    \u24B7 Close' : '\u24B6 Select    \u24B7 Back';
    box.appendChild(hint);
    var checked = rows.findIndex(function (r) { return r._checked; });
    setFocus(keepFocus != null ? keepFocus : Math.max(0, checked));
  }

  function goBackOrClose() { if (page !== 'main') render('main'); else close(); }

  // Controller navigation for the panel (D-pad / left stick, A, B), with key repeat.
  function startPadNav() {
    var prev = {}, holdDir = 0, nextRepeat = 0;
    padTimer = setInterval(function () {
      var pads = rawPads(), b = {}, dir = 0;
      pads.forEach(function (p) {
        if (!p || !p.buttons) return;
        [0, 1, 12, 13].forEach(function (i) { if (p.buttons[i] && p.buttons[i].pressed) b[i] = true; });
        var ay = p.axes && p.axes[1] || 0;
        if (ay < -0.6) b[12] = true; if (ay > 0.6) b[13] = true;
      });
      if (b[12]) dir = -1; else if (b[13]) dir = 1;
      var now = performance.now();
      if (dir && (dir !== holdDir || now >= nextRepeat)) {
        nextRepeat = now + (dir !== holdDir ? 380 : 110);
        setFocus(focusIdx + dir);
      }
      holdDir = dir;
      if (b[0] && !prev[0] && rows[focusIdx]) rows[focusIdx]._go();
      if (b[1] && !prev[1]) goBackOrClose();
      prev = b;
    }, 16);
  }

  function onKey(e) {
    if (!menuEl) return;
    var k = e.key;
    if (k === 'ArrowDown') setFocus(focusIdx + 1);
    else if (k === 'ArrowUp') setFocus(focusIdx - 1);
    else if (k === 'Enter' || k === ' ') { if (rows[focusIdx]) rows[focusIdx]._go(); }
    else if (k === 'Escape' || k === 'Backspace') goBackOrClose();
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  function open() {
    if (menuEl) return;
    injectMenuStyle();
    menuOpen = true;
    menuEl = document.createElement('div'); menuEl.className = 'cpm-backdrop';
    var font = document.body ? getComputedStyle(document.body).fontFamily : '';
    menuEl.style.fontFamily = (font && !/^(serif|"?Times)/i.test(font) ? font + ',' : '') +
      '"Segoe UI","Segoe UI Variable",Roboto,system-ui,sans-serif';
    var box = document.createElement('div'); box.className = 'cpm';
    box.addEventListener('click', function (e) { e.stopPropagation(); });
    menuEl.appendChild(box);
    menuEl.addEventListener('click', close);
    document.documentElement.appendChild(menuEl);
    window.addEventListener('keydown', onKey, true);
    render('main');
    // Ignore the button press that opened the panel.
    setTimeout(startPadNav, 250);
  }

  function close() {
    if (!menuEl) return;
    clearInterval(padTimer); padTimer = null;
    window.removeEventListener('keydown', onKey, true);
    menuEl.remove(); menuEl = null; rows = [];
    setTimeout(function () { menuOpen = false; }, 200); // let the B press finish first
  }

  window.__cpMenu = { open: open, close: close, toggle: function () { menuEl ? close() : open(); } };

  // ================================================================ latency
  // Ask WebRTC for the smallest playout buffer: lower input-to-photon delay.
  if (C.lowLatency !== false) {
    setInterval(function () {
      pcs.forEach(function (pc) {
        if (pc.connectionState === 'closed') return;
        try {
          pc.getReceivers().forEach(function (r) {
            if ('jitterBufferTarget' in r) { if (r.jitterBufferTarget !== 0) r.jitterBufferTarget = 0; }
            else if ('playoutDelayHint' in r) { if (r.playoutDelayHint !== 0) r.playoutDelayHint = 0; }
          });
        } catch (e) {}
      });
    }, 1000);
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
    if (b) { b.click(); return 'ok'; }
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
