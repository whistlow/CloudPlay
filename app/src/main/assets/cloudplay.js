// CloudPlay page script. Runs at document start on xbox.com and applies the app's settings.
// window.__CP_CFG is prepended by the app.
(function () {
  if (window.__cpInstalled || window.top !== window) return; // main page only
  if (!/(^|\.)xbox\.com$/.test(location.hostname)) return;
  window.__cpInstalled = true;

  var C = window.__CP_CFG || {};
  // With the Better xCloud engine on, it handles stream quality, region, stats and its own
  // touch layouts, so CloudPlay leaves those alone and only adds rumble, clarity and overlays.
  var BX = C.engine === 'betterxcloud';
  // Remote Play: "standard" connects exactly like the Xbox website (works on any network);
  // "direct" adds the console's home addresses for a faster link on the same Wi-Fi.
  // Remote Play connection: "auto" (default) adds your console's direct addresses next to
  // Xbox's own routes, so it connects straight to the console when it can (home Wi-Fi, or
  // directly over the internet) and through Xbox's relay when it can't. "standard" leaves
  // the connection exactly as the Xbox website makes it. (Older "direct" = auto.)
  var RP_MODE = C.remotePlayMode === 'standard' ? 'standard' : 'auto';
  var DIRECT_RP = false;
  window.__cpStockRemotePlay = true;
  // Standard Remote Play runs as the plain Xbox website: no enhancement engine and no
  // stream tweaks on /play/consoles pages, only controller input and rumble.
  var PURE_RP = !DIRECT_RP && /\/play\/consoles/.test(location.pathname);
  window.__cpPureRemote = PURE_RP;
  var ACTIVE = !PURE_RP;
  if (PURE_RP) BX = false;

  // The site switches pages without reloading; crossing into or out of Remote Play does a
  // full load so each side starts clean.
  if (!DIRECT_RP) (function () {
    function isRP(u) {
      try { return /\/play\/consoles/.test(new URL(u, location.href).pathname); } catch (e) { return false; }
    }
    ['pushState', 'replaceState'].forEach(function (m) {
      var orig = history[m];
      history[m] = function (state, title, url) {
        if (url != null && isRP(url) !== PURE_RP) {
          location.assign(new URL(url, location.href).href);
          return;
        }
        return orig.apply(this, arguments);
      };
    });
    window.addEventListener('popstate', function () {
      if (isRP(location.href) !== PURE_RP) location.reload();
    });
    // The site can also change pages through the Navigation API or a router that doesn't go
    // through pushState, so watch the address itself as well.
    if (window.navigation && navigation.addEventListener) {
      navigation.addEventListener('navigatesuccess', function () {
        if (isRP(location.href) !== PURE_RP) location.reload();
      });
    }
    var lastPath = location.pathname;
    setInterval(function () {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      if (isRP(location.href) !== PURE_RP) location.reload();
    }, 300);
  })();
  var OS_NAMES = { '720p': 'android', '1080p': 'windows', '1080p_hq': 'tizen' };
  var H264_PROFILES = { h264_high: '64', h264_main: '4d', h264_baseline: '42' };

  function native() { return window.CloudPlayNative; }

  // Background play: the page always believes it's on screen, so the game isn't paused or
  // ended when you switch apps. The app mutes it while you're away (unless sound is allowed).
  if (C.keepAlive !== false) {
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
      Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
      ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'freeze'].forEach(function (t) {
        window.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
        document.addEventListener(t, function (e) { e.stopImmediatePropagation(); }, true);
      });
    } catch (e) {}
  }
  var bgMuted = [];
  window.__cpBackground = function (away) {
    if (C.bgAudio) return;
    if (away) {
      bgMuted = [];
      document.querySelectorAll('video, audio').forEach(function (m) {
        if (!m.muted) { m.muted = true; bgMuted.push(m); }
      });
    } else {
      bgMuted.forEach(function (m) { m.muted = false; });
      bgMuted = [];
    }
  };

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
    // Quality settings from App settings: copied over whenever they change there, so the
    // in-page Settings and App settings stay in step (the most recent change wins).
    try {
      var nat = {
        'stream.video.resolution': { auto: 'auto', '720p': '720p', '1080p': '1080p', '1080p_hq': '1080p-hq' }[C.resolution] || 'auto',
        'stream.video.codecProfile': { auto: 'default', h264_high: 'high', h264_main: 'normal', h264_baseline: 'low' }[C.codec] || 'default',
        'stream.video.maxBitrate': (function (kbps) {
          kbps = parseInt(kbps, 10) || 0;
          return (!kbps || kbps >= 15000) ? 0 : Math.round(kbps / 1000 * 1024 * 1000);
        })(C.maxBitrate),
        'server.region': (C.region && C.region !== 'auto') ? C.region : 'default'
      };
      var last = JSON.parse(localStorage.getItem('cp.nativeQuality') || 'null');
      var cur2 = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
      var changed = false;
      Object.keys(nat).forEach(function (k) {
        if (!last || last[k] !== nat[k]) { cur2[k] = nat[k]; changed = true; }
      });
      if (changed) localStorage.setItem('BetterXcloud', JSON.stringify(cur2));
      localStorage.setItem('cp.nativeQuality', JSON.stringify(nat));
    } catch (e) {}

    // Clarity boost with the Advanced engine runs on the GPU (WebGL2 + AMD CAS sharpening),
    // which stays smooth at 1080p60. Off = the plain video player, the lightest option.
    // Written when the preset changes in the app; in-game tweaks stay until it changes again.
    try {
      var key = [C.clarityPreset, C.sharpness, C.saturation, C.contrast, C.brightness].join('|');
      if (localStorage.getItem('cp.lastClarity') !== key) {
        var st = JSON.parse(localStorage.getItem('BetterXcloud.Stream') || '{}');
        var clamp = function (v) { return Math.max(50, Math.min(150, parseInt(v, 10) || 100)); };
        var sharp = Math.max(0, Math.min(10, parseInt(C.sharpness, 10) || 0));
        var on = (C.clarityPreset || 'off') !== 'off';
        st['video.player.type'] = on && sharp > 0 ? 'webgl2' : 'default';
        st['video.player.powerPreference'] = 'high-performance';
        st['video.processing'] = 'cas';
        st['video.processing.mode'] = 'performance';
        st['video.processing.sharpness'] = on ? sharp : 0;
        st['video.saturation'] = on ? clamp(C.saturation) : 100;
        st['video.contrast'] = on ? clamp(C.contrast) : 100;
        st['video.brightness'] = on ? clamp(C.brightness) : 100;
        localStorage.setItem('BetterXcloud.Stream', JSON.stringify(st));
        localStorage.setItem('cp.lastClarity', key);
      }
    } catch (e) {}

    // Faster artwork: game tiles and backgrounds download as smaller images.
    try {
      var bxs = JSON.parse(localStorage.getItem('BetterXcloud') || '{}');
      var q = C.fastArt === false ? 90 : 70;
      if (bxs['ui.imageQuality'] !== q) {
        bxs['ui.imageQuality'] = q;
        localStorage.setItem('BetterXcloud', JSON.stringify(bxs));
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
  if (ACTIVE) try {
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
  // Open connections to the image and game servers right away instead of on first use.
  (function preconnect() {
    var hosts = ['https://store-images.s-microsoft.com', 'https://assets.xboxservices.com',
      'https://catalog.gamepass.com', 'https://xgpuweb.gssv-play-prod.xboxlive.com',
      'https://xgpuwebf2p.gssv-play-prod.xboxlive.com', 'https://emerald.xboxservices.com'];
    function add() {
      var head = document.head || document.documentElement;
      if (!head) return;
      hosts.forEach(function (h) {
        var l = document.createElement('link');
        l.rel = 'preconnect'; l.href = h; l.crossOrigin = 'anonymous';
        head.appendChild(l);
      });
    }
    if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true });
  })();

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

  function deviceInfo(res) {
    var os = OS_NAMES[res || C.resolution] || 'windows';
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

  // Remote Play: optional resolution (tells Xbox which kind of device is connecting) and, in
  // Auto mode, extra direct routes to the console. Xbox's own routes are never changed or
  // removed, so it always works anywhere the website works.
  var rpConsole = [];

  function rpAddCandidates(list) {
    if (!rpConsole.length || !Array.isArray(list)) return list;
    var tmpl = list.filter(function (c) { return c && c.sdpMid != null; })[0] || {};
    var end = list.findIndex(function (c) { return /end-of-candidates/.test((c && c.candidate) || ''); });
    var extra = [];
    rpConsole.forEach(function (a, i) {
      var exists = list.some(function (c) { return ((c && c.candidate) || '').indexOf(' ' + a.ip + ' ' + a.port + ' ') >= 0; });
      if (exists) return;
      extra.push({
        candidate: 'a=candidate:' + (91 + i) + ' 1 UDP ' + (2130706431 - i) + ' ' + a.ip + ' ' + a.port + ' typ host',
        messageType: tmpl.messageType || 'iceCandidate',
        sdpMLineIndex: tmpl.sdpMLineIndex != null ? tmpl.sdpMLineIndex : '0',
        sdpMid: tmpl.sdpMid != null ? tmpl.sdpMid : '0'
      });
    });
    if (end < 0) end = list.length;
    return list.slice(0, end).concat(extra, list.slice(end));
  }

  if (PURE_RP && (RP_MODE === 'auto' || OS_NAMES[C.rpResolution])) window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if (!isXhome(url)) return origFetch.call(this, input, init);
    var path = url.split('?')[0];
    var method = ((init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();

    var res;
    if (OS_NAMES[C.rpResolution]) {
      var req = new Request(input, init);
      var headers = new Headers(req.headers);
      headers.set('x-ms-device-info', deviceInfo(C.rpResolution));
      var opts = { method: req.method, headers: headers };
      if (req.method !== 'GET' && req.method !== 'HEAD') opts.body = await req.clone().text();
      res = await origFetch(new Request(req.url, opts));
    } else {
      res = await origFetch.call(this, input, init);
    }
    if (RP_MODE !== 'auto' || !res.ok) return res;

    try {
      if (url.indexOf('/configuration') >= 0) {
        var d = (await res.clone().json()).serverDetails || {};
        rpConsole = [];
        [['ipAddress', 'port'], ['ipV4Address', 'ipV4Port'], ['ipV6Address', 'ipV6Port']].forEach(function (k) {
          var ip = d[k[0]];
          if (!ip) return;
          [d[k[1]], 9002].forEach(function (port) {
            if (port && !rpConsole.some(function (a) { return a.ip === ip && a.port === port; })) {
              rpConsole.push({ ip: ip, port: port });
            }
          });
        });
      } else if (/\/ice$/.test(path) && method === 'GET') {
        var text = await res.clone().text();
        if (text) {
          var obj = JSON.parse(text);
          obj.exchangeResponse = JSON.stringify(rpAddCandidates(JSON.parse(obj.exchangeResponse)));
          return jsonResponse(res, obj);
        }
      }
    } catch (e) {}
    return res;
  };

  if (ACTIVE) window.fetch = async function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var path = url.split('?')[0];

    // With the Advanced engine, it handles requests itself; here we only read the server list.
    if (BX && !/\/v2\/login\/user/.test(path)) return origFetch.call(this, input, init);

    if (!BX && isXhome(url)) return DIRECT_RP ? handleXhome(input, init, url, path) : origFetch.call(this, input, init);

    // Stream resolution for cloud games and Remote Play: the server picks quality
    // from the client's reported OS.
    if (!BX && /\/sessions\/cloud\/play$/.test(path) && OS_NAMES[C.resolution]) {
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
          if (!BX && C.region && C.region !== 'auto' && regions.some(function (x) { return x.name === C.region; })) {
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
      if (!BX && ACTIVE) { try { applyCodec(this); } catch (e) {} }
      var offer = await origCreateOffer.apply(this, arguments);
      if (!BX && ACTIVE) {
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
    var lvl = BX ? 0 : (parseInt(C.sharpness, 10) || 0);
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
    if (!BX && C.saturation && C.saturation !== 100) filters.push('saturate(' + C.saturation / 100 + ')');
    if (!BX && C.contrast && C.contrast !== 100) filters.push('contrast(' + C.contrast / 100 + ')');
    if (!BX && C.brightness && C.brightness !== 100) filters.push('brightness(' + C.brightness / 100 + ')');

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

  // The app pushes controller changes here the moment they happen (window.__cpPads), so
  // reading the controller (up to 250 times a second in-game) never waits on the app.
  var bridgeVer = -1, bridgeObjs = {};
  function bridgePads() { return bridgeObjs; }

  function pullBridge() { // fallback/initial sync only
    var n = native();
    if (inputMode === 'webview' || !n || !n.padVersion) return;
    var v = n.padVersion();
    if (v === bridgeVer) return;
    try { applyBridge(v, JSON.parse(n.padState())); } catch (e) {}
  }

  window.__cpPads = function (v, arr) {
    if (inputMode === 'webview') return;
    applyBridge(v, arr);
  };

  function applyBridge(v, arr) {
    bridgeVer = v;
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

  // Initial sync, plus a slow safety net in case a push was missed.
  pullBridge();
  setInterval(pullBridge, 1000);

  // ========================================================== quick access
  // Tell the app when a game is streaming (it hides the floating gear then).
  var lastStreaming = null;
  setInterval(function () {
    var on = streaming() || location.pathname.indexOf('/launch/') >= 0;
    if (on !== lastStreaming) {
      lastStreaming = on;
      try { native() && native().setStreaming(on); } catch (e) {}
    }
  }, 700);

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

  // Icon-only buttons in the top bar (search, devices, controller...). The gear goes after
  // the right-most one, i.e. just left of the profile picture / Sign in.
  function topBar() {
    return document.querySelector('header, [role="banner"]') || document.body;
  }

  function isTopIcon(el) {
    if (el.classList.contains('cp-header-gear') || !el.querySelector('svg') || el.querySelector('img')) return null;
    if (el.closest('#StreamHud, .cp-hud-gear, .cpm-backdrop')) return null;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.width > 90 || r.top > 140 || r.top < -10) return null;
    return r;
  }

  function rightmostTopIcon() {
    var best = null, bestR = null;
    // Whole page: on some pages the top bar sits over the hero art, outside any <header>.
    document.querySelectorAll('button, a').forEach(function (el) {
      var r = isTopIcon(el);
      if (r && (!bestR || r.right > bestR.right)) { best = el; bestR = r; }
    });
    return best;
  }

  function cleanClone(src) {
    var btn = src.cloneNode(true);
    var oldSvg = btn.querySelector('svg');
    // Drop everything that isn't on the path to the icon (tooltips, labels, badges).
    Array.prototype.slice.call(btn.querySelectorAll('*')).forEach(function (el) {
      if (!btn.contains(el) || el === oldSvg || oldSvg.contains(el) || el.contains(oldSvg)) return;
      el.remove();
    });
    Array.prototype.slice.call(btn.attributes).forEach(function (a) {
      if (/^(id|href|aria-|data-|title|target|rel)/.test(a.name)) btn.removeAttribute(a.name);
    });
    btn.querySelectorAll('[id],[aria-describedby]').forEach(function (el) {
      el.removeAttribute('id'); el.removeAttribute('aria-describedby');
    });
    oldSvg.parentNode.replaceChild(gearSvg(oldSvg), oldSvg);
    return btn;
  }

  var headerReported = null;
  function ensureHeaderGear() {
    if (lastStreaming || location.pathname.indexOf('/launch/') >= 0) { // in-game: no header gear
      var g0 = document.querySelector('.cp-header-gear');
      if (g0) g0.remove();
      return;
    }
    var existing = document.querySelector('.cp-header-gear');
    // Cheap check first: still attached next to the same kind of icon, and nothing to its right.
    var ok = existing && existing.isConnected && existing.previousElementSibling &&
      isTopIcon(existing.previousElementSibling) && !(existing.nextElementSibling && isTopIcon(existing.nextElementSibling));
    if (!ok) {
      var anchor = rightmostTopIcon();
      if (existing) existing.remove();
      existing = null;
      if (anchor) {
        var btn = cleanClone(anchor);
        btn.classList.add('cp-header-gear');
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-label', 'Settings');
        btn.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation(); openSettingsUi();
        }, true);
        anchor.parentNode.insertBefore(btn, anchor.nextSibling);
        existing = btn;
      }
    }
    var present = !!existing;
    if (present !== headerReported) {
      headerReported = present;
      try { native() && native().setHeaderButton(present); } catch (e) {}
    }
  }
  onReady(function () { setInterval(ensureHeaderGear, 1000); ensureHeaderGear(); });

  var CHEVRON = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CHECK = '<svg width="18" height="18" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var CLARITY = [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['vivid', 'Vivid'], ['custom', 'Custom']];

  function remotePlayUrl() {
    var m = location.pathname.match(/^\/([a-z]{2}-[a-z]{2})\//i);
    return 'https://www.xbox.com/' + (m ? m[1] : 'en-US') + '/play/consoles';
  }

  var menuEl = null, rows = [], focusIdx = 0, page = 'main', rootPage = 'main', padTimer = null;

  // Remote Play settings: picture options apply instantly (display only); resolution and
  // connection apply the next time you connect to your console.
  var FITS = [['contain', 'Fit'], ['cover', 'Zoom to fill'], ['fill', 'Stretch']];
  var RP_RES = [['auto', 'Auto'], ['720p', '720p'], ['1080p', '1080p'], ['1080p_hq', '1080p HQ']];
  function nextOf(list, cur) {
    var i = list.findIndex(function (x) { return x[0] === cur; });
    return list[(i + 1) % list.length];
  }
  function nameOf(list, cur) { return (list.filter(function (x) { return x[0] === cur; })[0] || list[0])[1]; }
  function savePref(key, value) { try { native() && native().setPref(key, String(value)); } catch (e) {} }

  function remoteItems() {
    return [
      { label: 'Clarity boost', detail: clarityName(C.clarityPreset || 'off'), go: function () { render('clarity'); } },
      { label: 'Screen fit', detail: nameOf(FITS, C.videoFit || 'contain'), go: function () {
        var n = nextOf(FITS, C.videoFit || 'contain');
        C.videoFit = n[0]; savePref('video_fit', n[0]); applyVideoStyle(); render('remote', focusIdx);
      } },
      { label: 'Stream stats', detail: C.showStats ? 'On' : 'Off', go: function () {
        C.showStats = !C.showStats; savePref('show_stats', C.showStats); render('remote', focusIdx);
      } },
      { label: 'Resolution', sub: 'Applies next time you connect', detail: nameOf(RP_RES, C.rpResolution || 'auto'), go: function () {
        var n = nextOf(RP_RES, C.rpResolution || 'auto');
        C.rpResolution = n[0]; savePref('rp_resolution', n[0]); render('remote', focusIdx);
      } },
      { label: 'Connection', sub: 'Applies next time you connect',
        detail: C.remotePlayMode === 'standard' ? 'Standard' : 'Auto (fastest)', go: function () {
        C.remotePlayMode = C.remotePlayMode === 'standard' ? 'auto' : 'standard';
        savePref('remote_play_mode', C.remotePlayMode); render('remote', focusIdx);
      } },
      { label: 'Touch controls', sub: 'Show or hide on-screen buttons', go: function () { close(); window.__cpTouch && __cpTouch.toggle(); } },
      { label: 'App settings', go: function () { close(); native() && native().openSettings(); } },
      { label: 'Exit app', go: function () { native() && native().exitApp(); } }
    ];
  }

  // Gear in the in-game bar (next to the Xbox and controller buttons), cloned from the bar's
  // own button so it matches. Used wherever the enhancement engine isn't adding its own.
  function ensureHudGear() {
    if (BX && window.__bxMainOk) return; // the engine adds its own gear
    var hud = document.getElementById('StreamHud');
    if (!hud || hud.querySelector('.cp-hud-gear')) return;
    var org = hud.querySelector('div[class^=HUDButton]');
    var btnOrg = org && org.querySelector('button');
    var svgOrg = btnOrg && btnOrg.querySelector('svg');
    if (!svgOrg) return;
    var box = org.cloneNode(true);
    box.classList.add('cp-hud-gear');
    var b = box.querySelector('button');
    b.setAttribute('title', 'Settings');
    b.setAttribute('aria-label', 'Settings');
    b.removeAttribute('id');
    var svg = box.querySelector('svg');
    var g = gearSvg(svg);
    g.style.fill = 'none';
    svg.parentNode.replaceChild(g, svg);
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); window.__cpMenu.open();
    }, true);
    var parent = org.parentElement;
    parent.insertBefore(box, parent.lastElementChild);
  }
  onReady(function () { setInterval(function () { if (lastStreaming) ensureHudGear(); }, 700); });

  function mainItems() {
    var preset = (CLARITY.filter(function (c) { return c[0] === (C.clarityPreset || 'off'); })[0] || CLARITY[0])[1];
    var items = [
      { label: 'App settings', sub: 'Stream quality, controls, rumble, performance', go: function () { close(); native() && native().openSettings(); } }
    ];
    if (BX) items.push({ label: 'Advanced settings', sub: 'Upscaling, stats, server, mouse & keyboard', go: function () {
      close(); setTimeout(function () { if (window.__cpOpenBx && __cpOpenBx() !== 'ok') toast('Settings are still loading, try again in a moment'); }, 60);
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
        if (BX) toast('Clarity boost applies when the next game starts');
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
    if (which === 'clarity') {
      var back = document.createElement('button'); back.className = 'cpm-back'; back.setAttribute('aria-label', 'Back');
      back.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      back.onclick = function () { render(rootPage); };
      title.appendChild(back);
    }
    title.appendChild(document.createTextNode(
      which === 'main' ? 'Settings' : which === 'remote' ? 'Remote Play settings' : 'Clarity boost'));
    var x = document.createElement('button'); x.className = 'cpm-close'; x.setAttribute('aria-label', 'Close');
    x.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    x.onclick = close;
    head.appendChild(title); head.appendChild(x); box.appendChild(head);

    var list = document.createElement('div'); list.className = 'cpm-list';
    var items = which === 'main' ? mainItems() : which === 'remote' ? remoteItems() : clarityItems();
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
     hint.textContent = which === rootPage ? '\u24B6 Select    \u24B7 Close' : '\u24B6 Select    \u24B7 Back';
    box.appendChild(hint);
    var checked = rows.findIndex(function (r) { return r._checked; });
    setFocus(keepFocus != null ? keepFocus : Math.max(0, checked));
  }

  function goBackOrClose() { if (page !== rootPage) render(rootPage); else close(); }

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
    rootPage = PURE_RP ? 'remote' : 'main';
    render(rootPage);
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

  window.__cpMenu = { open: open, close: close, toggle: function () { menuEl ? close() : openSettingsUi(); } };

  // App options at the top of the Settings dialog, so there is one Settings everywhere
  // (header gear, in-game gear, View/Back). Styled with the dialog's own button classes.
  function closeBxDialog() {
    var t = document.activeElement || document.body;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  }

  function clarityName(v) {
    return (CLARITY.filter(function (c) { return c[0] === v; })[0] || CLARITY[0])[1];
  }

  function bxButton(label, onClick) {
    var b = document.createElement('button');
    b.className = 'bx-button bx-full-width bx-focusable cp-app-btn';
    b.tabIndex = 0;
    var span = document.createElement('span');
    span.textContent = label;
    b.appendChild(span);
    b.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      onClick(span);
    });
    return b;
  }

  if (BX) onReady(function () {
    var st = document.createElement('style');
    st.textContent = '.cp-app-section{display:flex;flex-direction:column;gap:8px;margin-bottom:10px}' +
      '.cp-app-section .cp-app-title{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;' +
      'opacity:.7;margin:4px 2px 2px}';
    document.head.appendChild(st);

    setInterval(function () {
      var top = document.querySelector('.bx-top-buttons');
      if (!top || top.querySelector('.cp-app-section')) return;
      var ad = top.querySelector('a[href*="better-xcloud.github.io/android"]');
      if (ad) ad.remove();

      var sec = document.createElement('div');
      sec.className = 'cp-app-section';
      var title = document.createElement('div');
      title.className = 'cp-app-title';
      title.textContent = 'App';
      sec.appendChild(title);
      sec.appendChild(bxButton('App settings', function () {
        closeBxDialog(); native() && native().openSettings();
      }));
      sec.appendChild(bxButton('Remote Play', function () {
        closeBxDialog(); location.href = remotePlayUrl();
      }));
      sec.appendChild(bxButton('Clarity boost: ' + clarityName(C.clarityPreset || 'off'), function (span) {
        var idx = CLARITY.findIndex(function (c) { return c[0] === (C.clarityPreset || 'off'); });
        var next = CLARITY[(idx + 1) % CLARITY.length][0];
        C.clarityPreset = next;
        try { native() && native().setClarity(next); } catch (e) {}
        span.textContent = 'Clarity boost: ' + clarityName(next);
        if (BX) toast('Clarity boost applies when the next game starts');
      }));
      sec.appendChild(bxButton('Show / hide touch controls', function () {
        closeBxDialog(); window.__cpTouch && __cpTouch.toggle();
      }));
      sec.appendChild(bxButton('Edit touch layout', function () {
        closeBxDialog(); setTimeout(function () { window.__cpTouch && __cpTouch.edit(); }, 150);
      }));
      sec.appendChild(bxButton('Exit app', function () { native() && native().exitApp(); }));
      top.insertBefore(sec, top.firstChild);
    }, 300);
  });

  // One entry point for "open settings": the Settings dialog when available, else the panel.
  function openSettingsUi() {
    if (BX && window.__cpOpenBx && __cpOpenBx() === 'ok') return;
    window.__cpMenu.open();
  }

  // ================================================================ latency
  // Ask WebRTC for the smallest playout buffer: lower input-to-photon delay.
  // Off by default: a zero buffer leaves no time for lost video packets to be re-sent, which
  // shows up as blocky glitches. The stream's own adaptive buffer is the smooth choice.
  if (C.lowLatency === true) {
    setInterval(async function () {
      // Remote Play: smallest buffer only on a direct home-network route; over the internet
      // the normal buffer keeps it smooth.
      var rp = location.pathname.indexOf('/play/consoles') >= 0;
      if (!rp && !ACTIVE) return;
      for (var i = 0; i < pcs.length; i++) {
        var pc = pcs[i];
        if (pc.connectionState === 'closed') continue;
        if (rp) {
          var route = await routeInfo(pc);
          if (!route || route.kind !== 'home') continue;
        }
        try {
          pc.getReceivers().forEach(function (r) {
            if ('jitterBufferTarget' in r) { if (r.jitterBufferTarget !== 0) r.jitterBufferTarget = 0; }
            else if ('playoutDelayHint' in r) { if (r.playoutDelayHint !== 0) r.playoutDelayHint = 0; }
          });
        } catch (e) {}
      }
    }, 1000);
  }

  // Which route the stream is using: home network (direct), internet (direct) or relay.
  function isPrivateIp(a) {
    return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|f[cd][0-9a-f]{2}:)/i.test(a || '');
  }
  async function routeInfo(pc) {
    try {
      var stats = await pc.getStats(), pair = null, byId = {};
      stats.forEach(function (r) {
        byId[r.id] = r;
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = r.selectedCandidatePairId;
      });
      pair = pair ? byId[pair] : null;
      if (!pair) stats.forEach(function (r) { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
      if (!pair) return null;
      var rc = byId[pair.remoteCandidateId] || {}, lc = byId[pair.localCandidateId] || {};
      var addr = rc.address || rc.ip;
      var kind = rc.candidateType === 'relay' || lc.candidateType === 'relay' ? 'relay'
        : isPrivateIp(addr) ? 'home' : 'internet';
      return { kind: kind, address: addr };
    } catch (e) { return null; }
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
    if (!root) {
      if (!(touchOn && streaming()) && forceShow === null && !editing) return;
      buildOverlay();
    }
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
    if (typeof window.__bxShowSettings === 'function') {
      try { window.__bxShowSettings(); return 'ok'; } catch (e) {}
    }
    var b = document.querySelector('.bx-header-settings-button');
    if (b) { b.click(); return 'ok'; }
    return 'missing';
  };

  window.__cpTouch = {
    toggle: function () { if (!root) buildOverlay(); forceShow = !computeVisible(); tick(); },
    edit: function () {
      if (!root) buildOverlay();
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

  onReady(function () { setInterval(tick, 400); });

  // ============================================================ stats panel
  if (!BX) {
    var el = null, prev = {};
    setInterval(async function () {
      var pc = pcs.filter(function (p) { return p.connectionState === 'connected'; }).pop();
      if (!pc || !C.showStats) { if (el) el.style.display = 'none'; prev = {}; return; }
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
      var route = location.pathname.indexOf('/play/consoles') >= 0 ? await routeInfo(pc) : null;
      el.textContent = (v.frameWidth || '?') + 'x' + (v.frameHeight || '?') + ' ' + codec + '  ' +
        Math.round(v.framesPerSecond || 0) + ' fps\n' +
        'Ping ' + ping + '  ' + mbps + ' Mbps  Loss ' + loss + '%  Decode ' + dec + ' ms' +
        (route ? '\nRoute: ' + ({ home: 'Home network (direct)', internet: 'Internet (direct)', relay: 'Xbox relay' })[route.kind] : '');
      el.style.display = 'block';
    }, 1000);
  }
})();
